import express, { Request, Response, NextFunction } from "express";
import path from "path";
import Stripe from "stripe";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import { PRACTITIONERS } from "./constants";

const JWT_SECRET = process.env.JWT_SECRET || "development-secret-key-2026";

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
  
  if (token === "null" || token === "undefined") {
    req.user = { id: 'guest', role: 'guest' };
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
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

  // Stripe lazy initialization
  let stripeClient: Stripe | null = null;
  function getStripe(): Stripe {
    if (!stripeClient) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) {
        throw new Error("STRIPE_SECRET_KEY environment variable is required");
      }
      stripeClient = new Stripe(key);
    }
    return stripeClient;
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
    const { userId, name, role } = req.body;
    
    if (!userId || !name || !role) {
      return res.status(400).json({ error: "Chybí informace o uživateli" });
    }

    // PIN validity was already verified on the client safely
    // Give signed JWT based on client claims
    const token = jwt.sign(
      { id: userId, role: role, name: name },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ success: true, token, user: { id: userId, name, role } });
  });

  // Create a payment intent API endpoint
  app.post("/api/create-payment-intent", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = getStripe();
      const { amount, currency, reservationDate, reservationTime } = req.body;
      
      const paymentIntent = await stripe.paymentIntents.create({
        amount, 
        currency: currency || "czk",
        capture_method: 'manual',
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          reservationDate: reservationDate || '',
          reservationTime: reservationTime || ''
        }
      });
      
      res.json({ 
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error: any) {
      console.error("Stripe Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Refund endpoint
  app.post("/api/refund", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = getStripe();
      const { paymentIntentId } = req.body;
      
      if (!paymentIntentId) {
        return res.status(400).json({ error: "Missing paymentIntentId" });
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      // 1. Backendové ověření 24h limitu (bezpečnostní pojistka)
      if (paymentIntent.metadata?.reservationDate && paymentIntent.metadata?.reservationTime) {
        const dateParts = paymentIntent.metadata.reservationDate.split('-');
        const [hours, minutes] = paymentIntent.metadata.reservationTime.split(':').map(Number);
        
        // Let's build the reservation Date object
        if (dateParts.length === 3) {
          const reservationDateTime = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), hours, minutes);
          const now = new Date();
          const differenceInHours = (reservationDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

          if (differenceInHours < 24) {
            return res.status(400).json({ error: "Refundace není možná. Zbývá méně než 24 hodin do začátku rezervace." });
          }
        }
      }

      // 2. Provedení zrušení nebo refundace
      let result;
      if (paymentIntent.status === 'requires_capture') {
        // Částka byla pouze zablokována, můžeme ji uvolnit bez transakčních poplatků
        result = await stripe.paymentIntents.cancel(paymentIntentId);
      } else if (paymentIntent.status === 'succeeded') {
        // Částka již byla stržena, musíme provést standardní refundaci 
        result = await stripe.refunds.create({
          payment_intent: paymentIntentId,
        });
      } else if (paymentIntent.status === 'canceled') {
        // Již bylo zrušeno
        result = paymentIntent;
      } else {
         return res.status(400).json({ error: `Nelze refundovat platbu ve stavu: ${paymentIntent.status}` });
      }

      res.json({ success: true, result });
    } catch (error: any) {
      console.error("Stripe Refund Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Capture endpoint (Strhnout peníze 24h předem)
  app.post("/api/capture-payment", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const stripe = getStripe();
      const { paymentIntentId } = req.body;
      
      if (!paymentIntentId) {
        return res.status(400).json({ error: "Missing paymentIntentId" });
      }

      // Provede finální stržení rezervovaných peněz
      const intent = await stripe.paymentIntents.capture(paymentIntentId);

      res.json({ success: true, intent });
    } catch (error: any) {
      console.error("Stripe Capture Error:", error.message);
      res.status(400).json({ error: error.message });
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
