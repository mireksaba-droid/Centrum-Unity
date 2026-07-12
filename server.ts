import "dotenv/config"; // Načte proměnné z .env do process.env (musí být úplně první)
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import jwt from "jsonwebtoken";

import { runTransaction, getDoc, DocumentReference, db, collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch } from "./server-firebase";
import firebaseConfig from "./firebase-applet-config.json";



import { PRACTITIONERS } from "./constants";
import { calculateRentalPrice } from "./utils/scheduler";
import { generatePaymentRequestEmail, generateConfirmationEmail, generateCancellationEmail, generateAdminDailySummaryEmail } from "./utils/emailTemplates";

async function safeJson(res: any) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.error("Non-JSON response received:", text);
    throw new Error(`Neplatná odpověď: ${text.substring(0, 150)}`);
  }
}

// Initialize Firebase Admin if not already initialized


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

  app.set("trust proxy", 1); // správná klientská IP za reverzní proxy (rate limiting)
  app.use(express.json());

  // Diagnostika prostředí při startu - vypíše, které proměnné jsou načtené (nikdy jejich hodnoty).
  const envSet = (name: string) => (process.env[name] && String(process.env[name]).trim() ? "✓ nastaveno" : "✗ CHYBÍ");
  console.log("=== Konfigurace prostředí (env) ===");
  console.log("  GOPAY_GOID:          ", envSet("GOPAY_GOID"));
  console.log("  GOPAY_CLIENT_ID:     ", envSet("GOPAY_CLIENT_ID"));
  console.log("  GOPAY_CLIENT_SECRET: ", envSet("GOPAY_CLIENT_SECRET"));
  console.log("  GoPay režim:         ", process.env.GOPAY_ENV === "production" ? "PRODUCTION" : "sandbox");
  console.log("  RESEND_API_KEY:      ", envSet("RESEND_API_KEY"));
  console.log("  SMTP_HOST/USER/PASS: ", envSet("SMTP_HOST"), "/", envSet("SMTP_USER"), "/", envSet("SMTP_PASS"));
  console.log("  Odesílání e-mailů:   ", process.env.RESEND_API_KEY ? "Resend (API)" : (process.env.SMTP_HOST ? "SMTP" : "VYPNUTO"));
  console.log("  JWT_SECRET:          ", envSet("JWT_SECRET"));
  console.log("  CRON_SECRET:         ", envSet("CRON_SECRET"));
  console.log("===================================");
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.error("JSON Parse error:", err);
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    next(err);
  });

  // GoPay API base URL - přepínatelné přes env (GOPAY_ENV=production nebo přímo GOPAY_API_URL)
  const GOPAY_URL = process.env.GOPAY_API_URL
    || (process.env.GOPAY_ENV === "production"
        ? "https://gate.gopay.cz/api"
        : "https://gw.sandbox.gopay.com/api");

  // Veřejná adresa TÉTO aplikace - kam GoPay posílá webhook a návrat z platby.
  // MUSÍ ukazovat na tento běžící server (na Renderu např. https://vase-sluzba.onrender.com),
  // jinak webhook nedorazí a potvrzení po platbě se neodešle.
  // Pojistka: ořízneme mezery/lomítka a doplníme https://, když chybí schéma
  // (GoPay jinak notification_url odmítne jako neplatnou).
  const rawBaseUrl = (process.env.APP_BASE_URL || "https://rezervace.centrumunity.cz").trim().replace(/\/+$/, "");
  const APP_BASE_URL = /^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `https://${rawBaseUrl}`;

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
    const data = await safeJson(response);
    return data.access_token as string;
  }

  // SMTP (nodemailer) lazy initialization - webkitty.eu / vlastní poštovní server
  let mailTransporter: nodemailer.Transporter | null = null;
  function getMailer(): nodemailer.Transporter {
    if (!mailTransporter) {
      const host = process.env.SMTP_HOST;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      if (!host || !user || !pass) {
        throw new Error("SMTP_HOST, SMTP_USER a SMTP_PASS musí být nastaveny v proměnných prostředí.");
      }
      const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465;
      mailTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // 465 = SSL/TLS, 587 = STARTTLS
        auth: { user, pass },
      });
    }
    return mailTransporter;
  }

  // Odesílací adresa
  const getFromEmail = () => process.env.FROM_EMAIL || process.env.SMTP_USER || "info@centrumunity.cz";

  // Resend (HTTPS API) - spolehlivé odesílání z cloudu (Render). Použije se přednostně,
  // když je nastaven RESEND_API_KEY; jinak se použije SMTP (nodemailer) jako záloha.
  let resendClient: Resend | null = null;
  const getResend = (): Resend => (resendClient ||= new Resend(process.env.RESEND_API_KEY));

  // Je nakonfigurované aspoň jedno odesílání e-mailů?
  const emailConfigured = (): boolean =>
    !!(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));

  // Jednotné odeslání e-mailu: přednostně Resend, jinak SMTP.
  async function sendEmail(opts: { to: string | string[]; subject: string; html: string }): Promise<{ id?: string }> {
    if (process.env.RESEND_API_KEY) {
      const { data, error } = await getResend().emails.send({
        from: getFromEmail(),
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
      });
      if (error) throw new Error((error as any).message || JSON.stringify(error));
      return { id: (data as any)?.id };
    }
    const info = await getMailer().sendMail({
      from: getFromEmail(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { id: info.messageId };
  }

  // --- Sdílené platební helpery ---
  const isAdmin = (req: AuthRequest) => req.user?.role === "ADMIN";

  // Načte rezervaci z Firestore; vrací { ref, data } nebo null
  async function loadBooking(bookingId: string): Promise<{ ref: DocumentReference, data: any } | null> {
    const ref = doc(db, "bookings", bookingId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { ref, data: snap.data() };
  }

  // Očekávaná částka v haléřích počítaná POUZE z uložené rezervace (nikdy z klientského vstupu)
  const expectedAmountHaler = (b: any): number =>
    Math.round(calculateRentalPrice(b?.bookedByUserId || "", b?.durationMinutes || 0, b?.room) * 100);

  // E-mail lektora podle jeho ID (z kolekce practitioners)
  async function getPractitionerEmail(userId?: string): Promise<string> {
    if (!userId || userId === "guest") return "";
    try {
      const snap = await getDoc(doc(db, "practitioners", userId));
      if (snap.exists()) {
        const email = (snap.data() as any)?.email;
        if (typeof email === "string" && email.trim()) return email.trim();
      }
    } catch { /* ignore */ }
    // Fallback na seed konstanty (kdyby v DB e-mail chyběl)
    const seed = (PRACTITIONERS as any[]).find((p) => p.id === userId);
    return seed && typeof seed.email === "string" ? seed.email.trim() : "";
  }

  // Příjemci e-mailů k rezervaci: klient (pokud vyplněn) + lektor, který ji vytvořil. Bez duplicit.
  async function recipientsFor(bookingData: any): Promise<string[]> {
    const set = new Set<string>();
    if (bookingData?.clientEmail) set.add(String(bookingData.clientEmail).trim());
    const practitionerEmail = await getPractitionerEmail(bookingData?.bookedByUserId);
    if (practitionerEmail) set.add(practitionerEmail);
    return Array.from(set).filter(Boolean);
  }

  // --- API Routes ---
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Admin endpoint for completely resetting database data (bookings, events, registrations)
  app.delete("/api/admin/reset-data", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
         return res.status(403).json({ error: "Nedostatečná oprávnění. Pouze admin." });
      }

      const deleteCollection = async (collectionPath: string) => {
         const snapshot = await getDocs(collection(db, collectionPath));
         const batch = writeBatch(db);
         snapshot.docs.forEach((d) => {
            batch.delete(d.ref);
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

  // Admin endpoint: přepíše lektory v databázi daty z konfigurace (constants.ts / Excel).
  // Použije se po úpravě seznamu lektorů, aby se změny (PIN, e-mail, fotka, role) projevily,
  // protože aplikace čte lektory primárně z databáze.
  app.post("/api/admin/sync-practitioners", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdmin(req)) {
        return res.status(403).json({ error: "Nedostatečná oprávnění. Pouze admin." });
      }
      const list = PRACTITIONERS as any[];
      const keepIds = new Set(list.map((p) => p.id));
      const existing = await getDocs(collection(db, "practitioners"));
      const batch = writeBatch(db);
      // Smažeme lektory, kteří nejsou v konfiguraci (nejsou v tabulce)
      let removed = 0;
      existing.docs.forEach((d) => {
        if (!keepIds.has(d.id)) { batch.delete(d.ref); removed++; }
      });
      // Zapíšeme/aktualizujeme lektory z konfigurace
      for (const p of list) {
        batch.set(doc(db, "practitioners", p.id), p);
      }
      await batch.commit();
      console.log(`[Admin] ${req.user.name} synchronizoval ${list.length} lektorů (odebráno ${removed}).`);
      res.json({ success: true, count: list.length, removed });
    } catch (error: any) {
      console.error("Sync Practitioners Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Login endpoint - PIN se ověřuje na SERVERU (ne v prohlížeči).
  // Jméno a role se berou z uloženého záznamu, ne od klienta (nejde je podvrhnout).
  app.post("/api/login", async (req, res) => {
    try {
      const { userId, pin } = req.body;

      if (!userId || pin === undefined || pin === null || String(pin).length === 0) {
        return res.status(400).json({ error: "Chybí ID uživatele nebo PIN" });
      }

      // Najdeme uživatele: primárně z databáze (admin mohl PIN změnit), jinak ze seed konstant.
      let record: any = null;
      try {
        const snap = await getDoc(doc(db, "practitioners", String(userId)));
        if (snap.exists()) record = snap.data();
      } catch (e) {
        // pokud DB selže, zkusíme fallback níže
      }
      if (!record) {
        record = (PRACTITIONERS as any[]).find((p) => p.id === userId) || null;
      }

      if (!record || record.pin === undefined) {
        return res.status(401).json({ error: "Neplatné přihlášení." });
      }

      // Vlastní ověření PINu na serveru
      if (String(record.pin) !== String(pin)) {
        return res.status(401).json({ error: "Nesprávný PIN." });
      }

      const token = jwt.sign(
        { id: userId, role: record.role, name: record.name },
        getJwtSecret(),
        { expiresIn: "1d" }
      );

      res.json({ success: true, token, user: { id: userId, name: record.name, role: record.role } });
    } catch (error: any) {
      console.error("Login Error:", error);
      res.status(500).json({ error: "Interní chyba serveru" });
    }
  });

  // AI Chat endpoint
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      res.status(r.status).json(await r.json());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Get practitioners (public info only, no PIN)
  app.get("/api/practitioners", async (req, res) => {
    try {
      const snap = await getDocs(collection(db, "practitioners"));
      const practitioners = snap.docs.map(doc => {
         const data = doc.data();
         // Odstraníme PIN z veřejného výstupu
         const { pin, ...publicData } = data;
         return { id: doc.id, ...publicData };
      });
      res.json(practitioners);
    } catch (error: any) {
      console.error("Error fetching practitioners:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Save/Update practitioner (Admin only)
  app.post("/api/practitioners", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });
      const practitioner = req.body;
      if (!practitioner.id) return res.status(400).json({ error: "Missing ID" });
      
      await setDoc(doc(db, "practitioners", practitioner.id), practitioner, { merge: true });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Delete practitioner (Admin only)
  app.delete("/api/practitioners/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: "Unauthorized" });
      const { id } = req.params;
      if (id === "admin" || id === "guest") {
        return res.status(400).json({ error: "Profil administrátora a hosta nelze smazat." });
      }
      await deleteDoc(doc(db, "practitioners", String(id)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Create booking
  app.post("/api/bookings", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const booking = req.body;
      if (!booking.id) return res.status(400).json({ error: "Missing ID" });
      
      
      const bookingRef = doc(db, "bookings", booking.id);
      
      await runTransaction(db, async (transaction: any) => {
          const bookingDoc = await transaction.get(bookingRef);
          if (bookingDoc.exists()) {
              const existing = bookingDoc.data() || {};
              // Zrušené / refundované termíny lze znovu obsadit; blokujeme jen aktivní rezervace.
              if (!['cancelled', 'refunded'].includes(existing.status)) {
                  throw new Error("Tento termín je již rezervován. Prosím, obnovte stránku a vyberte jiný čas.");
              }
          }
          transaction.set(bookingRef, booking);
      });
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error creating booking:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Update booking
  app.put("/api/bookings/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const data = req.body;
      
      await updateDoc(doc(db, "bookings", String(id)), data);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating booking:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete booking
  app.delete("/api/bookings/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      
      await deleteDoc(doc(db, "bookings", String(id)));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting booking:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Group Events
  app.post("/api/groupEvents", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });
      const event = req.body;
      
      await setDoc(doc(db, "groupEvents", String(event.id)), event, { merge: true });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/groupEvents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });
      const { id } = req.params;
      const data = req.body;
      
      await updateDoc(doc(db, "groupEvents", String(id)), data);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/groupEvents/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Unauthorized" });
      const { id } = req.params;
      
      await deleteDoc(doc(db, "groupEvents", String(id)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Event Registrations
  app.post("/api/eventRegistrations", async (req: Request, res: Response) => {
    try {
      const registration = req.body;
      
      
      await runTransaction(db, async (transaction: any) => {
          const eventRef = doc(db, "groupEvents", registration.eventId);
          const eventDoc = await transaction.get(eventRef);

          if (!eventDoc.exists) throw new Error("Event does not exist!");

          const currentRegistrations = eventDoc.data()?.currentRegistrations || 0;
          const capacity = eventDoc.data()?.capacity || 0;

          if (currentRegistrations >= capacity) throw new Error("Capacity full");

          const newRegRef = doc(db, "eventRegistrations", registration.id || doc(collection(db, "eventRegistrations")).id);
          
          transaction.set(newRegRef, { ...registration, id: newRegRef.id });
          transaction.update(eventRef, { currentRegistrations: currentRegistrations + 1 });
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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

      const { returnUrl, bookingId } = req.body;

      if (!bookingId) {
        return res.status(400).json({ error: "Chybí identifikátor rezervace (bookingId)." });
      }

      // 1. Načteme rezervaci z DB - všechny cenotvorné údaje bereme POUZE odsud (nikdy z klienta)
      const booking = await loadBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ error: "Rezervace nebyla nalezena." });
      }
      if (booking.data.status === 'paid') {
        return res.status(400).json({ error: "Tato rezervace je již zaplacena." });
      }

      const durationMinutes = booking.data.durationMinutes;
      const room = booking.data.room;
      const bookedByUserId = booking.data.bookedByUserId || '';
      const reservationDate = booking.data.date || '';
      const reservationTime = booking.data.time || '';

      const amount = expectedAmountHaler(booking.data);

      // 2. Rezervace zdarma (např. admin) - žádná platba, rovnou paid
      if (amount <= 0) {
        await updateDoc(booking.ref, { status: 'paid' });
        return res.json({ paid: true, message: "Rezervace nevyžaduje platbu." });
      }

      const token = await getGoPayToken();

      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: "CZK",
          order_number: bookingId,
          order_description: `Rezervace místnosti ${room} (${bookingId})`,
          items: [{ name: `Pronájem místnosti ${room} (${durationMinutes} min)`, amount: amount, count: 1 }],
          callback: {
              return_url: returnUrl || `${APP_BASE_URL}/`,
              notification_url: `${APP_BASE_URL}/api/gopay/notify`
          },
          target: {
              type: "ACCOUNT",
              goid: process.env.GOPAY_GOID
          },
          additional_params: [
              { name: "bookingId", value: String(bookingId) },
              { name: "userId", value: String(bookedByUserId) },
              { name: "reservationDate", value: String(reservationDate) },
              { name: "reservationTime", value: String(reservationTime) }
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

      const data = await safeJson(response);

      if (!response.ok) {
         throw new Error("GoPay create payment failed: " + JSON.stringify(data));
      }

      // 3. Zapíšeme paymentId přímo na rezervaci (spolehlivé párování ve webhooku)
      await updateDoc(booking.ref, { paymentId: String(data.id) });

      res.json({
        paymentId: data.id,
        gwUrl: data.gw_url
      });
    } catch (error: any) {
      console.error("GoPay Public Payment Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Create a payment via GoPay (přihlášený uživatel; platí pro už založenou rezervaci)
  app.post("/api/create-payment", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { bookingId, returnUrl } = req.body;

      if (!bookingId) {
        return res.status(400).json({ error: "Chybí identifikátor rezervace (bookingId)." });
      }

      // 1. Načteme rezervaci - cenu i párování bereme jen z DB
      const booking = await loadBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ error: "Rezervace nebyla nalezena." });
      }
      if (booking.data.status === 'paid') {
        return res.status(400).json({ error: "Tato rezervace je již zaplacena." });
      }

      // 2. Ověření vlastnictví: rezervaci může platit její autor, host, nebo admin
      const isOwner = req.user?.id === booking.data.bookedByUserId;
      const isGuestBooking = booking.data.bookedByUserId === 'guest';
      if (!isOwner && !isGuestBooking && !isAdmin(req)) {
        return res.status(403).json({ error: "Nemáte oprávnění platit tuto rezervaci." });
      }

      const durationMinutes = booking.data.durationMinutes;
      const room = booking.data.room;
      const bookedByUserId = booking.data.bookedByUserId || '';
      const reservationDate = booking.data.date || '';
      const reservationTime = booking.data.time || '';

      const amount = expectedAmountHaler(booking.data);

      // 3. Rezervace zdarma → rovnou paid, bez brány
      if (amount <= 0) {
        await updateDoc(booking.ref, { status: 'paid' });
        return res.json({ paid: true, message: "Rezervace nevyžaduje platbu." });
      }

      const token = await getGoPayToken();

      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: "CZK",
          order_number: String(bookingId),
          order_description: `Rezervace místnosti ${room} (${bookingId})`,
          items: [{ name: `Pronájem místnosti ${room} (${durationMinutes} min)`, amount: amount, count: 1 }],
          callback: {
              return_url: returnUrl || `${APP_BASE_URL}/`,
              notification_url: `${APP_BASE_URL}/api/gopay/notify`
          },
          target: {
              type: "ACCOUNT",
              goid: process.env.GOPAY_GOID
          },
          additional_params: [
              { name: "bookingId", value: String(bookingId) },
              { name: "userId", value: String(bookedByUserId) },
              { name: "reservationDate", value: String(reservationDate) },
              { name: "reservationTime", value: String(reservationTime) }
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

      const data = await safeJson(response);

      if (!response.ok) {
         throw new Error("GoPay create payment failed: " + JSON.stringify(data));
      }

      // 4. Zapíšeme paymentId na rezervaci (spolehlivé párování, žádný race s klientem)
      await updateDoc(booking.ref, { paymentId: String(data.id) });

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
      const paymentStatus = await safeJson(statusRes);

      // Údaje z additional_params (userId, bookingId, datum/čas rezervace)
      let paymentUserId = "";
      let paymentBookingId = "";
      let resDate = "";
      let resTime = "";
      if (paymentStatus.additional_params) {
         const get = (name: string) => paymentStatus.additional_params.find((p: any) => p.name === name)?.value || "";
         paymentUserId = get("userId");
         paymentBookingId = get("bookingId");
         resDate = get("reservationDate");
         resTime = get("reservationTime");
      }

      // Ověření vlastnictví: přes uživatele z platby NEBO přes autora rezervace (spolehlivější),
      // plus admin má vždy přístup.
      let bookingOwnerId = "";
      if (paymentBookingId) {
        const b = await loadBooking(paymentBookingId);
        if (b) {
          bookingOwnerId = b.data.bookedByUserId || "";
          if (!resDate) resDate = b.data.date || "";
          if (!resTime) resTime = b.data.time || "";
        }
      }

      const isOwner = !!req.user?.id && (req.user.id === paymentUserId || req.user.id === bookingOwnerId);
      if (!isOwner && !isAdmin(req)) {
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

      // Částku k refundaci nikdy nepřebíráme slepě od klienta - omezíme ji na skutečně zaplacenou
      const paidAmount = Number(paymentStatus.amount) || 0;
      const requested = Number(amount);
      const refundAmount = (Number.isFinite(requested) && requested > 0)
        ? Math.min(requested, paidAmount)
        : paidAmount;

      // Refund the payment
      const refundRes = await fetch(`${GOPAY_URL}/payments/payment/${paymentId}/refund`, {
         method: "POST",
         headers: {
           "Accept": "application/json",
           "Content-Type": "application/x-www-form-urlencoded",
           "Authorization": `Bearer ${token}`
         },
         body: `amount=${refundAmount}`
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
      
      const intent = await safeJson(captureRes);
      
      if (!captureRes.ok) {
         return res.status(400).json({ error: `Nelze strhnout platbu: ${JSON.stringify(intent)}` });
      }

      res.json({ success: true, intent });
    } catch (error: any) {
      console.error("GoPay Capture Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // --- Sdílená rekonciliace platby ---
  // Dotáhne stav z GoPay, spáruje rezervaci, aktualizuje její stav a (jen při skutečném
  // přechodu na 'paid') pošle potvrzovací e-mail. Volá se z webhooku i z návratu na return_url,
  // takže potvrzení dorazí i když GoPay z nějakého důvodu nedoručí webhook.
  // Je idempotentní - opakované volání nepřepíše zaplacenou rezervaci ani nepošle e-mail dvakrát.
  async function reconcilePayment(id: string): Promise<{ state: string }> {
    const token = await getGoPayToken();
    const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${id}`, {
      method: "GET",
      headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` }
    });
    const paymentStatus = await safeJson(statusRes);
    const state: string = paymentStatus.state;

    // Najdeme rezervaci: primárně přes bookingId v additional_params, jinak podle paymentId
    const bookingIdParam = paymentStatus.additional_params?.find((x: any) => x.name === "bookingId")?.value;
    let bookingRef: DocumentReference | null = null;
    let bookingId = bookingIdParam;

    if (bookingId) {
      bookingRef = doc(db, "bookings", bookingId);
    } else {
      const snapshot = await getDocs(query(collection(db, "bookings"), where("paymentId", "==", String(id))));
      if (!snapshot.empty) {
        bookingRef = snapshot.docs[0].ref;
        bookingId = snapshot.docs[0].id;
      }
    }

    if (!bookingRef) {
      console.log(`GoPay reconcile: pro platbu ${id} nenalezena rezervace.`);
      return { state };
    }

    const map: Record<string, string> = {
      PAID: "paid",
      CANCELED: "cancelled",
      TIMEOUTED: "cancelled",
      REFUNDED: "refunded",
    };
    const newStatus = map[state];
    if (!newStatus) return { state };

    let transitionedToPaid = false;
    let amountMismatch = false;

    await runTransaction(db, async (tx: any) => {
      transitionedToPaid = false; // reset pro případ opakování transakce
      amountMismatch = false;
      const snap = await tx.get(bookingRef!);
      if (!snap.exists()) return;
      const current = snap.data() || {};

      // Idempotence: ze stavu 'paid' už nepřecházíme na 'paid' ani zpět na 'cancelled'
      if (current.status === "paid" && (newStatus === "paid" || newStatus === "cancelled")) return;

      // Ověření částky u PAID - nesmí být nižší než očekávaná cena z rezervace
      if (newStatus === "paid") {
        const expected = expectedAmountHaler(current);
        const paid = Number(paymentStatus.amount) || 0;
        if (expected > 0 && paid < expected) {
          amountMismatch = true;
          tx.update(bookingRef!, {
            status: "payment_review",
            paymentId: String(id),
            note: (current.note ? current.note + "\n" : "") + `POZOR: nesoulad částky - zaplaceno ${paid}, očekáváno ${expected} haléřů. Nutná ruční kontrola.`
          });
          return;
        }
      }

      const updateData: any = { status: newStatus, paymentId: String(id) };
      if (newStatus === "cancelled" || newStatus === "refunded") {
        updateData.cancelledAt = new Date().toISOString();
      }
      tx.update(bookingRef!, updateData);
      if (newStatus === "paid") transitionedToPaid = true;
    });

    if (amountMismatch) {
      console.error(`GoPay: nesoulad částky u rezervace ${bookingId}, platba ${id}. Označeno k ruční kontrole.`);
    }

    // Potvrzovací e-mail posíláme JEN když jsme rezervaci právě teď překlopili na 'paid'
    // (ne opakovaně) - tím zajistíme právě jedno odeslání napříč webhookem i návratem z brány.
    if (transitionedToPaid && emailConfigured()) {
      try {
        const finalDoc = await getDoc(bookingRef!);
        const bookingData = finalDoc.data() as any;
        const recipients = await recipientsFor(bookingData); // klient + lektor
        if (recipients.length) {
          await sendEmail({
            to: recipients,
            subject: 'Potvrzení zaplacené rezervace - Centrum Unity',
            html: generateConfirmationEmail(bookingData, true)
          });
          console.log(`Confirmation email sent to ${recipients.join(', ')} for paid booking ${bookingId}`);
        } else {
          console.log(`Booking ${bookingId} zaplacena, ale bez příjemce (klient ani lektor nemá e-mail) - potvrzení neodesláno.`);
        }
      } catch (e: any) {
        console.error("Failed to send confirmation email after payment:", e.message);
      }
    }

    return { state };
  }

  // Webhook pro notifikace z GoPay (změna stavu platby)
  app.all("/api/gopay/notify", async (req: Request, res: Response) => {
      try {
          const id = req.query.id || req.body?.id; // GoPay posílá ID platby v query parametru nebo body
          if (!id) {
             return res.status(400).json({ error: "Missing payment ID" });
          }
          const { state } = await reconcilePayment(String(id));
          console.log(`GoPay Notification - Payment ID: ${id}, State: ${state}`);
          res.send("OK"); // GoPay očekává jakoukoliv HTTP 200 odpověď
      } catch (error: any) {
          console.error("GoPay Webhook Error:", error.message);
          res.status(500).send("Error");
      }
  });

  // Endpoint pro ověření stavu platby po návratu na return_url.
  // Kromě vrácení stavu rovnou provede rekonciliaci (spáruje a případně pošle potvrzení),
  // takže potvrzovací e-mail dorazí i bez webhooku.
  app.get("/api/gopay/status", async (req: Request, res: Response) => {
      try {
          const { id } = req.query;
          if (!id) {
             return res.status(400).json({ error: "Missing payment ID" });
          }
          const { state } = await reconcilePayment(String(id));
          res.json({ state });
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

         const pendingBookingsSnap = await getDocs(query(collection(db, "bookings"), where("status", "==", "deferred_payment")));

         let processedCount = 0;
         const today = new Date();

         for (const doc of pendingBookingsSnap.docs) {
             try {
                 const booking = doc.data();
                 const bDate = new Date(booking.date);
                 const daysToReservation = (bDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);

                 if (daysToReservation <= 120) {
                     const targetEmail = booking.clientEmail;
                     if (!targetEmail) {
                         console.log(`Skipping booking ${doc.id} - no email provided.`);
                         continue;
                     }
                     
                     const emailHtml = generatePaymentRequestEmail(booking, APP_BASE_URL);

                     // Odešleme notifikaci e-mailem
                     await sendEmail({
                        to: targetEmail,
                        subject: 'Výzva k platbě rezervace - Centrum Unity',
                        html: emailHtml
                     });

                     // Změníme status a označíme čas odeslání výzvy (od něj běží 24h okno na platbu)
                     await updateDoc(doc.ref, { status: 'awaiting_payment', paymentRequestedAt: new Date().toISOString() });
                     processedCount++;
                 }
             } catch (e: any) {
                 console.error(`Cron: chyba u rezervace ${doc.id}:`, e);
             }
         }

         console.log(`Cron check-future-payments proběhl. Zpracováno: ${processedCount}`);
         res.json({ success: true, processedCount });
     } catch (error: any) {
         console.error("Cron Error:", error.message);
         res.status(500).send("Error");
     }
  });

  // Cron endpoint: denní souhrn pro admina (nové + zrušené rezervace za posledních 24 h).
  // Spouštět např. z Google Cloud Scheduleru 1x denně s hlavičkou Authorization: Bearer <CRON_SECRET>.
  app.post("/api/cron/daily-summary", async (req: Request, res: Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      if (!cronSecret) {
        console.error("CRON_SECRET is not configured on the server.");
        return res.status(500).json({ error: "Server configuration error" });
      }
      if (req.headers.authorization !== `Bearer ${cronSecret}`) {
        return res.status(401).send("Unauthorized");
      }

      const hours = Number(req.body?.hours) > 0 ? Number(req.body.hours) : 24;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const snap = await getDocs(collection(db, "bookings"));
      const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      const newBookings = all
        .filter((b) => b.createdAt && b.createdAt >= cutoff)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const cancelledBookings = all
        .filter((b) => b.cancelledAt && b.cancelledAt >= cutoff && (b.status === "cancelled" || b.status === "refunded"))
        .sort((a, b) => (a.cancelledAt < b.cancelledAt ? 1 : -1));

      // Když se nic nestalo, e-mail neposíláme
      if (newBookings.length === 0 && cancelledBookings.length === 0) {
        return res.json({ success: true, sent: false, newCount: 0, cancelledCount: 0 });
      }

      const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL
        || await getPractitionerEmail("admin")
        || getFromEmail();

      if (emailConfigured() && adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `Denní souhrn rezervací – Centrum Unity (${newBookings.length} nových, ${cancelledBookings.length} zrušených)`,
          html: generateAdminDailySummaryEmail(newBookings, cancelledBookings, `za posledních ${hours} h`)
        });
      }

      console.log(`Daily summary sent: ${newBookings.length} new, ${cancelledBookings.length} cancelled → ${adminEmail}`);
      res.json({ success: true, sent: true, newCount: newBookings.length, cancelledCount: cancelledBookings.length });
    } catch (error: any) {
      console.error("Daily Summary Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Send an email
  app.post("/api/send-email", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { to, subject, html } = req.body;

      if (!emailConfigured()) {
        console.log("E-mail není nakonfigurován (Resend ani SMTP). Mockuji odeslání:");
        console.log(`To: ${to}\nSubject: ${subject}`);
        return res.json({ success: true, mocked: true });
      }

      const info = await sendEmail({ to, subject, html });

      res.json({ success: true, data: { id: info.id } });
    } catch (error: any) {
      console.error("Email Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Testovací endpoint pro ověření SMTP (jen admin) - pošle ukázkový potvrzovací e-mail
  app.post("/api/test-email", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (req.user?.role !== "ADMIN") {
        return res.status(403).json({ error: "Pouze admin může posílat testovací e-maily." });
      }

      const to = req.body?.to || process.env.FROM_EMAIL || process.env.SMTP_USER;
      if (!to) {
        return res.status(400).json({ error: "Chybí cílová e-mailová adresa (to)." });
      }

      // Ukázková rezervace
      const sampleBooking = {
        id: "TEST-" + Date.now(),
        bookedByName: "Testovací rezervace",
        clientName: req.user?.name || "Eva",
        date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        time: "17:00",
        durationMinutes: 90,
        room: 2 as const,
        equipment: "futon" as const,
        price: 525,
      };

      const html = generateConfirmationEmail(sampleBooking, true);

      if (!emailConfigured()) {
        console.log("E-mail není nakonfigurován - test nebyl odeslán.");
        return res.json({ success: false, mocked: true, message: "Není nastaven ani Resend, ani SMTP." });
      }

      const info = await sendEmail({
        to,
        subject: "TEST – Potvrzení rezervace | Centrum Unity",
        html,
      });

      res.json({ success: true, messageId: info.id, to });
    } catch (error: any) {
      console.error("Test Email Error:", error.message);
      res.status(400).json({ error: error.message });
    }
  });

  // Veřejný endpoint pro odeslání storno e-mailu (pro hosty bez přihlášení).
  // Bezpečné: nepřijímá cílovou adresu ani obsah - vše bere z rezervace v DB
  // a pošle jen tehdy, když je rezervace skutečně zrušená. Rate-limitováno.
  app.post("/api/public-cancellation-email", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const key = "cancel:" + ip;
      const limit = paymentRateLimits.get(key);
      if (limit && limit.resetTime > now) {
        if (limit.count >= 5) return res.status(429).json({ error: "Příliš mnoho požadavků." });
        limit.count++;
      } else {
        paymentRateLimits.set(key, { count: 1, resetTime: now + 60000 });
      }

      const { bookingId } = req.body;
      if (!bookingId) return res.status(400).json({ error: "Chybí bookingId" });

      const booking = await loadBooking(bookingId);
      // Pošleme jen po skutečném zrušení a jen na e-mail uložený u rezervace
      if (!booking || booking.data.status !== 'cancelled' || !booking.data.clientEmail) {
        return res.json({ skipped: true });
      }

      if (emailConfigured()) {
        await sendEmail({
          to: booking.data.clientEmail,
          subject: 'Zrušení rezervace - Centrum Unity',
          html: generateCancellationEmail(booking.data, "Rezervace byla zrušena na Vaši žádost.")
        });
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Public Cancellation Email Error:", error.message);
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

  // Start background job to expire unpaid bookings.
  // Dvě různá okna:
  //   - Okamžitá online platba (jen createdAt, bez paymentRequestedAt): 15 minut na bráně.
  //   - E-mailová výzva k platbě (paymentRequestedAt nastaven): 24 hodin, pak storno + e-mail o zrušení.
  setInterval(async () => {
    if (!db) return;
    try {
      const now = Date.now();
      const fifteenMinutesAgo = new Date(now - 15 * 60 * 1000).toISOString();
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

      const snapshot = await getDocs(query(collection(db, "bookings"), where("status", "==", "awaiting_payment")));
      if (snapshot.empty) return;

      const batch = writeBatch(db);
      let count = 0;
      const toNotify: any[] = []; // rezervace s výzvou k platbě, u kterých pošleme storno e-mail

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.status !== 'awaiting_payment') return;

        let expired = false;
        if (data.paymentRequestedAt) {
          // E-mailová výzva k platbě → 24h okno
          expired = data.paymentRequestedAt < twentyFourHoursAgo;
        } else if (data.createdAt) {
          // Okamžitý online flow → 15min okno
          expired = data.createdAt < fifteenMinutesAgo;
        }

        if (expired) {
          batch.update(doc.ref, {
             status: 'cancelled',
             cancelledAt: new Date().toISOString(),
             note: (data.note ? data.note + '\n' : '') + 'Automaticky zrušeno - platba nebyla uhrazena včas.'
          });
          count++;
          if (data.paymentRequestedAt) {
             toNotify.push({ id: doc.id, ...data });
          }
        }
      });

      if (count > 0) {
        await batch.commit();
        console.log(`Automatically cancelled ${count} expired pending bookings`);

        // Best-effort: pošleme storno e-maily (klientovi i lektorovi), kterým vypršela výzva k platbě
        for (const booking of toNotify) {
          try {
            if (emailConfigured()) {
              const recipients = await recipientsFor(booking);
              if (recipients.length) {
                await sendEmail({
                  to: recipients,
                  subject: 'Zrušení rezervace - Centrum Unity',
                  html: generateCancellationEmail(booking),
                });
              }
            }
          } catch (mailErr: any) {
            console.error(`Nepodařilo se odeslat storno e-mail pro rezervaci ${booking.id}:`, mailErr.message);
          }
        }
      }
    } catch (e) {
      console.error("Failed to run booking cleanup job:", e);
    }
  }, 60 * 1000); // Check every minute

  app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
