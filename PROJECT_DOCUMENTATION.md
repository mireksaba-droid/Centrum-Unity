# Dokumentace projektu Centrum Unity

> Aktualizováno tak, aby odpovídalo skutečnému stavu kódu (SMTP e-maily přes webkitty.eu, platební okna 15 min / 24 h, stavy rezervací, GoPay). Sekce označené jako **Známé omezení** popisují rozdíl mezi zamýšleným a aktuálním stavem.

## 1. Přehled projektu
**Název:** Centrum Unity (Coworking Space pro wellness)
**Popis:** Platforma pro správu coworkingového wellness centra. Lektoři (terapeuti, kouči, maséři) si rezervují místnosti, správce (Eva) spravuje kalendář, profily, skupinové události a platby. Součástí jsou online platby přes GoPay a e-mailové notifikace.

## 2. Technologický Stack
- **Frontend:** React 19, TypeScript, Vite 6
- **Backend:** Express 5 (Node.js) integrovaný s Vite (middleware mód pro vývoj), samostatný `server.ts`
- **Build:** `vite build` pro frontend + `esbuild` pro sbalení serveru do `dist/server.cjs`
- **State Management:** Zustand (s `persist` do localStorage)
- **Styling:** Tailwind CSS v4 (palety `sage`, `stone`; pozadí `#f1e9dc`)
- **Routing:** React Router Dom v7 (Hash router v preview/iframe, Browser router jinak)
- **Databáze:** Firebase Firestore
- **Platby:** GoPay REST API (sandbox i produkce)
- **E-maily:** SMTP přes `nodemailer` (poštovní server na doméně, webkitty.eu)
- **AI:** Google Gemini (`gemini-1.5-flash`) přes serverový proxy endpoint
- **Grafy:** Recharts · **Ikony:** Lucide React · **Monitoring:** Sentry (`@sentry/react`)

## 3. Adresářová Struktura (skutečná)
```
/
├── components/           # UI komponenty (Button, Footer, PractitionerCard,
│                         #   RescheduleModal, Toast, MiniCalendar)
├── contexts/
│   └── ToastContext.tsx  # Správa toast zpráv
├── pages/                # Login, StudioSchedule, AdminDashboard,
│                         #   PractitionerDashboard, PaymentPage, PublicEventPage,
│                         #   TermsPage, PrivacyPage, About, Team, Services, CalendarView, Dashboard
├── services/
│   ├── firebase.ts       # Klientský přístup k Firestore + wrapper na /api/send-email
│   ├── geminiService.ts  # Volání AI přes /api/ai/chat
│   ├── monitoring.ts     # Analytika / logování
│   └── notifications.ts  # Skládání a odesílání notifikací
├── store/
│   └── useStore.ts       # Zustand store (uživatel, rezervace, lektoři, události)
├── utils/
│   ├── scheduler.ts      # Kolize rezervací, buffery na úklid, výpočet ceny
│   ├── dateUtils.ts      # Práce s lokálním datem/časem
│   ├── emailTemplates.ts # HTML šablony e-mailů (potvrzení, výzva, storno)
│   └── vocative.ts       # Skloňování jmen do 5. pádu (oslovení)
├── server.ts             # Express backend (API, cron, cleanup job)
├── server-firebase.ts    # Inicializace Firestore pro server
├── firestore.rules       # Bezpečnostní pravidla Firestore
├── constants.ts          # Konstanty a seed data (PRACTITIONERS, ceny, časy)
├── types.ts              # TypeScript modely (Booking, Practitioner, GroupEvent…)
└── firebase-applet-config.json  # Konfigurace Firebase projektu
```

## 4. Logická Mapa Aplikace

### A. Autentizace
Uživatel vybere profil a zadá PIN. Po ověření (dnes na klientovi) zavolá `/api/login`, který vydá JWT. Podle role se přesměruje: `ADMIN` → `/admin`, ostatní → `/schedule`.

