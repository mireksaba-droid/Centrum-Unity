import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, DocumentReference } from "firebase-admin/firestore";

const FIRESTORE_DB_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  "ai-studio-21fbe237-8e55-49f1-9943-9fef39621ecb";

import { PRACTITIONERS } from "./constants";
import { calculateRentalPrice } from "./utils/scheduler";

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  try {
    initializeApp();
  } catch (error) {
    console.warn("Failed to initialize Firebase Admin:", error);
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
      throw new Error("JWT_SECRET is not configured on the server.");
  }
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

  // Admin endpoint for completely resetting database data (bookings, events, registrations)
  app.delete("/api/admin/reset-data", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== 'admin') {
         return res.status(403).json({ error: "Nedostatečná oprávnění. Pouze admin." });
      }

      if (!getApps().length) {
         return res.status(500).json({ error: "Firebase Admin is not initialized" });
      }

      const db = getFirestore(FIRESTORE_DB_ID);
      
      const deleteCollection = async (collectionPath: string) => {
         const snapshot = await db.collection(collectionPath).get();
         const batch = db.batch();
         snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
         });
         await batch.commit();
      };

      await deleteCollection('bookings');
      await deleteCollection('groupEvents');
      await deleteCollection('eventRegistrations');

      console.log(`[Admin] Užitel ${req.user.name} resetoval kompletně databázi.`);
      res.json({ success: true, message: "Všechna data o rezervacích byla vymazána." });
    } catch (error: any) {
      console.error("Reset Data Error:", error.message);
      res.status(500).json({ error: "Interní chyba při mazání dat." });
    }
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

  // Simple in-memory rate limiter for public payment endpoint
  const paymentRateLimits = new Map<string, { count: number, resetTime: number }>();

  // Create a payment via GoPay (public endpoint without auth)
  app.post("/api/public-payment", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const now = Date.now();
      const limit = paymentRateLimits.get(ip);
      
      if (limit && limit.resetTime > now) {
          if (limit.count >= 5) {
              return res.status(429).json({ error: "Příliš mnoho pokusů o vytvoření platby. Zkuste to prosím později." });
          }
          limit.count++;
      } else {
          paymentRateLimits.set(ip, { count: 1, resetTime: now + 60000 }); // 5 requests per minute
      }

      const { duration, room, currency, reservationDate, reservationTime, returnUrl, bookingId } = req.body;
      
      if (!bookingId) {
        return res.status(400).json({ error: "Chybí identifikátor rezervace (bookingId)." });
      }

      if (typeof duration !== 'number' || (room !== 1 && room !== 2)) {
         return res.status(400).json({ error: "Neplatné parametry pro výpočet ceny." });
      }

      // 1. Ověříme, že rezervace existuje v databázi a není už zaplacená
      if (getApps().length > 0) {
        const db = getFirestore(FIRESTORE_DB_ID);
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists) {
           return res.status(404).json({ error: "Rezervace nebyla nalezena." });
        }
        const bookingData = bookingSnap.data();
        if (bookingData?.paymentStatus === 'paid') {
           return res.status(400).json({ error: "Tato rezervace je již zaplacena." });
        }
      }
      
      const finalPrice = calculateRentalPrice(duration, room);
      const amount = Math.round(finalPrice * 100);

      const token = await getGoPayToken();
      
      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: currency || "CZK",
          order_number: `RES-${Date.now()}`,
          order_description: `Doplatek rezervace místnosti ${room}`,
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
              { name: "bookingId", value: bookingId || '' },
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
      console.error("GoPay Public Payment Error:", error.message);
      res.status(400).json({ error: error.message });
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

      const textResult = await refundRes.text();
      let result;
      try {
          result = textResult ? JSON.parse(textResult) : {};
      } catch (e) {
          console.error("GoPay refund returned non-JSON:", textResult);
          result = { error: textResult };
      }

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

          const token = await getGoPayToken();
          const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${id}`, {
             method: "GET",
             headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
             }
          });
          const paymentStatus = await statusRes.json();

          const bookingIdParam = paymentStatus.additional_params?.find((x: any) => x.name === "bookingId")?.value;
          
          if (!getApps().length) {
             return res.status(500).json({ error: "Firebase Admin is not initialized" });
          }
          const adminDb = getFirestore(FIRESTORE_DB_ID);

          let bookingRef: DocumentReference | null = null;
          let bookingId = bookingIdParam;

          if (bookingId) {
             bookingRef = adminDb.collection("bookings").doc(bookingId);
          } else {
             // Zkusíme najít podle paymentId
             const snapshot = await adminDb.collection("bookings").where("paymentId", "==", String(id)).limit(1).get();
             if (!snapshot.empty) {
                bookingRef = snapshot.docs[0].ref;
                bookingId = snapshot.docs[0].id;
             }
          }

          if (bookingRef) {
             const map: Record<string, string> = {
                PAID: "paid",
                CANCELED: "cancelled_unpaid",
                TIMEOUTED: "cancelled_unpaid",
                REFUNDED: "refunded",
             };
             const newStatus = map[paymentStatus.state];
             if (newStatus) {
                await adminDb.runTransaction(async (tx) => {
                   const doc = await tx.get(bookingRef!);
                   if (!doc.exists) return;
                   if (doc.data()?.paymentStatus === "paid" && newStatus === "paid") return; // idempotence
                   
                   tx.update(bookingRef!, { 
                      paymentStatus: newStatus, 
                      paymentId: String(id) 
                   });
                });
             }
          }

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
         // Bezpečnostní kontrola
         const cronSecret = process.env.CRON_SECRET;
         if (!cronSecret) {
             console.error("CRON_SECRET is not configured on the server.");
             return res.status(500).json({ error: "Server configuration error" });
         }

         const authHeader = req.headers.authorization;
         if (authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).send("Unauthorized");
         }

         if (!getApps().length) {
            return res.status(500).json({ error: "Firebase Admin is not initialized" });
         }

         const db = getFirestore(FIRESTORE_DB_ID);
         const pendingBookingsSnap = await db.collection('bookings')
            .where('paymentStatus', '==', 'pending_future')
            .get();

         let processedCount = 0;
         const today = new Date();

         for (const doc of pendingBookingsSnap.docs) {
             const booking = doc.data();
             const bDate = new Date(booking.date);
             const daysToReservation = (bDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

             if (daysToReservation <= 120) {
                 const targetEmail = booking.clientEmail || 'mirek.saba@gmail.com';
                 const paymentLink = `https://rezervace.centrumunity.cz/#/pay/${doc.id}`;
                 
                 const emailHtml = `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                        <h2 style="color: #4f46e5;">Výzva k platbě rezervace - Centrum Unity</h2>
                        <p>Dobrý den,</p>
                        <p>blíží se termín Vaší rezervace. Nyní je možné ji uhradit online.</p>
                        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <p><strong>Datum:</strong> ${booking.date}</p>
                            <p><strong>Částka k úhradě:</strong> ${booking.price} Kč</p>
                        </div>
                        <a href="${paymentLink}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Zaplatit online</a>
                        <p style="margin-top: 20px;">Těšíme se na Vás,<br>Sólás Holistic Studio & Centrum Unity</p>
                    </div>
                 `;

                 // Odešleme notifikaci e-mailem
                 await getResend().emails.send({
                    from: 'rezervace@centrumunity.cz',
                    to: targetEmail,
                    subject: 'Výzva k platbě rezervace - Centrum Unity',
                    html: emailHtml
                 });

                 // Změníme status
                 await doc.ref.update({ paymentStatus: 'unpaid' });
                 processedCount++;
             }
         }

         console.log(`Cron check-future-payments proběhl. Zpracováno: ${processedCount}`);
         res.json({ success: true, processedCount });
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

  // 404 guard for /api routes
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

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
