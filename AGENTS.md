# Centrum Unity - AI Agent Guidelines

## Důležitá pravidla pro vývoj

1. **Řazení lektorů (Practitioners):** Ve všech UI výběrech, seznamech a dashboardech musí být lektoři striktně seřazeni podle tohoto klíče:
   - 1. místo: Eva (Administrátor, `admin`)
   - 2. místo: Host / Externista (`guest`)
   - 3. místo: Filip (`filip`)
   - 4. místo: Ostatní lektoři, kteří mají nahranou vlastní fotografii v `/public` (seřazeni abecedně).
   - 5. místo: Ostatní lektoři s výchozím placeholder obrázkem z Unsplash (seřazeni abecedně).
   Kód pro toto řazení se nachází v `constants.ts` ve funkci `sortPractitioners`. Na toto pravidlo myslete při jakémkoliv vykreslování seznamu uživatelů.

2. **Synchronizace Firebase a Lokálních dat:** Změny stavu (aktivace/deaktivace profilu, změna rezervací) v administrátorském panelu se musí okamžitě:
   - Propagovat do globálního stavu (`useStore` → `practitionersList`) a vždy se po updatu **znovu seřadit**.
   - Propagovat do Firebase (`updatePractitionerInFirestore`).

3. **Autentizace:** Přihlášení probíhá výběrem profilu + zadáním PINu. PIN se dnes ověřuje na klientovi (`pages/Login.tsx`) proti datům z Firestore a server (`/api/login`) na jeho základě vydá JWT. **Známé omezení:** server PIN neověřuje, viz sekce „Bezpečnost" v `PROJECT_DOCUMENTATION.md`. Vždy se ujistěte, že je inicializovaný Firebase `db`.

4. **GoPay Integrace:**
   - V AI Studio (a obecně v iframech) nefunguje inline GoPay brána kvůli `X-Frame-Options`. Platba musí být otevírána do nového okna `window.open(url, '_blank')` nebo natvrdo přes `window.location.href`.
   - Backendové API pro GoPay refundace (`/api/refund`) vrací někdy `text/plain` při chybách, proto je nutné parsovat odpovědi obezřetně (`res.text()` a v bloku `try/catch` zkusit `JSON.parse`).
   - GoPay očekává částky v **haléřích** (`amount * 100`).

5. **Odesílání e-mailů (SMTP přes webkitty.eu):**
   - E-maily se posílají přes SMTP pomocí `nodemailer` z backendu (`server.ts`, endpoint `/api/send-email` a pozadí). Konfigurace přes proměnné `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` (viz `.env.example`).
   - Pokud SMTP proměnné chybí, odeslání se pouze zaloguje (mock), aby vývoj nespadl.
   - Šablony e-mailů jsou v `utils/emailTemplates.ts` (potvrzení, výzva k platbě, storno). Všechny sdílejí značkovou hlavičku s logem (`LOGO_URL`) a patičku.
   - Oslovení se skloňuje do 5. pádu funkcí `toVocative()` z `utils/vocative.ts` (např. „Eva" → „Evo").

6. **Kdy se posílá potvrzení:**
   - E-mail s potvrzením rezervace se **neposílá** při vytvoření nezaplacené rezervace.
   - Při platbě fakturou/hotově (cena 0 nebo `invoice`) se potvrzení posílá rovnou.
   - Při online platbě přes GoPay se potvrzení odesílá **až po úspěšném zaplacení** (stav `PAID`).

7. **Rezervace více než 120 dní do budoucna (odložená platba):**
   - Pokud je rezervace na termín **dál než 120 dní** a platba je „online", brána se hned nespouští (GoPay odkazy mají omezenou platnost). Rezervace dostane stav **`deferred_payment`**.
   - Jakmile se termín přiblíží (**≤ 120 dní**), odešle se výzva k platbě e-mailem — buď automaticky přes cron endpoint `/api/cron/check-future-payments` (chráněný `CRON_SECRET`), nebo ručně tlačítkem v `AdminDashboard.tsx`. Rezervace přejde na **`awaiting_payment`** a nastaví se `paymentRequestedAt`.
   - E-mail nasměruje klienta na `/#/pay/:bookingId` (`PaymentPage.tsx`), kde se přes `/api/public-payment` vygeneruje nový platný GoPay odkaz. Po zaplacení přejde rezervace na **`paid`** a odešle se finální potvrzení.

8. **Automatické storno nezaplacených rezervací (dvě okna):** Úloha na serveru běží každou minutu (`setInterval` v `server.ts`) a ruší rezervace ve stavu `awaiting_payment`:
   - **Okamžitá online platba** (na bráně, jen `createdAt`, bez `paymentRequestedAt`): okno **15 minut**.
   - **E-mailová výzva k platbě** (`paymentRequestedAt` nastaveno): okno **24 hodin**. Po vypršení se rezervace zruší a klientovi (má-li `clientEmail`) se odešle **storno e-mail** (`generateCancellationEmail`).
   - Okno se u výzvy počítá od `paymentRequestedAt`, ne od `createdAt` — jinak by se odložené rezervace zrušily hned po odeslání výzvy.

## Stavy rezervace (`BookingStatus` v `types.ts`)
`created` · `awaiting_payment` · `deferred_payment` · `paid` · `cancelled` · `completed` · `refunded`