### B. Rezervace a storno
1. Lektor/admin vybere volný slot v kalendáři (`StudioSchedule`).
2. Vyplní údaje (klient, vybavení, doba trvání).
3. Kontrola kolizí (`utils/scheduler.ts` → `checkBookingCollision`) včetně bufferů na úklid.
   - **Měkké varování (Paralelní rezervace):** Lektor může ve výjimečných situacích zarezervovat obě místnosti (M1 i M2) na stejný čas. V takovém případě kontrola kolizí nevyhodnotí stav jako nekompatibilní kolizi (`hasCollision = false`), nýbrž vrátí textové varování (`warning`).
   - **State-driven potvrzení v UI:** Místo systémového dialogu prohlížeče (`window.confirm`), který bývá v sandboxovaných iframech blokován, se přímo v modálním okně rezervace (v `StudioSchedule` i v `AdminDashboard` pro skupinové akce) zobrazí designový varovný box s checkboxem *„Beru na vědomí a chci přesto pokračovat“*. Dokud není políčko zaškrtnuto, je potvrzovací tlačítko deaktivováno.
4. Cena se počítá funkcí `calculateRentalPrice` (admin má **0 Kč zdarma**).
5. Uložení: lokální store + Firestore (`saveBookingToFirestore`, transakce proti dvojité rezervaci).
6. Platba podle scénáře (viz sekce 6).
7. Storno/přesun přes `cancelBooking` a `adminRescheduleBooking` (zápis do Firestore).

### C. Skupinové události (veřejné)
Admin vytvoří `GroupEvent` pro Velkou místnost s kapacitou a cenou. Vygeneruje se veřejná URL `/event/:eventId`. Klient se registruje; Firestore **transakce** hlídá, že se nepřekročí kapacita.
*   **Pravidlo počítání kapacity:** Do celkové obsazenosti akce se započítávají pouze aktivní registrace (ve stavu `paid`, `awaiting_payment` atd.). Registrace, které byly stornovány (`cancelled`), se do celkového počtu obsazených míst nezapočítávají, takže automaticky uvolňují kapacitu sálu zpět pro ostatní zájemce (opraveno a sjednoceno jak na veřejné stránce, tak v administrátorském přehledu).
*   **Notifikace pro správce (Eva):** Při každé nové registraci či změně stavu registrace na skupinovou akci je automaticky odesílán e-mail na adresu správkyně `kadlecova-eva@seznam.cz` (nebo dle env `ADMIN_NOTIFICATION_EMAIL` / profilu `admin`), viz sekce 6.

### D. Administrátorský tok
Dashboard s metrikami (příjmy, vytíženost), master kalendář se jmény lektorů, správa profilů, rezervací a událostí. Při kolizi skupinové události s rezervací lektora se otevře modál pro přesun (Reschedule).

### E. Business Intelligence & Analytika (BI)
Administrátorský dashboard obsahuje dedikovanou záložku „Analytika“, která slouží jako hlavní business-intelligence modul centra.
- **Sjednocení jmen lektorů a hostů:** Všechny rezervace vytvořené pod profilem `guest` nebo se jménem `mirek` / `host` / `externista` jsou v BI grafech (Tržby dle lektorů, Storna lektorů, Poslední aktivita, Seznam rezervací) automaticky sjednoceny a prezentovány pod jednotným označením **„Host / Externista“**.
- **Zrealizované & Proběhlé Rezervace:** Speciální podsekce počítá a vizualizuje počet a celkovou finanční hodnotu všech úspěšně proběhlých rezervací (stavy `paid` nebo `completed` s datem v minulosti).
- **Zohlednění administrátora (Eva):** Jelikož má Eva (ID `admin`) pronájem místností zcela zdarma (0 Kč), systém v BI statistikách počítá její rezervace s nulovým obratem, což zajišťuje naprosto přesný přehled o reálných příjmech od externích lektorů.
- **Vizualizace ušetřené částky pro Evu:** Pro zachování přehledu o tom, jakou hodnotu v pronájmech Eva pro své vlastní klienty využila, BI modul počítá a zobrazuje metriku „Ušetřeno za vlastní rezervace Evy“ (vypočítáno ze standardních hodinových sazeb za M1 a M2). Užitečný ukazatel pro interní účely a přehled o vytížení prostor.

