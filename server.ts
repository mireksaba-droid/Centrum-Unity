import "dotenv/config"; // Načte proměnné z .env do process.env (musí být úplně první)
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import jwt from "jsonwebtoken";
import crypto from "crypto";

import { runTransaction, getDoc, DocumentReference, db, collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch } from "./server-firebase";
import firebaseConfig from "./firebase-applet-config.json";



import { Booking } from "./types";
import { PRACTITIONERS } from "./constants";
import { calculateRentalPrice, checkBookingCollision } from "./utils/scheduler";
import { generatePaymentRequestEmail, generateConfirmationEmail, generateCancellationEmail, generateAdminDailySummaryEmail, generatePaymentReminderEmail, generateEventRegistrationConfirmationEmail, generateEventRegistrationCancellationEmail, generateAdminEventRegistrationNotificationEmail, generateAdminEventCancellationNotificationEmail } from "./utils/emailTemplates";

async function safeJson(res: any) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.error("Non-JSON response received:", text);
    throw new Error(`Neplatná odpověď: ${text.substring(0, 150)}`);
  }
}

async function enrichEventData(eventData: any) {
  if (!eventData) return eventData;
  if (!eventData.practitionerName && eventData.practitionerId) {
    if (eventData.practitionerId === 'guest' || eventData.practitionerId === 'external') {
      eventData.practitionerName = 'Externí lektor';
      return eventData;
    }
    try {
      const pDoc = await getDoc(doc(db, "practitioners", String(eventData.practitionerId)));
      if (pDoc.exists()) {
        const pName = (pDoc.data() as any).name;
        eventData.practitionerName = (pName === 'Host / Externista') ? 'Externí lektor' : pName;
      } else {
        const found = PRACTITIONERS.find(p => p.id === eventData.practitionerId);
        eventData.practitionerName = found ? (found.id === 'guest' ? 'Externí lektor' : found.name) : (eventData.practitionerId === 'admin' ? 'Eva' : eventData.practitionerId);
      }
    } catch {
      const found = PRACTITIONERS.find(p => p.id === eventData.practitionerId);
      eventData.practitionerName = found ? (found.id === 'guest' ? 'Externí lektor' : found.name) : (eventData.practitionerId === 'admin' ? 'Eva' : eventData.practitionerId);
    }
  }
  return eventData;
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
  // Vyčistí příjemce: rozdělí čárkou spojené adresy, ořízne mezery, ověří formát a odstraní duplicity.
  const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
  function normalizeRecipients(to: string | string[]): string[] {
    const raw = Array.isArray(to) ? to : [to];
    const out: string[] = [];
    for (const item of raw) {
      for (const part of String(item ?? "").split(",")) {
        const e = part.trim();
        if (!e) continue;
        if (EMAIL_RE.test(e)) out.push(e);
        else console.warn(`sendEmail: přeskakuji neplatnou e-mailovou adresu "${e}"`);
      }
    }
    return Array.from(new Set(out));
  }

  async function sendEmail(opts: { to: string | string[]; subject: string; html: string }): Promise<{ id?: string }> {
    const toList = normalizeRecipients(opts.to);
    if (!toList.length) {
      throw new Error(`Žádný platný příjemce e-mailu (vstup: ${JSON.stringify(opts.to)})`);
    }
    if (process.env.RESEND_API_KEY) {
      const { data, error } = await getResend().emails.send({
        from: getFromEmail(),
        to: toList,
        subject: opts.subject,
        html: opts.html,
      });
      if (error) throw new Error((error as any).message || JSON.stringify(error));
      return { id: (data as any)?.id };
    }
    const info = await getMailer().sendMail({
      from: getFromEmail(),
      to: toList.join(", "),
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

  // E-mail administrátora pro notifikace (priorita: ADMIN_NOTIFICATION_EMAIL -> profil 'admin' -> kadlecova-eva@seznam.cz)
  async function getAdminNotificationEmail(): Promise<string> {
    if (process.env.ADMIN_NOTIFICATION_EMAIL && process.env.ADMIN_NOTIFICATION_EMAIL.trim()) {
      return process.env.ADMIN_NOTIFICATION_EMAIL.trim();
    }
    const adminEmail = await getPractitionerEmail("admin");
    if (adminEmail && adminEmail.trim()) {
      return adminEmail.trim();
    }
    return "kadlecova-eva@seznam.cz";
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
      const existingById = new Map(existing.docs.map((d) => [d.id, d.data() as any]));
      const batch = writeBatch(db);
      // Smažeme lektory, kteří nejsou v konfiguraci (nejsou v tabulce)
      let removed = 0;
      existing.docs.forEach((d) => {
        if (!keepIds.has(d.id)) { batch.delete(d.ref); removed++; }
      });
      // Zapíšeme/aktualizujeme lektory z konfigurace.
      // Fotku admin-nahranou v aplikaci (base64) zachováme, ať ji sync nepřepíše.
      for (const p of list) {
        const cur = existingById.get(p.id);
        const keepImg = cur && typeof cur.imageUrl === "string" && cur.imageUrl.startsWith("data:image/");
        const toWrite = keepImg ? { ...p, imageUrl: cur.imageUrl } : p;
        batch.set(doc(db, "practitioners", p.id), toWrite);
      }
      await batch.commit();
      console.log(`[Admin] ${req.user.name} synchronizoval ${list.length} lektorů (odebráno ${removed}).`);
      res.json({ success: true, count: list.length, removed });
    } catch (error: any) {
      console.error("Sync Practitioners Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: pošle lektorovi výzvu k platbě k existující rezervaci a spustí 24h okno.
  // Rezervaci nastaví na 'awaiting_payment' + paymentRequestedAt = teď (od toho běží lhůta i připomínka).
  app.post("/api/admin/request-payment", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: "Nedostatečná oprávnění. Pouze admin." });
      const { bookingId } = req.body;
      if (!bookingId) return res.status(400).json({ error: "Chybí bookingId." });

      const booking = await loadBooking(bookingId);
      if (!booking) return res.status(404).json({ error: "Rezervace nebyla nalezena." });
      if (booking.data.status === "paid") return res.status(400).json({ error: "Rezervace je již zaplacena." });

      // Příjemci = lektor (a případně klient), musí existovat aspoň jedna adresa
      const recipients = await recipientsFor(booking.data);
      if (!recipients.length) {
        return res.status(400).json({ error: "Lektor nemá vyplněný e-mail, není kam poslat výzvu." });
      }

      const now = new Date().toISOString();
      await updateDoc(booking.ref, {
        status: "awaiting_payment",
        paymentRequestedAt: now,
        reminderSentAt: null
      });

      if (emailConfigured()) {
        await sendEmail({
          to: recipients,
          subject: "Výzva k platbě rezervace - Centrum Unity",
          html: generatePaymentRequestEmail({ ...booking.data, id: bookingId }, APP_BASE_URL)
        });
      }

      console.log(`[Admin] ${req.user.name} poslal výzvu k platbě pro rezervaci ${bookingId} → ${recipients.join(", ")}`);
      res.json({ success: true, recipients });
    } catch (error: any) {
      console.error("Request Payment Error:", error.message);
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

  // Get practitioners (public info only, unless authenticated as ADMIN)
  app.get("/api/practitioners", async (req, res) => {
    try {
      let showPins = false;
      const authHeader = req.headers["authorization"];
      const token = authHeader && authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, getJwtSecret()) as any;
          if (decoded && decoded.role === "ADMIN") {
            showPins = true;
          }
        } catch (e) {
          // Ignore invalid tokens and return public data only
        }
      }

      const snap = await getDocs(collection(db, "practitioners"));
      const practitioners = snap.docs.map(doc => {
         const data = doc.data();
         if (showPins) {
           return { id: doc.id, ...data };
         } else {
           const { pin, ...publicData } = data;
           return { id: doc.id, ...publicData };
         }
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
      if (!booking.id || !booking.date || !booking.time || !booking.room) {
        return res.status(400).json({ error: "Chybí povinné údaje rezervace (ID, datum, čas, místnost)." });
      }
      
      const bookingRef = doc(db, "bookings", String(booking.id));

      // 1. Zkontrolujeme kolize s existujícími rezervacemi na daný den (překryv délky a povinné pauzy).
      // Pravidlo přednosti: dříve vytvořená rezervace má vždy přednost.
      const q = query(collection(db, "bookings"), where("date", "==", booking.date));
      const snapshot = await getDocs(q);
      const existingBookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Booking[];

      const durationMinutes = Number(booking.durationMinutes) || 60;
      const room = Number(booking.room) as 1 | 2;
      const userId = booking.bookedByUserId || (req.user ? req.user.id : 'guest');

      const collision = checkBookingCollision({
        newDate: booking.date,
        newTime: booking.time,
        durationMinutes,
        room,
        userId,
        allBookings: existingBookings,
        excludeBookingId: booking.id
      });

      if (collision.hasCollision) {
        const conflictName = collision.conflictingBooking?.bookedByName || 'jiným lektorem';
        const conflictTime = collision.conflictingBooking ? `${collision.conflictingBooking.time} (${collision.conflictingBooking.durationMinutes} min)` : '';
        return res.status(409).json({ 
          error: `Termín nelze zarezervovat: dochází ke kolizi s dříve vytvořenou rezervací (${conflictName}${conflictTime ? ` v ${conflictTime}` : ''}). První vytvořená rezervace má přednostní právo.` 
        });
      }
      
      await runTransaction(db, async (transaction: any) => {
          const bookingDoc = await transaction.get(bookingRef);
          if (bookingDoc.exists()) {
              const existing = bookingDoc.data() || {};
              // Zrušené / refundované termíny lze znovu obsadit; blokujeme jen aktivní rezervace.
              if (!['cancelled', 'refunded'].includes(existing.status)) {
                  throw new Error("Tento termín je již rezervován. První vytvořená rezervace má přednost.");
              }
          }
          transaction.set(bookingRef, {
            ...booking,
            updatedAt: new Date().toISOString()
          });
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

      // Pokud se mění časové parametry (např. přesun termínu), ověříme kolize
      if (data.date || data.time || data.room || data.durationMinutes) {
        const bookingDoc = await getDoc(doc(db, "bookings", String(id)));
        if (bookingDoc.exists()) {
          const current = bookingDoc.data() as Booking;
          const targetDate = data.date || current.date;
          const targetTime = data.time || current.time;
          const targetRoom = Number(data.room || current.room) as 1 | 2;
          const targetDuration = Number(data.durationMinutes || current.durationMinutes) || 60;
          const targetUserId = data.bookedByUserId || current.bookedByUserId || (req.user ? req.user.id : 'guest');

          const q = query(collection(db, "bookings"), where("date", "==", targetDate));
          const snapshot = await getDocs(q);
          const existingBookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Booking[];

          const collision = checkBookingCollision({
            newDate: targetDate,
            newTime: targetTime,
            durationMinutes: targetDuration,
            room: targetRoom,
            userId: targetUserId,
            allBookings: existingBookings,
            excludeBookingId: String(id)
          });

          if (collision.hasCollision) {
            const conflictName = collision.conflictingBooking?.bookedByName || 'jiným lektorem';
            const conflictTime = collision.conflictingBooking ? `${collision.conflictingBooking.time} (${collision.conflictingBooking.durationMinutes} min)` : '';
            return res.status(409).json({
              error: `Termín nelze přesunout: dochází ke kolizi s existující rezervací (${conflictName}${conflictTime ? ` v ${conflictTime}` : ''}). První vytvořená rezervace má přednost.`
            });
          }
        }
      }
      
      await updateDoc(doc(db, "bookings", String(id)), {
        ...data,
        updatedAt: new Date().toISOString()
      });
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
      const regId = registration.id || crypto.randomUUID();
      registration.id = regId;

      const eventRef = doc(db, "groupEvents", registration.eventId);
      const eventDoc = await getDoc(eventRef);

      if (!eventDoc.exists) {
        return res.status(404).json({ error: "Událost neexistuje!" });
      }

      const eventData = await enrichEventData(eventDoc.data() as any);
      
      // Určíme cenu a zabraná místa na základě typu vstupenky
      let spots = 1;
      let price = Number(eventData.price) || 0;

      if (registration.ticketTypeId && eventData.ticketTypes) {
        const ticketType = eventData.ticketTypes.find((t: any) => t.id === registration.ticketTypeId);
        if (ticketType) {
          spots = Number(ticketType.spots) || 1;
          price = Number(ticketType.price);
          registration.ticketTypeName = ticketType.name;
          registration.ticketTypePrice = ticketType.price;
          registration.ticketTypeSpots = spots;
        }
      } else {
        registration.ticketTypeSpots = 1;
        registration.ticketTypePrice = price;
      }

      if (price <= 0) {
        // --- EVENT JE ZDARMA ---
        registration.paymentStatus = 'paid';
        registration.paidAt = new Date().toISOString();

        await runTransaction(db, async (transaction: any) => {
          const currentDoc = await transaction.get(eventRef);
          const currentRegistrations = currentDoc.data()?.currentRegistrations || 0;
          const capacity = currentDoc.data()?.capacity || 0;

          if (currentRegistrations + spots > capacity) throw new Error("Kapacita události je plná!");

          const newRegRef = doc(db, "eventRegistrations", regId);
          transaction.set(newRegRef, registration);
          transaction.update(eventRef, { currentRegistrations: currentRegistrations + spots });
        });

        // Odeslat ihned potvrzení e-mailem klientovi
        if (emailConfigured() && registration.clientEmail) {
          try {
            await sendEmail({
              to: [registration.clientEmail],
              subject: `Potvrzení registrace: ${eventData.title} - Centrum Unity`,
              html: generateEventRegistrationConfirmationEmail(registration, eventData, true)
            });
          } catch (e: any) {
            console.error("Chyba při odesílání e-mailu zdarma registrace:", e.message);
          }
        }

        // Odeslat notifikaci administrátorce (Eva) o nové bezplatné registraci
        if (emailConfigured()) {
          try {
            const adminEmail = await getAdminNotificationEmail();
            if (adminEmail) {
              await sendEmail({
                to: [adminEmail],
                subject: `Nová bezplatná registrace na akci: ${eventData.title} (${registration.clientName || 'Účastník'})`,
                html: generateAdminEventRegistrationNotificationEmail(registration, eventData, 'free', APP_BASE_URL)
              });
              console.log(`Admin notification (free event registration) sent to ${adminEmail}`);
            }
          } catch (adminMailErr: any) {
            console.error("Chyba při odesílání admin notifikace (zdarma registrace):", adminMailErr.message);
          }
        }

        return res.json({ success: true });
      } else {
        // --- EVENT JE PLACENÝ ---
        registration.paymentStatus = 'awaiting_payment';

        await runTransaction(db, async (transaction: any) => {
          const currentDoc = await transaction.get(eventRef);
          const currentRegistrations = currentDoc.data()?.currentRegistrations || 0;
          const capacity = currentDoc.data()?.capacity || 0;

          if (currentRegistrations + spots > capacity) throw new Error("Kapacita události je plná!");

          const newRegRef = doc(db, "eventRegistrations", regId);
          transaction.set(newRegRef, registration);
          transaction.update(eventRef, { currentRegistrations: currentRegistrations + spots });
        });

        // Vytvoříme platbu na GoPay
        const amountHaler = price * 100;
        const token = await getGoPayToken();

        const paymentData = {
          payer: {
            allowed_payment_instruments: ["PAYMENT_CARD", "GPAY", "APPLE_PAY"],
            default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amountHaler,
          currency: "CZK",
          order_number: `${regId}-${Date.now()}`,
          order_description: `Registrace: ${eventData.title}`,
          items: [{ name: `Registrace na akci: ${eventData.title}`, amount: amountHaler, count: 1 }],
          callback: {
            return_url: `${APP_BASE_URL}/#/event/${registration.eventId}?status=success`,
            notification_url: `${APP_BASE_URL}/api/gopay/notify`
          },
          target: {
            type: "ACCOUNT",
            goid: process.env.GOPAY_GOID
          },
          additional_params: [
            { name: "registrationId", value: String(regId) },
            { name: "eventId", value: String(registration.eventId) }
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

        // Zapíšeme paymentId a paymentUrl zpět do registrace
        const regRef = doc(db, "eventRegistrations", regId);
        await updateDoc(regRef, { 
          paymentId: String(data.id),
          paymentUrl: data.gw_url
        });

        // Odešleme klientovi bezprostředně "potvrzení o přihlášení s instrukcemi" o tom, že čekáme na platbu
        if (emailConfigured() && registration.clientEmail) {
          try {
            await sendEmail({
              to: [registration.clientEmail],
              subject: `Potvrzení registrace: ${eventData.title} - Centrum Unity`,
              html: generateEventRegistrationConfirmationEmail(registration, eventData, false)
            });
          } catch (e: any) {
            console.error("Chyba při odesílání e-mailu s instrukcemi k platbě:", e.message);
          }
        }

        // Odešleme notifikaci administrátorce (Eva) o vytvoření objednávky místa na akci
        if (emailConfigured()) {
          try {
            const adminEmail = await getAdminNotificationEmail();
            if (adminEmail) {
              await sendEmail({
                to: [adminEmail],
                subject: `Nová objednávka na akci (čeká na platbu): ${eventData.title} (${registration.clientName || 'Účastník'})`,
                html: generateAdminEventRegistrationNotificationEmail(registration, eventData, 'awaiting_payment', APP_BASE_URL)
              });
              console.log(`Admin notification (new order awaiting payment) sent to ${adminEmail}`);
            }
          } catch (adminMailErr: any) {
            console.error("Chyba při odesílání admin notifikace (objednávka):", adminMailErr.message);
          }
        }

        return res.json({ 
          success: true, 
          paymentUrl: data.gw_url 
        });
      }
    } catch (error: any) {
      console.error("Chyba registrace na událost:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Get all event registrations with full details (not anonymized)
  app.get("/api/admin/eventRegistrations", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const snap = await getDocs(collection(db, "eventRegistrations"));
      const registrations = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(registrations);
    } catch (error: any) {
      console.error("Error loading admin event registrations:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Mark event registration as paid manually
  app.put("/api/admin/eventRegistrations/:id/paid", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const regRef = doc(db, "eventRegistrations", String(id));
      const regDoc = await getDoc(regRef);

      if (!regDoc.exists) {
        return res.status(404).json({ error: "Registrace nebyla nalezena." });
      }

      const regData = regDoc.data() as any;
      if (regData.paymentStatus === "paid") {
        return res.json({ success: true, message: "Již zaplaceno" });
      }

      await updateDoc(regRef, {
        paymentStatus: "paid",
        paidAt: new Date().toISOString(),
        manualPayment: true
      });

      // Send confirmation email
      if (emailConfigured() && regData.clientEmail) {
        const eventDoc = await getDoc(doc(db, "groupEvents", regData.eventId));
        if (eventDoc.exists()) {
          const eventData = await enrichEventData(eventDoc.data() as any);
          try {
            await sendEmail({
              to: [regData.clientEmail],
              subject: `Potvrzení platby: ${eventData.title} - Centrum Unity`,
              html: generateEventRegistrationConfirmationEmail({ ...regData, paymentStatus: 'paid' }, eventData, true)
            });
          } catch (e: any) {
            console.error("Chyba při odesílání manuálního potvrzení:", e.message);
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error marking registration as paid:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Admin: Cancel event registration
  app.delete("/api/admin/eventRegistrations/:id", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const regRef = doc(db, "eventRegistrations", String(id));
      const regDoc = await getDoc(regRef);

      if (!regDoc.exists) {
        return res.status(404).json({ error: "Registrace nebyla nalezena." });
      }

      const regData = regDoc.data() as any;

      await runTransaction(db, async (transaction: any) => {
        // Stornujeme stav registrace
        transaction.update(regRef, {
          paymentStatus: "cancelled",
          cancelledAt: new Date().toISOString(),
          cancellationReason: "admin_cancelled"
        });

        // Snížíme kapacitu
        const eventRef = doc(db, "groupEvents", regData.eventId);
        const eventDoc = await transaction.get(eventRef);
        if (eventDoc.exists()) {
          const currentRegistrations = eventDoc.data()?.currentRegistrations || 0;
          const spots = Number(regData.ticketTypeSpots) || 1;
          transaction.update(eventRef, {
            currentRegistrations: Math.max(0, currentRegistrations - spots)
          });
        }
      });

      // Pošleme storno e-mail
      if (emailConfigured() && regData.clientEmail) {
        const eventDoc = await getDoc(doc(db, "groupEvents", regData.eventId));
        if (eventDoc.exists()) {
          const eventData = await enrichEventData(eventDoc.data() as any);
          try {
            await sendEmail({
              to: [regData.clientEmail],
              subject: `Registrace zrušena: ${eventData.title} - Centrum Unity`,
              html: generateEventRegistrationCancellationEmail(regData, eventData, "Vaše registrace na tuto událost byla zrušena administrátorem Centra Unity.")
            });
          } catch (e: any) {
            console.error("Chyba při odesílání storno e-mailu administrátorem:", e.message);
          }
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Chyba při stornování registrace administrátorem:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Simple in-memory rate limiter for public payment endpoint
  const paymentRateLimits = new Map<string, { count: number, resetTime: number }>();

  // Veřejné načtení rezervace pro platební stránku (bez přihlášení).
  // Vrací jen bezpečná pole potřebná k zobrazení a úhradě – žádný e-mail/telefon klienta.
  app.get("/api/public-booking/:id", async (req: Request, res: Response) => {
    try {
      const booking = await loadBooking(req.params.id as string);
      if (!booking) {
        return res.status(404).json({ error: "Rezervace nebyla nalezena." });
      }
      const d = booking.data;
      res.json({
        id: req.params.id,
        date: d.date,
        time: d.time,
        room: d.room,
        durationMinutes: d.durationMinutes,
        price: d.price,
        status: d.status,
        bookedByName: d.bookedByName || null,
        clientName: d.clientName || null,
      });
    } catch (error: any) {
      console.error("Public booking load error:", error.message);
      res.status(500).json({ error: "Rezervaci se nepodařilo načíst." });
    }
  });

  // Veřejné načtení všech rezervací.
  app.get("/api/public-bookings", async (req: Request, res: Response) => {
    try {
      const snap = await getDocs(collection(db, "bookings"));
      const bookings = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(bookings);
    } catch (error: any) {
      console.error("Error loading public bookings:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Veřejné načtení všech skupinových událostí.
  app.get("/api/public-group-events", async (req: Request, res: Response) => {
    try {
      const snap = await getDocs(collection(db, "groupEvents"));
      const events = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.json(events);
    } catch (error: any) {
      console.error("Error loading public group events:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Veřejné načtení anonymizovaných registrací pro počítání kapacity.
  app.get("/api/public-event-registrations", async (req: Request, res: Response) => {
    try {
      const snap = await getDocs(collection(db, "eventRegistrations"));
      const registrations = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          eventId: d.eventId,
          paymentStatus: d.paymentStatus || 'unpaid'
        };
      });
      res.json(registrations);
    } catch (error: any) {
      console.error("Error loading public event registrations:", error);
      res.status(500).json({ error: error.message });
    }
  });

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
        await updateDoc(booking.ref, { status: 'paid', paidAt: new Date().toISOString() });
        return res.json({ paid: true, message: "Rezervace nevyžaduje platbu." });
      }

      const token = await getGoPayToken();

      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD", "GPAY", "APPLE_PAY"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: "CZK",
          // Unikátní číslo objednávky pro každý pokus o platbu (znovu rezervace stejného slotu po stornu),
          // aby GoPay neodmítlo duplicitní order_number. Párování běží přes additional_params.bookingId.
          order_number: `${bookingId}-${Date.now()}`,
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
        await updateDoc(booking.ref, { status: 'paid', paidAt: new Date().toISOString() });
        return res.json({ paid: true, message: "Rezervace nevyžaduje platbu." });
      }

      const token = await getGoPayToken();

      const paymentData = {
          payer: {
              allowed_payment_instruments: ["PAYMENT_CARD", "GPAY", "APPLE_PAY"],
              default_payment_instrument: "PAYMENT_CARD",
          },
          amount: amount,
          currency: "CZK",
          // Unikátní číslo objednávky pro každý pokus (viz výše) – párování přes additional_params.bookingId.
          order_number: `${String(bookingId)}-${Date.now()}`,
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
    const registrationIdParam = paymentStatus.additional_params?.find((x: any) => x.name === "registrationId")?.value;

    let isRegistration = !!registrationIdParam;
    if (!isRegistration) {
      const snap = await getDocs(query(collection(db, "eventRegistrations"), where("paymentId", "==", String(id))));
      if (!snap.empty) {
        isRegistration = true;
      }
    }

    if (isRegistration) {
      let regRef: DocumentReference | null = null;
      let regId = registrationIdParam;

      if (regId) {
        regRef = doc(db, "eventRegistrations", regId);
      } else {
        const snap = await getDocs(query(collection(db, "eventRegistrations"), where("paymentId", "==", String(id))));
        if (!snap.empty) {
          regRef = snap.docs[0].ref;
          regId = snap.docs[0].id;
        }
      }

      if (!regRef) {
        console.log(`GoPay reconcile: pro platbu ${id} nenalezena registrace.`);
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
      let transitionedToCancelled = false;

      await runTransaction(db, async (tx: any) => {
        const snap = await tx.get(regRef!);
        if (!snap.exists()) return;
        const current = snap.data() || {};

        if (current.paymentStatus === "cancelled" || current.paymentStatus === "refunded" || current.paymentStatus === "paid") return;

        const updateData: any = { paymentStatus: newStatus, paymentId: String(id) };
        if (newStatus === "paid" && !current.paidAt) {
          updateData.paidAt = new Date().toISOString();
        }
        if (newStatus === "cancelled") {
          updateData.cancelledAt = new Date().toISOString();
        }
        tx.update(regRef!, updateData);
        if (newStatus === "paid") transitionedToPaid = true;
        if (newStatus === "cancelled") transitionedToCancelled = true;
      });

      if (transitionedToPaid && emailConfigured()) {
        try {
          const finalDoc = await getDoc(regRef!);
          const regData = finalDoc.data() as any;
          const eventDoc = await getDoc(doc(db, "groupEvents", regData.eventId));
          if (eventDoc.exists()) {
            const eventData = await enrichEventData(eventDoc.data() as any);
            const recipients = [regData.clientEmail].filter(Boolean);
            if (recipients.length) {
              await sendEmail({
                to: recipients,
                subject: `Potvrzení platby: ${eventData.title} - Centrum Unity`,
                html: generateEventRegistrationConfirmationEmail(regData, eventData, true)
              });
              console.log(`Event registration confirmation email sent to ${recipients.join(', ')}`);
            }

            // Odeslání notifikace o zaplacení administrátorce (Eva)
            const adminEmail = await getAdminNotificationEmail();
            if (adminEmail) {
              await sendEmail({
                to: [adminEmail],
                subject: `Platba přijata: ${eventData.title} (${regData.clientName || 'Účastník'})`,
                html: generateAdminEventRegistrationNotificationEmail(regData, eventData, 'paid', APP_BASE_URL)
              });
              console.log(`Admin payment notification sent to ${adminEmail}`);
            }
          }
        } catch (e: any) {
          console.error("Failed to send event registration confirmation/admin email:", e.message);
        }
      }

      if (transitionedToCancelled) {
        try {
          const finalDoc = await getDoc(regRef!);
          const regData = finalDoc.data() as any;
          const spots = Number(regData.ticketTypeSpots) || 1;
          await runTransaction(db, async (transaction: any) => {
            const eventRef = doc(db, "groupEvents", regData.eventId);
            const eventDoc = await transaction.get(eventRef);
            if (eventDoc.exists()) {
              const currentRegistrations = eventDoc.data()?.currentRegistrations || 0;
              transaction.update(eventRef, { currentRegistrations: Math.max(0, currentRegistrations - spots) });
            }
          });
          
          if (emailConfigured()) {
            const eventDoc = await getDoc(doc(db, "groupEvents", regData.eventId));
            if (eventDoc.exists()) {
              const eventData = await enrichEventData(eventDoc.data());
              if (regData.clientEmail) {
                await sendEmail({
                  to: [regData.clientEmail],
                  subject: `Registrace zrušena (vypršela platba): ${eventData?.title} - Centrum Unity`,
                  html: generateEventRegistrationCancellationEmail(regData, eventData, "Platba nebyla dokončena včas, proto byla vaše registrace automaticky zrušena a místo uvolněno.")
                });
              }

              // Notifikace pro administrátorku (Eva)
              const adminEmail = await getAdminNotificationEmail();
              if (adminEmail) {
                await sendEmail({
                  to: [adminEmail],
                  subject: `Storno registrace (vypršela platba): ${eventData?.title} (${regData.clientName || 'Účastník'})`,
                  html: generateAdminEventCancellationNotificationEmail(regData, eventData, "Platba nebyla dokončena včas (vypršel limit na platební bráně).", APP_BASE_URL)
                });
              }
            }
          }
        } catch (e: any) {
          console.error("Failed to handle cancelled event registration:", e.message);
        }
      }

      return { state };
    }

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
    let transitionedToCancelled = false;
    let amountMismatch = false;

    await runTransaction(db, async (tx: any) => {
      transitionedToPaid = false; // reset pro případ opakování transakce
      transitionedToCancelled = false;
      amountMismatch = false;
      const snap = await tx.get(bookingRef!);
      if (!snap.exists()) return;
      const current = snap.data() || {};

      // Idempotence: už zrušenou/refundovanou rezervaci znovu neměníme (aby se e-mail neposlal 2x)
      if (current.status === "cancelled" || current.status === "refunded") return;
      // Ze stavu 'paid' už nepřecházíme na 'paid' ani zpět na 'cancelled'
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
      if (newStatus === "paid" && !current.paidAt) {
        updateData.paidAt = new Date().toISOString();
      }
      if (newStatus === "cancelled" || newStatus === "refunded") {
        updateData.cancelledAt = new Date().toISOString();
        // Důvod zrušení podle stavu z GoPay: CANCELED = zákazník platbu zrušil v bráně,
        // TIMEOUTED = platba nebyla dokončena včas (vypršel čas)
        const reasonMap: Record<string, string> = { CANCELED: "payment_cancelled", TIMEOUTED: "payment_expired", REFUNDED: "refunded" };
        updateData.cancellationReason = reasonMap[state] || "payment_failed";
      }
      tx.update(bookingRef!, updateData);
      if (newStatus === "paid") transitionedToPaid = true;
      if (newStatus === "cancelled") transitionedToCancelled = true;
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

    // Když platba neproběhla (zrušena/vypršela) a rezervaci jsme právě zrušili → informujeme + termín je volný.
    if (transitionedToCancelled && emailConfigured()) {
      try {
        const finalDoc = await getDoc(bookingRef!);
        const bookingData = finalDoc.data() as any;
        const recipients = await recipientsFor(bookingData);
        if (recipients.length) {
          await sendEmail({
            to: recipients,
            subject: 'Platba neproběhla – rezervace zrušena - Centrum Unity',
            html: generateCancellationEmail(bookingData, "Platba bohužel neproběhla, proto byla rezervace automaticky zrušena a termín se uvolnil. Pokud máte i nadále zájem, můžete si vytvořit novou rezervaci.")
          });
          console.log(`Payment-failed email sent to ${recipients.join(', ')} for booking ${bookingId}`);
        }
      } catch (e: any) {
        console.error("Failed to send payment-failed email:", e.message);
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

  // Hostovské storno: host zruší SVOJI rezervaci ověřením e-mailu (proti clientEmail u rezervace).
  // U zaplacené rezervace a >24 h do termínu automaticky refunduje přes GoPay. Rate-limitováno.
  app.post("/api/guest-cancel", async (req: Request, res: Response) => {
    try {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const key = "guestcancel:" + ip;
      const limit = paymentRateLimits.get(key);
      if (limit && limit.resetTime > now) {
        if (limit.count >= 8) return res.status(429).json({ error: "Příliš mnoho pokusů. Zkuste to prosím později." });
        limit.count++;
      } else {
        paymentRateLimits.set(key, { count: 1, resetTime: now + 60000 });
      }

      const { bookingId, email } = req.body;
      if (!bookingId || !email) return res.status(400).json({ error: "Chybí identifikátor rezervace nebo e-mail." });

      const booking = await loadBooking(bookingId);
      if (!booking) return res.status(404).json({ error: "Rezervace nebyla nalezena." });
      const data = booking.data;

      // Jen hostovské rezervace se ruší přes ověření e-mailem
      if (data.bookedByUserId !== 'guest') {
        return res.status(403).json({ error: "Tuto rezervaci nelze zrušit tímto způsobem." });
      }
      // Ověření e-mailu (bez ohledu na velikost písmen / mezery)
      const stored = String(data.clientEmail || '').trim().toLowerCase();
      const given = String(email).trim().toLowerCase();
      if (!stored || stored !== given) {
        return res.status(403).json({ error: "Zadaný e-mail nesouhlasí s e-mailem u rezervace." });
      }
      if (data.status === 'cancelled' || data.status === 'refunded') {
        return res.json({ success: true, message: "Rezervace už byla zrušena." });
      }

      // Refundace jen u zaplacené rezervace a jen >24 h před termínem
      let refundMessage = "";
      if (data.paymentId) {
        const [y, m, d] = String(data.date).split('-').map(Number);
        const [hh, mm] = String(data.time).split(':').map(Number);
        const reservationTime = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime();
        const hoursToReservation = (reservationTime - now) / (1000 * 60 * 60);
        if (hoursToReservation < 24) {
          return res.status(400).json({ error: "Zrušení s vrácením peněz je možné jen více než 24 hodin před termínem. Kontaktujte prosím studio." });
        }
        const token = await getGoPayToken();
        const statusRes = await fetch(`${GOPAY_URL}/payments/payment/${data.paymentId}`, {
          method: "GET", headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` }
        });
        const paymentStatus = await safeJson(statusRes);
        if (paymentStatus.state === 'PAID') {
          const refundRes = await fetch(`${GOPAY_URL}/payments/payment/${data.paymentId}/refund`, {
            method: "POST",
            headers: { "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded", "Authorization": `Bearer ${token}` },
            body: `amount=${paymentStatus.amount}`
          });
          const rtext = await refundRes.text();
          if (!refundRes.ok) {
            return res.status(400).json({ error: `Platbu se nepodařilo vrátit: ${rtext}. Kontaktujte prosím studio.` });
          }
          refundMessage = "Zaplacená částka Vám bude vrácena.";
        }
      }

      await updateDoc(booking.ref, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: refundMessage ? 'cancelled_by_guest_refunded' : 'cancelled_by_guest',
        note: (data.note ? data.note + '\n' : '') + 'Zrušeno hostem (ověřeno e-mailem).'
      });

      if (emailConfigured() && data.clientEmail) {
        try {
          await sendEmail({
            to: data.clientEmail,
            subject: 'Zrušení rezervace - Centrum Unity',
            html: generateCancellationEmail(data, "Rezervace byla zrušena na Vaši žádost.")
          });
        } catch (e: any) { console.error("Guest cancel email error:", e.message); }
      }

      res.json({ success: true, message: refundMessage || "Rezervace byla zrušena." });
    } catch (error: any) {
      console.error("Guest Cancel Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Napojení na osobní kalendář (ICS odběr) ---

  // Vrátí přihlášenému lektorovi jeho odkaz pro odběr kalendáře (vytvoří token, pokud chybí).
  app.get("/api/my-calendar-url", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const id = req.user?.id;
      if (!id || id === "guest") return res.status(400).json({ error: "Pro tento profil není kalendář dostupný." });
      const ref = doc(db, "practitioners", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Profil nenalezen." });
      let token = (snap.data() as any).calendarSyncToken;
      if (!token) {
        token = crypto.randomBytes(24).toString("hex");
        await updateDoc(ref, { calendarSyncToken: token });
      }
      res.json({ url: `${APP_BASE_URL}/api/calendar/${id}/${token}` });
    } catch (error: any) {
      console.error("Calendar URL Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Veřejný ICS feed rezervací lektora (zabezpečený tajným tokenem). Do Google se přidá "z adresy URL".
  app.get("/api/calendar/:id/:token", async (req: Request, res: Response) => {
    try {
      const { id, token } = req.params;
      const snap = await getDoc(doc(db, "practitioners", id as string));
      if (!snap.exists() || (snap.data() as any).calendarSyncToken !== token) {
        return res.status(404).send("Not found");
      }
      const practitionerName = (snap.data() as any).name || "Lektor";

      const bsnap = await getDocs(query(collection(db, "bookings"), where("bookedByUserId", "==", id)));
      const groupEventsSnap = await getDocs(collection(db, "groupEvents"));
      const eventRegsSnap = await getDocs(collection(db, "eventRegistrations"));

      const regCountMap: Record<string, number> = {};
      eventRegsSnap.docs.forEach((rd) => {
        const rdata: any = rd.data();
        if (rdata.paymentStatus && rdata.paymentStatus !== "cancelled") {
          const spots = rdata.ticketTypeSpots || 1;
          regCountMap[rdata.eventId] = (regCountMap[rdata.eventId] || 0) + spots;
        }
      });

      const active = ["awaiting_payment", "deferred_payment", "paid", "completed", "payment_review"];
      const pad = (n: number) => String(n).padStart(2, "0");
      const floatFmt = (dt: Date) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
      const esc = (s: any) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

      let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Centrum Unity//Rezervace//CZ\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
      ics += `X-WR-CALNAME:${esc("Centrum Unity - " + practitionerName)}\r\n`;
      ics += `X-WR-TIMEZONE:Europe/Prague\r\n`;
      // Kompletní definice časové zóny – zajistí správný čas ve VŠECH kalendářích (Google, Apple, Outlook)
      ics += "BEGIN:VTIMEZONE\r\n";
      ics += "TZID:Europe/Prague\r\n";
      ics += "X-LIC-LOCATION:Europe/Prague\r\n";
      ics += "BEGIN:DAYLIGHT\r\n";
      ics += "TZOFFSETFROM:+0100\r\n";
      ics += "TZOFFSETTO:+0200\r\n";
      ics += "TZNAME:CEST\r\n";
      ics += "DTSTART:19700329T020000\r\n";
      ics += "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\n";
      ics += "END:DAYLIGHT\r\n";
      ics += "BEGIN:STANDARD\r\n";
      ics += "TZOFFSETFROM:+0200\r\n";
      ics += "TZOFFSETTO:+0100\r\n";
      ics += "TZNAME:CET\r\n";
      ics += "DTSTART:19701025T030000\r\n";
      ics += "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\n";
      ics += "END:STANDARD\r\n";
      ics += "END:VTIMEZONE\r\n";

      const now = new Date();
      const stampFmt = (dt: Date) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;

      // 1. Individuální rezervace lektora
      bsnap.docs.forEach((d) => {
        const b: any = d.data();
        if (!active.includes(b.status)) return;
        const [y, mo, da] = String(b.date).split("-").map(Number);
        const [hh, mm] = String(b.time).split(":").map(Number);
        if (!y || !mo || !da) return;
        const start = new Date(y, mo - 1, da, hh || 0, mm || 0);
        const end = new Date(start.getTime() + (b.durationMinutes || 60) * 60000);
        const summary = `Rezervace ${b.room === 1 ? "M1" : "M2"}${b.clientName ? " – " + b.clientName : ""}`;
        const descParts: string[] = [];
        if (b.clientPhone) descParts.push("Tel: " + b.clientPhone);
        if (b.clientEmail) descParts.push("E-mail: " + b.clientEmail);
        if (b.note) descParts.push("Poznámka: " + b.note);
        if (b.equipment) descParts.push("Vybavení: " + (b.equipment === "futon" ? "Futon" : b.equipment === "table" ? "Lehátko" : "Bez"));

        ics += "BEGIN:VEVENT\r\n";
        ics += `UID:${d.id}@centrumunity.cz\r\n`;
        ics += `DTSTAMP:${stampFmt(now)}\r\n`;
        ics += `DTSTART;TZID=Europe/Prague:${floatFmt(start)}\r\n`;
        ics += `DTEND;TZID=Europe/Prague:${floatFmt(end)}\r\n`;
        ics += `SUMMARY:${esc(summary)}\r\n`;
        ics += `LOCATION:${esc("Šmilovského 1268/9, Vinohrady, Praha 2")}\r\n`;
        if (descParts.length) ics += `DESCRIPTION:${esc(descParts.join("\n"))}\r\n`;
        ics += "END:VEVENT\r\n";
      });

      // 2. Skupinové akce, které lektor vede
      groupEventsSnap.docs.forEach((gedoc) => {
        const ge: any = gedoc.data();
        const isLeader = ge.practitionerId === id || (id === "admin" && (ge.practitionerId === "admin" || !ge.practitionerId));
        if (!isLeader) return;

        const [y, mo, da] = String(ge.date).split("-").map(Number);
        const [shh, smm] = String(ge.startTime || "09:00").split(":").map(Number);
        if (!y || !mo || !da) return;

        const start = new Date(y, mo - 1, da, shh || 0, smm || 0);
        let end: Date;
        if (ge.endTime) {
          const [ehh, emm] = String(ge.endTime).split(":").map(Number);
          end = new Date(y, mo - 1, da, ehh || 0, emm || 0);
          if (end.getTime() <= start.getTime()) {
            end = new Date(start.getTime() + 120 * 60000);
          }
        } else {
          end = new Date(start.getTime() + 120 * 60000);
        }

        const roomName = ge.room === 1 ? "M1" : "M2";
        const registeredCount = regCountMap[gedoc.id] ?? (ge.currentRegistrations || 0);
        const capacity = ge.capacity || 0;

        const summary = `${roomName} · 👥 [Skupinová akce] ${ge.title}`;
        const descParts: string[] = [];
        descParts.push("Typ: Skupinová akce / Workshop");
        descParts.push(`Místnost: ${roomName} (Velká místnost)`);
        descParts.push(`Čas: ${ge.startTime || ""} – ${ge.endTime || ""}`);
        if (capacity > 0) {
          descParts.push(`Obsazenost: ${registeredCount} / ${capacity} účastníků`);
        }
        if (ge.price) {
          descParts.push(`Základní cena: ${ge.price} Kč`);
        }
        if (ge.description) {
          descParts.push("Popis: " + ge.description);
        }

        ics += "BEGIN:VEVENT\r\n";
        ics += `UID:group-${gedoc.id}@centrumunity.cz\r\n`;
        ics += `DTSTAMP:${stampFmt(now)}\r\n`;
        ics += `DTSTART;TZID=Europe/Prague:${floatFmt(start)}\r\n`;
        ics += `DTEND;TZID=Europe/Prague:${floatFmt(end)}\r\n`;
        ics += `SUMMARY:${esc(summary)}\r\n`;
        ics += `LOCATION:${esc("Šmilovského 1268/9, Vinohrady, Praha 2")}\r\n`;
        if (descParts.length) ics += `DESCRIPTION:${esc(descParts.join("\n"))}\r\n`;
        ics += "END:VEVENT\r\n";
      });

      ics += "END:VCALENDAR\r\n";
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="centrum-unity.ics"');
      res.send(ics);
    } catch (error: any) {
      console.error("Calendar Feed Error:", error.message);
      res.status(500).send("Error");
    }
  });

  // Admin: odkaz na MASTER kalendář (všechny rezervace, obě místnosti) do telefonu.
  app.get("/api/master-calendar-url", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: "Master kalendář je jen pro administrátora." });
      const id = req.user?.id;
      if (!id) return res.status(400).json({ error: "Neplatný profil." });
      const ref = doc(db, "practitioners", id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.status(404).json({ error: "Profil nenalezen." });
      let token = (snap.data() as any).masterCalendarToken;
      if (!token) {
        token = crypto.randomBytes(24).toString("hex");
        await updateDoc(ref, { masterCalendarToken: token });
      }
      res.json({ url: `${APP_BASE_URL}/api/master-calendar/${token}` });
    } catch (error: any) {
      console.error("Master calendar URL Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Veřejný ICS feed VŠECH rezervací a skupinových akcí (master kalendář pro admina), zabezpečený tajným tokenem.
  app.get("/api/master-calendar/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const holder = await getDocs(query(collection(db, "practitioners"), where("masterCalendarToken", "==", token)));
      if (holder.empty) return res.status(404).send("Not found");

      const bsnap = await getDocs(collection(db, "bookings"));
      const groupEventsSnap = await getDocs(collection(db, "groupEvents"));
      const practitionersSnap = await getDocs(collection(db, "practitioners"));
      const eventRegsSnap = await getDocs(collection(db, "eventRegistrations"));

      const practMap: Record<string, string> = {};
      practitionersSnap.docs.forEach((pd) => {
        const pdata: any = pd.data();
        practMap[pd.id] = pdata.name || pd.id;
        if (pdata.role === "ADMIN" || pd.id === "admin") {
          practMap["admin"] = pdata.name || "Eva";
        }
      });

      const regCountMap: Record<string, number> = {};
      eventRegsSnap.docs.forEach((rd) => {
        const rdata: any = rd.data();
        if (rdata.paymentStatus && rdata.paymentStatus !== "cancelled") {
          const spots = rdata.ticketTypeSpots || 1;
          regCountMap[rdata.eventId] = (regCountMap[rdata.eventId] || 0) + spots;
        }
      });

      const active = ["awaiting_payment", "deferred_payment", "paid", "completed", "payment_review"];
      const pad = (n: number) => String(n).padStart(2, "0");
      const floatFmt = (dt: Date) => `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
      const esc = (s: any) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

      let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Centrum Unity//Master//CZ\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
      ics += `X-WR-CALNAME:${esc("Centrum Unity – celý kalendář")}\r\n`;
      ics += `X-WR-TIMEZONE:Europe/Prague\r\n`;
      ics += "BEGIN:VTIMEZONE\r\nTZID:Europe/Prague\r\nX-LIC-LOCATION:Europe/Prague\r\n";
      ics += "BEGIN:DAYLIGHT\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200\r\nTZNAME:CEST\r\nDTSTART:19700329T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\n";
      ics += "BEGIN:STANDARD\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nTZNAME:CET\r\nDTSTART:19701025T030000\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\n";
      ics += "END:VTIMEZONE\r\n";

      const now = new Date();
      const stampFmt = (dt: Date) => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`;

      // 1. Všechny individuální rezervace (M1 i M2)
      bsnap.docs.forEach((d) => {
        const b: any = d.data();
        if (!active.includes(b.status)) return;
        const [y, mo, da] = String(b.date).split("-").map(Number);
        const [hh, mm] = String(b.time).split(":").map(Number);
        if (!y || !mo || !da) return;
        const start = new Date(y, mo - 1, da, hh || 0, mm || 0);
        const end = new Date(start.getTime() + (b.durationMinutes || 60) * 60000);
        const room = b.room === 1 ? "M1" : "M2";
        // V master kalendáři je klíčové: která místnost + kdo (lektor) + pro koho (klient)
        const summary = `${room} · ${b.bookedByName || "Rezervace"}${b.clientName ? " – " + b.clientName : ""}`;
        const descParts: string[] = [];
        if (b.bookedByName) descParts.push("Lektor: " + b.bookedByName);
        if (b.clientName) descParts.push("Klient: " + b.clientName);
        if (b.clientPhone) descParts.push("Tel: " + b.clientPhone);
        if (b.note) descParts.push("Poznámka: " + b.note);
        if (b.equipment) descParts.push("Vybavení: " + (b.equipment === "futon" ? "Futon" : b.equipment === "table" ? "Lehátko" : "Bez"));
        descParts.push("Stav: " + (b.status === "paid" ? "Zaplaceno" : b.status === "awaiting_payment" || b.status === "deferred_payment" ? "Čeká na platbu" : b.status));

        ics += "BEGIN:VEVENT\r\n";
        ics += `UID:master-${d.id}@centrumunity.cz\r\n`;
        ics += `DTSTAMP:${stampFmt(now)}\r\n`;
        ics += `DTSTART;TZID=Europe/Prague:${floatFmt(start)}\r\n`;
        ics += `DTEND;TZID=Europe/Prague:${floatFmt(end)}\r\n`;
        ics += `SUMMARY:${esc(summary)}\r\n`;
        ics += `LOCATION:${esc("Šmilovského 1268/9, Vinohrady, Praha 2")}\r\n`;
        if (descParts.length) ics += `DESCRIPTION:${esc(descParts.join("\n"))}\r\n`;
        ics += "END:VEVENT\r\n";
      });

      // 2. Všechny skupinové události (Workshopy a skupinové lekce)
      groupEventsSnap.docs.forEach((gedoc) => {
        const ge: any = gedoc.data();
        const [y, mo, da] = String(ge.date).split("-").map(Number);
        const [shh, smm] = String(ge.startTime || "09:00").split(":").map(Number);
        if (!y || !mo || !da) return;

        const start = new Date(y, mo - 1, da, shh || 0, smm || 0);
        let end: Date;
        if (ge.endTime) {
          const [ehh, emm] = String(ge.endTime).split(":").map(Number);
          end = new Date(y, mo - 1, da, ehh || 0, emm || 0);
          if (end.getTime() <= start.getTime()) {
            end = new Date(start.getTime() + 120 * 60000);
          }
        } else {
          end = new Date(start.getTime() + 120 * 60000);
        }

        const leaderName = practMap[ge.practitionerId] || ge.practitionerId || "Lektor";
        const roomName = ge.room === 1 ? "M1" : "M2";
        const registeredCount = regCountMap[gedoc.id] ?? (ge.currentRegistrations || 0);
        const capacity = ge.capacity || 0;

        const summary = `${roomName} · 👥 [Akce] ${ge.title}${leaderName ? " (" + leaderName + ")" : ""}`;
        const descParts: string[] = [];
        descParts.push("Typ: Skupinová akce / Workshop");
        descParts.push(`Místnost: ${roomName} (Velká místnost)`);
        descParts.push("Lektor: " + leaderName);
        descParts.push(`Čas: ${ge.startTime || ""} – ${ge.endTime || ""}`);
        if (capacity > 0) {
          descParts.push(`Obsazenost: ${registeredCount} / ${capacity} účastníků`);
        }
        if (ge.price) {
          descParts.push(`Základní cena: ${ge.price} Kč`);
        }
        if (ge.ticketTypes && ge.ticketTypes.length > 0) {
          const ttSummary = ge.ticketTypes.map((t: any) => `${t.name}: ${t.price} Kč (${t.spots} ${t.spots === 1 ? "místo" : "místa"})`).join(", ");
          descParts.push("Vstupenky: " + ttSummary);
        }
        if (ge.description) {
          descParts.push("Popis:\n" + ge.description);
        }

        ics += "BEGIN:VEVENT\r\n";
        ics += `UID:group-${gedoc.id}@centrumunity.cz\r\n`;
        ics += `DTSTAMP:${stampFmt(now)}\r\n`;
        ics += `DTSTART;TZID=Europe/Prague:${floatFmt(start)}\r\n`;
        ics += `DTEND;TZID=Europe/Prague:${floatFmt(end)}\r\n`;
        ics += `SUMMARY:${esc(summary)}\r\n`;
        ics += `LOCATION:${esc("Šmilovského 1268/9, Vinohrady, Praha 2")}\r\n`;
        if (descParts.length) ics += `DESCRIPTION:${esc(descParts.join("\n"))}\r\n`;
        ics += "END:VEVENT\r\n";
      });

      ics += "END:VCALENDAR\r\n";
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="centrum-unity-master.ics"');
      res.send(ics);
    } catch (error: any) {
      console.error("Master Calendar Feed Error:", error.message);
      res.status(500).send("Error");
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
      const eighteenHoursAgo = new Date(now - 18 * 60 * 60 * 1000).toISOString(); // připomínka 6 h před koncem

      const snapshot = await getDocs(query(collection(db, "bookings"), where("status", "==", "awaiting_payment")));
      if (snapshot.empty) return;

      const batch = writeBatch(db);
      let count = 0;
      const toNotify: any[] = []; // rezervace s výzvou k platbě, u kterých pošleme storno e-mail
      const toRemind: any[] = []; // rezervace, kterým pošleme připomínku před vypršením

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
             cancellationReason: 'payment_expired',
             note: (data.note ? data.note + '\n' : '') + 'Automaticky zrušeno - platba nebyla uhrazena včas.'
          });
          count++;
          // E-mail "platba neproběhla" pošleme vždy (15min i 24h okno)
          toNotify.push({ id: doc.id, ...data });
        } else if (
          data.paymentRequestedAt &&
          data.paymentRequestedAt < eighteenHoursAgo &&  // je po hranici pro připomínku
          !data.reminderSentAt                            // a připomínku jsme ještě neposlali
        ) {
          toRemind.push({ id: doc.id, ref: doc.ref, ...data });
        }
      });

      // Připomínky (mimo cancel batch) - nastavíme reminderSentAt a pošleme e-mail
      for (const booking of toRemind) {
        try {
          await updateDoc(booking.ref, { reminderSentAt: new Date().toISOString() });
          if (emailConfigured()) {
            const recipients = await recipientsFor(booking);
            if (recipients.length) {
              const hoursLeft = Math.max(1, Math.round(24 - (now - new Date(booking.paymentRequestedAt).getTime()) / (60 * 60 * 1000)));
              await sendEmail({
                to: recipients,
                subject: 'Připomínka platby rezervace - Centrum Unity',
                html: generatePaymentReminderEmail(booking, hoursLeft, APP_BASE_URL),
              });
            }
          }
        } catch (remErr: any) {
          console.error(`Nepodařilo se odeslat připomínku pro rezervaci ${booking.id}:`, remErr.message);
        }
      }

      if (count > 0) {
        await batch.commit();
        console.log(`Automatically cancelled ${count} expired pending bookings`);

        // Best-effort: pošleme e-mail "platba neproběhla" (klientovi i lektorovi)
        for (const booking of toNotify) {
          try {
            if (emailConfigured()) {
              const recipients = await recipientsFor(booking);
              if (recipients.length) {
                await sendEmail({
                  to: recipients,
                  subject: 'Platba neproběhla – rezervace zrušena - Centrum Unity',
                  html: generateCancellationEmail(booking, "Platba bohužel neproběhla, proto byla rezervace automaticky zrušena a termín se uvolnil. Pokud máte i nadále zájem, můžete si vytvořit novou rezervaci."),
                });
              }
            }
          } catch (mailErr: any) {
            console.error(`Nepodařilo se odeslat e-mail o zrušení pro rezervaci ${booking.id}:`, mailErr.message);
          }
        }
      }

      // Úklid nezaplacených registrací na hromadné akce (15 minut na bráně)
      const eventRegSnapshot = await getDocs(query(collection(db, "eventRegistrations"), where("paymentStatus", "==", "awaiting_payment")));
      if (!eventRegSnapshot.empty) {
        for (const regDoc of eventRegSnapshot.docs) {
          const data = regDoc.data();
          if (data.registeredAt && data.registeredAt < fifteenMinutesAgo) {
            // Zrušíme registraci
            await updateDoc(regDoc.ref, {
              paymentStatus: 'cancelled',
              cancelledAt: new Date().toISOString(),
              cancellationReason: 'payment_expired'
            });

            // Uvolníme kapacitu
            try {
              await runTransaction(db, async (transaction: any) => {
                const eventRef = doc(db, "groupEvents", data.eventId);
                const eventDoc = await transaction.get(eventRef);
                if (eventDoc.exists()) {
                  const currentRegistrations = eventDoc.data()?.currentRegistrations || 0;
                  const spots = Number(data.ticketTypeSpots) || 1;
                  transaction.update(eventRef, { currentRegistrations: Math.max(0, currentRegistrations - spots) });
                }
              });

              // Odešleme storno e-mail klientovi a administrátorce
              if (emailConfigured()) {
                const eventDoc = await getDoc(doc(db, "groupEvents", data.eventId));
                if (eventDoc.exists()) {
                  const eventData = await enrichEventData(eventDoc.data());
                  if (data.clientEmail) {
                    await sendEmail({
                      to: [data.clientEmail],
                      subject: `Registrace zrušena (vypršela platba): ${eventData?.title} - Centrum Unity`,
                      html: generateEventRegistrationCancellationEmail(data, eventData, "Platba nebyla dokončena včas, proto byla vaše registrace automaticky zrušena a místo uvolněno.")
                    });
                  }

                  const adminEmail = await getAdminNotificationEmail();
                  if (adminEmail) {
                    await sendEmail({
                      to: [adminEmail],
                      subject: `Storno registrace (vypršela platba): ${eventData?.title} (${data.clientName || 'Účastník'})`,
                      html: generateAdminEventCancellationNotificationEmail(data, eventData, "Platba nebyla dokončena včas (vypršel 15minutový časový limit na platební bráně).", APP_BASE_URL)
                    });
                  }
                }
              }
            } catch (capErr: any) {
              console.error(`Chyba při uvolňování kapacity pro registraci ${regDoc.id}:`, capErr.message);
            }
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
