# Centrum Unity - AI Agent Guidelines

## Důležitá pravidla pro vývoj
1. **Řazení lektorů (Practitioners):** Ve všech UI výběrech, seznamech a dashboardech musí být lektoři striktně seřazeni podle tohoto klíče:
   - 1. místo: Eva (Administrátor, `admin`)
   - 2. místo: Host / Externista (`guest`)
   - 3. místo: Filip (`filip`)
   - 4. místo: Ostatní lektoři, kteří mají nahranou vlastní fotografii v `/public` (seřazeni abecedně).
   - 5. místo: Ostatní lektoři s výchozím placeholder obrázkem z Unsplash (seřazeni abecedně).
   Kód pro toto řazení se nachází v `constants.ts` ve funkci `sortPractitioners`. Na toto pravidlo myslete při jakémkoliv vykreslování seznamu uživatelů.

2. **Synchronizace Firebase a Lokálních dat:** Změny stavu (jako aktivace/deaktivace profilu, změna rezervací) v administrátorském panelu se musí okamžitě:
   - Propagovat do globálního stavu (`useStore` -> `practitionersList`) a vždy se po updatu **znovu seřadit**.
   - Propagovat do Firebase (`updatePractitionerInFirestore`).

3. **Autentizace:** Systém běží s lokálním PIN kódem, ale reálně se využívají data načtená z Firebase. Vždy se ujistěte, že je inicializovaný Firebase `db`.

4. **GoPay Integrace:**
   - V AI Studio (a obecně v iframech) nefunguje inline GoPay brána kvůli `X-Frame-Options`. Platba musí být otevírána do nového okna `window.open(url, '_blank')` nebo natvrdo přes `window.location.href`.
   - Backendové API pro GoPay refundace (`/api/refund`) vrací někdy `text/plain` při chybách, proto je nutné parsovat odpovědi obezřetně (`res.text()` a v bloku `try/catch` zkusit `JSON.parse`).
   - Při zadávání částky k refundaci je třeba pamatovat na to, že GoPay očekává hodnoty v haléřích (`amount * 100`).

5. **Potvrzovací E-maily:**
   - E-mail s potvrzením rezervace se nesmí posílat při vytvoření rezervace ve stavu `pending`.
   - V případě platby převodem/hotově se e-mail posílá rovnou. V případě platby online přes GoPay se e-mail odesílá **až po úspěšném zaplacení** (po návratu z brány a zachycení stavu `PAID`).

6. **Rezervace více než 120 dní do budoucna:**
   - Pokud je rezervace vytvořena na termín, který je dále než 120 dní a platba je zvolena jako "online", platební brána se hned nespouští, protože vygenerované linky na GoPay mají omezenou platnost.
   - Rezervace dostane stav `pending_future`.
   - Jakmile se termín přiblíží (méně než 120 dní), z administrátorského dashboardu (`AdminDashboard.tsx`) se odesílá výzva k platbě e-mailem.
   - E-mail nasměruje klienta na `/pay/:bookingId` (`PaymentPage.tsx`), kde dojde k vygenerování nového platného odkazu přes veřejný endpoint (`/api/public-payment`). Po úspěšné platbě přejde rezervace do stavu `paid` a odešle se finální potvrzení.