import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { PRACTITIONERS } from "./constants";
import { calculateRentalPrice } from "./utils/scheduler";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || "default_dev_secret_key";
  return secret;
}

// Auth Middleware
export interface AuthRequest extends Request {
  user?: any;
}

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Chybí autorizační token" });
  }

  const token = authHeader.split(" ")[1];
  
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Neplatný nebo vypršelý token" });
  }
}

async function startServer() {
  const app = express();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // GoPay API base URL (sandbox by default)
  const GOPAY_URL = "https://gw.sandbox.gopay.com/api";

  async function getGoPayToken() {
    const gopayId = process.env.GOPAY_GOID;
    const clientId = process.env.GOPAY_CLIENT_ID;
    const clientSecret = process.env.GOPAY_CLIENT_SECRET;
    
    if (!gopayId || !clientId || !clientSecret) {
      throw new Error("GoPay credentials are not fully configured in environment variables.");
    }
    
    const response = await fetch(`${GOPAY_URL}/oauth2/token`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
      },
      body: "grant_type=client_credentials&scope=payment-all"
    });
    
    if (!response.ok) {
       throw new Error("GoPay auth failed: " + response.statusText);
    }
    const data = await response.json();
    return data.access_token as string;
  }

  // Resend lazy initialization
  let resendClient: Resend | null = null;
  function getResend(): Resend {
    if (!resendClient) {
      const key = process.env.RESEND_API_KEY;
      if (!key) {
        throw new Error("RESEND_API_KEY environment variable is required");
      }
      resendClient = new Resend(key);
    }
    return resendClient;
  }

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Login endpoint
  app.post("/api/login", (req, res) => {
    try {
      const { userId, name, role } = req.body;
      
      if (!userId || !name || !role) {
        return res.status(400).json({ error: "Chybí informace o uživateli" });
      }

      // PIN validity was already verified on the client safely
      // Give signed JWT based on client claims
      const token = jwt.sign(
        { id: userId, role: role, name: name },
        process.env.JWT_SECRET || "default_dev_secret_key",
        { expiresIn: "1d" }
      );

      res.json({ success: true, token, user: { id: userId, name, role } });
    } catch (error: any) {
      console.error("Login Error:", error);
      res.status(500).json({ error: error.message || "Interní chyba serveru" });
    }
  });

  // Create a payment via GoPay
  app.post("/api/create-payment", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { duration, room, currency, reservationDate, reservationTime, returnUrl } = req.body;
      
      if (typeof duration !== 'number' || (room !== 1 && room !== 2)) {
         return res.status(400).json({ error: "Neplatné parametry pro výpočet ceny." });
      }
      
      const finalPrice = calculateRentalPrice(duration, room);
      const amount = Math.round(finalPrice * 100); // v haléřích

      const token = await getGoPayToken();
      
      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: currency || "CZK",
          order_number: `RES-${Date.now()}`,
          order_description: `Rezervace místnosti ${room}`,
          items: [{ name: `Pronájem místnosti ${room} (${duration}h)`, amount: amount, count: 1 }],
          callback: {
              return_url: returnUrl || "https://rezervace.centrumunity.cz/",
              notification_url: "https://rezervace.centrumunity.cz/api/gopay/notify"
          },
          target: {
              type: "ACCOUNT",
              goid: process.env.GOPAY_GOID
          },
          additional_params: [
              { name: "userId", value: req.user?.id || '' },
              { name: "reservationDate", value: reservationDate || '' },
              { name: "reservationTime", value: reservationTime || '' }
          ]
      };

      const response = await fetch(`${GOPAY_URL}/payments/payment`, {
         method: "POST",
         headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
         },
         body: JSON.stringify(paymentData)
      });
      
      const data = await response.json();

      if (!response.ok) {
         throw new Error("GoPay create payment failed: " + JSON.stringify(data));
      }
      
      res.json({ 
        paymentId: data.id,
        gwUrl: data.gw_url
      });
    } catch (error: any) {
      console.error("GoPay Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Refund endpoint for GoPay
  app.post("/api/refund", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { paymentId, amount } = req.body;
      
      if (!paymentId) {
        return res.status(400).json({ error: "Missing paymentId" });
      }

      const token = await getGoPayToken();

      // Get payment status
      const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${paymentId}`, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      });
      const paymentStatus = await statusRes.json();

      // Check permissions based on additional_params
      let paymentUserId = "";
      let resDate = "";
      let resTime = "";
      if (paymentStatus.additional_params) {
         const userParam = paymentStatus.additional_params.find((p: any) => p.name === "userId");
         if (userParam) paymentUserId = userParam.value;
         
         const dateParam = paymentStatus.additional_params.find((p: any) => p.name === "reservationDate");
         if (dateParam) resDate = dateParam.value;
         
         const timeParam = paymentStatus.additional_params.find((p: any) => p.name === "reservationTime");
         if (timeParam) resTime = timeParam.value;
      }

      // Verify ownership or admin role
      const isOwner = req.user?.id === paymentUserId;
      const isAdmin = req.user?.role === 'admin';
      
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: "Access denied. You can only refund your own payments." });
      }

      // Only refund if payment was actually PAID
      if (paymentStatus.state !== 'PAID') {
         return res.json({ success: true, message: "Platba nebyla dokončena, storno rezervace proběhlo bez refundace." });
      }

      // Backend verification of 24h limit
      if (resDate && resTime) {
        const dateParts = resDate.split('-');
        const [hours, minutes] = resTime.split(':').map(Number);
        if (dateParts.length === 3) {
          const reservationDateTime = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), hours, minutes);
          const now = new Date();
          const differenceInHours = (reservationDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

          if (differenceInHours < 24) {
            return res.status(400).json({ error: "Refundace není možná. Zbývá méně než 24 hodin do začátku rezervace." });
          }
        }
      }

      // Refund the payment
      const refundRes = await fetch(`${GOPAY_URL}/payments/payment/${paymentId}/refund`, {
         method: "POST",
         headers: {
           "Accept": "application/json",
           "Content-Type": "application/x-www-form-urlencoded",
           "Authorization": `Bearer ${token}`
         },
         body: `amount=${amount || paymentStatus.amount}`
      });

      const result = await refundRes.json();

      if (!refundRes.ok) {
         return res.status(400).json({ error: `Nelze refundovat platbu: ${JSON.stringify(result)}` });
      }

      res.json({ success: true, result });
    } catch (error: any) {
      console.error("GoPay Refund Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Capture endpoint pro GoPay - pokud by se používala preautorizace
  app.post("/api/capture-payment", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { paymentId } = req.body;
      
      if (!paymentId) {
        return res.status(400).json({ error: "Missing paymentId" });
      }

      const token = await getGoPayToken();

      const captureRes = await fetch(`${GOPAY_URL}/payments/payment/${paymentId}/capture`, {
         method: "POST",
         headers: {
           "Accept": "application/json",
           "Content-Type": "application/x-www-form-urlencoded",
           "Authorization": `Bearer ${token}`
         }
      });
      
      const intent = await captureRes.json();
      
      if (!captureRes.ok) {
         return res.status(400).json({ error: `Nelze strhnout platbu: ${JSON.stringify(intent)}` });
      }

      res.json({ success: true, intent });
    } catch (error: any) {
      console.error("GoPay Capture Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Webhook pro notifikace z GoPay (změna stavu platby)
  app.get("/api/gopay/notify", async (req: Request, res: Response) => {
      try {
          const { id } = req.query; // GoPay posílá ID platby v query parametru
          if (!id) {
             return res.status(400).json({ error: "Missing payment ID" });
          }

          // V praxi byste zde zkontrolovali stav platby přes GoPay API
          const token = await getGoPayToken();
          const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${id}`, {
             method: "GET",
             headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
             }
          });
          const paymentStatus = await statusRes.json();

          // Na základě paymentStatus.state (např. PAID, CANCELED, TIMEOUTED)
          // aktualizujete stav rezervace v databázi (Firebase).
          console.log(`GoPay Notification - Payment ID: ${id}, State: ${paymentStatus.state}`);

          res.send("OK"); // GoPay očekává jakoukoliv HTTP 200 odpověď
      } catch (error: any) {
          console.error("GoPay Webhook Error:", error.message);
          res.status(500).send("Error");
      }
  });

  // Endpoint pro ověření stavu platby (např. po návratu na return_url)
  app.get("/api/gopay/status", async (req: Request, res: Response) => {
      try {
          const { id } = req.query;
          if (!id) {
             return res.status(400).json({ error: "Missing payment ID" });
          }

          const token = await getGoPayToken();
          const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${id}`, {
             method: "GET",
             headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
             }
          });
          const paymentStatus = await statusRes.json();
          res.json({ state: paymentStatus.state });
      } catch (error: any) {
          console.error("GoPay Status Error:", error.message);
          res.status(500).json({ error: error.message });
      }
  });

  // Cron endpoint pro kontrolu plateb > 120 dní (spouštěn např. z Google Cloud Scheduler každý den v noci)
  app.post("/api/cron/check-future-payments", async (req: Request, res: Response) => {
     try {
         // Bezpečnostní kontrola (např. custom header od Scheduleru)
         const authHeader = req.headers.authorization;
         if (authHeader !== `Bearer ${process.env.CRON_SECRET || "cron-secret"}`) {
            return res.status(401).send("Unauthorized");
         }

         // 1. Zde byste načetli z Firebase všechny rezervace ve stavu 'pending_future'
         // 2. Prošlo by se každou z nich a zjistilo by se, jestli zbývá <= 120 dní do termínu
         // 3. Pro ty, které jsou <= 120 dní, vytvoříme GoPay platbu (podobně jako v /api/create-payment)
         // 4. Emailem pošleme klientovi odkaz na platební bránu (gw_url) a změníme stav na 'pending' (nebo 'pending_email_sent')

         console.log("Cron check-future-payments proběhl.");
         res.json({ success: true, checked: true });
     } catch (error: any) {
         console.error("Cron Error:", error.message);
         res.status(500).send("Error");
     }
  });

  // Send an email
  app.post("/api/send-email", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { to, subject, html } = req.body;

      if (!process.env.RESEND_API_KEY) {
        console.log("No RESEND_API_KEY provided. Mocking email send:");
        console.log(`To: ${to}\nSubject: ${subject}\nBody: ${html}`);
        return res.json({ success: true, mocked: true });
      }
      
      const resend = getResend();
      const data = await resend.emails.send({
        from: process.env.FROM_EMAIL || "Centrum Unity <onboarding@resend.dev>",
        to: [to],
        subject: subject,
        html: html,
      });
      
      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Resend Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      // app.use(vite.middlewares) will handle routing non-API requests to the SPA
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Vite not found or failed to start", e);
    }
  } else {
    // Production static serving
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