## 5. Klíčové datové modely (`types.ts`)

### Role
`ADMIN` (plný přístup) · `PRACTITIONER` (kalendář a vlastní rezervace) · `CLIENT` (připraveno pro Fázi 2, zatím nevyužito k přihlášení).

### Booking (Rezervace) — skutečná pole
- `id` — deterministické `"{room}_{date}_{time}"`.
- `bookedByUserId`, `bookedByName` — kdo si místnost pronajal.
- `room`: `1` (Malá) | `2` (Velká).
- `date` (`YYYY-MM-DD`), `time` (`HH:MM`), `durationMinutes`.
- `status`: `created` | `awaiting_payment` | `deferred_payment` | `paid` | `cancelled` | `completed` | `refunded`.
- `paymentMethod`: `invoice` | `qr` | `online`.
- `price` — cena pronájmu v Kč.
- `equipment`: `table` (Lehátko) | `futon` — volitelné vybavení místnosti.
- `clientName` / `clientEmail` / `clientPhone` — kontakt na klienta (CRM).
- `paymentId` — ID platby v GoPay (párování, refundace).
- `createdAt` — čas vytvoření.
- `paymentRequestedAt` — čas odeslání výzvy k platbě (od něj běží 24h okno).
- `note`, `cancelledAt`, `recurringGroupId` — volitelné.

### Practitioner (Lektor)
`id`, `name`, `title`, `category`, `role`, `pin`, `imageUrl`, `services`, `colorCode`, `isActive`.
Řazení v UI viz `AGENTS.md` / `sortPractitioners`.

## 6. E-maily a platební logika

### Odesílání e-mailů (SMTP / Resend)
E-maily posílá backend přes `nodemailer` / `Resend` (`sendEmail()` v `server.ts`). Endpoint `/api/send-email` (chráněný JWT) a interní volání v cronu/cleanupu a při registraci na události. Když e-mailové proměnné chybí, odeslání se jen zaloguje (mock). Šablony jsou v `utils/emailTemplates.ts`:
- `generateConfirmationEmail(booking, isPaid)` — potvrzení individuální rezervace místnosti (řádek s vybavením, stav Zaplaceno/Faktura, oslovení ve 5. pádu).
- `generatePaymentRequestEmail(booking, baseUrl)` — výzva k platbě s odkazem na `/#/pay/:id`.
- `generatePaymentReminderEmail(booking, hoursLeft, baseUrl)` — připomínka platby před vypršením 24h lhůty.
- `generateCancellationEmail(booking, reason)` — storno rezervace.
- `generateEventRegistrationConfirmationEmail(registration, event, isPaid)` — potvrzení registrace na skupinovou akci pro klienta (včetně instrukcí, platebního stavu a storno podmínek).
- `generateEventRegistrationCancellationEmail(registration, event, reason)` — storno registrace na akci pro klienta (např. při vypršení platebního limitu).
- `generateAdminEventRegistrationNotificationEmail(registration, event, paymentState, baseUrl)` — okamžitá notifikace pro administrátorku Evu o nové registraci či platbě na skupinovou akci.
- `generateAdminEventCancellationNotificationEmail(registration, event, reason, baseUrl)` — notifikace pro správce o stornu registrace na skupinovou akci a uvolnění kapacity.
- `generateAdminDailySummaryEmail(newBookings, cancelledBookings, periodLabel)` — denní souhrn vytvořených a zrušených rezervací.

Všechny e-maily mají jednotnou značkovou hlavičku s logem (`LOGO_URL = https://rezervace.centrumunity.cz/logo.png`), přehledný tabulkový detail a patičku s kontaktem.

### Notifikace pro administrátorku Evu (`kadlecova-eva@seznam.cz`)
Notifikace o skupinových akcích jsou odesílány na e-mail administrátorky (určeno prioritou: `ADMIN_NOTIFICATION_EMAIL` z `.env` → e-mail v profilu `admin` z Firestore → výchozí `kadlecova-eva@seznam.cz`):
1. **Nová bezplatná registrace:** Odesílá se ihned při vytvoření registrace na bezplatnou akci (stav `free`).
2. **Nová objednávka místa (placená akce):** Odesílá se ihned při vytvoření objednávky, když klient vstoupí na platební bránu (stav `awaiting_payment`).
3. **Potvrzení o zaplacení:** Odesílá se při úspěšném uhrazení přes GoPay webhook (stav `paid`).
4. **Storno registrace:** Odesílá se, pokud platba na bráně vyprší (po 15 minutách) nebo je registrace zrušena, včetně informace o uvolnění kapacity v sále.

### Testovací endpoint
`POST /api/test-email` (jen admin) odešle ukázkový potvrzovací e-mail pro ověření SMTP. Tělo: `{ "to": "adresa" }` (nepovinné, jinak na `FROM_EMAIL`).

### Platební scénáře
- **Cena 0 (admin, faktura zdarma):** rezervace rovnou `paid`, potvrzení hned.
- **Online platba, termín ≤ 120 dní:** rezervace `awaiting_payment` + přesměrování na GoPay. Po zaplacení (webhook `PAID`) → `paid` + potvrzení.
- **Online platba, termín > 120 dní:** rezervace `deferred_payment` (brána se nespouští). Výzva k platbě se pošle, až je termín ≤ 120 dní (cron nebo admin) → `awaiting_payment` + `paymentRequestedAt`.

### Automatické storno (dvě okna)
Úloha v `server.ts` běží každou minutu a ruší `awaiting_payment`:
- **15 minut** pro okamžitou online platbu (jen `createdAt`).
- **24 hodin** pro e-mailovou výzvu (`paymentRequestedAt`). Po vypršení → `cancelled` + storno e-mail klientovi.

## 7. Externí služby a integrace

### Firebase / Firestore
Konfigurace je v `firebase-applet-config.json`. Klient i server používají webové Firebase SDK (`firebase/firestore`).
**Známé omezení:** server nepoužívá `firebase-admin` (byť je v závislostech) a přistupuje k DB jako klient — proto jsou dnes Firestore pravidla otevřená. Viz sekce 9.

### GoPay (platby)
- Vytváření plateb: `/api/create-payment` (auth) a `/api/public-payment` (veřejné, rate-limit).
- Webhook: `/api/gopay/notify` asynchronně aktualizuje stav rezervace (`PAID` → `paid`, `CANCELED`/`TIMEOUTED` → `cancelled`, `REFUNDED` → `refunded`), idempotentně.
- Ověření stavu po návratu: `/api/gopay/status`.
- Refundace: `/api/refund` — jen vlastník nebo admin, a jen je-li do termínu **≥ 24 h**. Částky v haléřích.

### SMTP (webkitty.eu)
Viz sekce 6. Doporučeno založit samostatnou schránku pro odesílání; `FROM_EMAIL` musí být na vlastní doméně.

### Gemini AI
`/api/ai/chat` proxuje požadavky na Gemini (`gemini-1.5-flash`). Frontend volá přes `services/geminiService.ts`.
**Známé omezení:** endpoint nemá auth ani rate-limit.

## 8. Konfigurace a nasazení

### Environment Variables (`.env`)
```
# GoPay
GOPAY_GOID=
GOPAY_CLIENT_ID=
GOPAY_CLIENT_SECRET=

# SMTP e-maily (webkitty.eu / centrumunity.cz)
SMTP_HOST=smtp.centrumunity.cz
SMTP_PORT=465                    # 465 = SSL, nebo 587 = STARTTLS
SMTP_USER=info@centrumunity.cz
SMTP_PASS=
FROM_EMAIL=info@centrumunity.cz

# Tajné klíče
JWT_SECRET=                      # podpis přihlašovacích tokenů
CRON_SECRET=                     # ochrana cron endpointu výzev k platbě
GEMINI_API_KEY=                  # AI chat
```
Firebase konfigurace je v `firebase-applet-config.json`, ne v env proměnných.

### Deployment
Cílem je kontejnerové prostředí (např. Google Cloud Run):
1. `npm run build` (Vite frontend → `dist/`, poté `esbuild` server → `dist/server.cjs`).
2. Server čte `process.env.PORT` a naslouchá na `0.0.0.0`.
3. Statické assety servíruje Express.
4. Env proměnné se nastaví v administraci hostingu.
5. Cron endpoint `/api/cron/check-future-payments` volat pravidelně (např. Cloud Scheduler denně) s hlavičkou `Authorization: Bearer <CRON_SECRET>`.

## 9. Bezpečnost (Security)

> Tato sekce popisuje **aktuální stav**. Body označené jako **Známé omezení** je nutné vyřešit před ostrým provozem — detailně v code review.

### Firestore Security Rules
**Známé omezení:** aktuální `firestore.rules` mají u kolekcí `practitioners`, `bookings`, `groupEvents`, `eventRegistrations` `allow read, write: if true` (dokořán). Zamýšlený stav je RBAC (admin plný přístup, lektor jen své rezervace, veřejnost pouze čtení veřejných dat). Souvisí s tím, že server běží na klientském SDK — cílem je přejít na `firebase-admin` a pravidla zamknout.

### Autentizace a autorizace
- Přihlášení: PIN + JWT (`/api/login`). **Známé omezení:** server PIN neověřuje, ověření je pouze na klientovi; PINy jsou v `constants.ts`. Doporučeno ověřovat PIN na serveru proti hashi.
- Serverové role: většina admin endpointů kontroluje `req.user?.role === "ADMIN"`. **Známé omezení:** u `/api/admin/reset-data` a `/api/refund` je porovnání proti `'admin'` (malými) nekonzistentní.
- `JWT_SECRET` má fallback `default_dev_secret_key` — v produkci nastavit vlastní.

### Bezpečnost na úrovni Store (Zustand)
- `cancelBooking`: zrušit lze jen vlastní rezervaci nebo jako admin.
- `resetData` → `/api/admin/reset-data`: hard reset dat jen pro admina přes chráněný endpoint.
- Akce měnící data (storno, přesun) se okamžitě synchronizují do Firestore.

## 10. Architektura a výkon
- **UUID:** registrace používají `crypto.randomUUID()`; rezervace mají deterministické `id` (slot), což slouží i jako ochrana proti dvojité rezervaci v transakci.
- **Zustand:** centralizovaný stav, žádný prop-drilling; `persist` do localStorage s migracemi.
- **Error Boundary:** `index.tsx` zachytává pády React stromu (v produkci skrýt stack trace).
- **404 guard:** Express má catch-all `/api` 404 před SPA fallbackem, aby se nevracelo HTML místo JSON.

## 11. Testování (QA)
- **Unit (doporučeno):** `utils/scheduler.ts` (kolize, buffery, ceny) a `utils/vocative.ts` (skloňování).
- **E2E (doporučeno):** happy-path booking flow.
- **Manuální checklist:** přihlášení (platný/neplatný PIN), vytvoření rezervace (blokace slotu), skloňované oslovení v potvrzení, vybavení v e-mailu, test SMTP přes `/api/test-email`, storno po vypršení 24 h, admin rezervace zdarma, reset dat.
