# Zadávací Dokumentace (Functional Specification) - Centrum Unity

## 1. Úvod a Cíle Projektu
**Název projektu:** Centrum Unity - Wellness Marketplace Platform
**Cíl:** Vytvořit centralizovanou webovou aplikaci pro správu wellness centra, která umožní terapeutům, lektorům a koučům efektivně rezervovat prostory (místnosti), spravovat své klienty a prezentovat své služby. Administrátorům poskytne nástroje pro přehled o vytíženosti a tržbách.

## 2. Uživatelské Role
Aplikace definuje následující role s odlišnými oprávněními:

### 2.1. Administrátor (Admin)
- Má plný přístup ke všem funkcím systému.
- Vidí kompletní kalendář všech místností a všech praktiků, a to včetně jednoznačné vizuální identifikace lektorů u každé rezervace (namísto obecného popisku "MOJE").
- Může spravovat (přidávat/upravovat/mazat) profily praktiků.
- Může rušit nebo přesouvat rezervace ostatních uživatelů.
- Má přístup k finančním přehledům a statistikám vytíženosti.

### 2.2. Praktik (Practitioner / Lektor)
- Může se přihlásit do systému pomocí PIN kódu.
- Vidí dostupnost místností v kalendáři.
- Může vytvářet nové rezervace pro své klienty.
- Vidí pouze své vlastní rezervace a jejich detaily.
- Může zrušit své vlastní budoucí rezervace.
- Nemá přístup k administraci ani k datům ostatních praktiků (kromě obsazenosti slotů).

### 2.3. Klient (Koncový zákazník)
- *V současné fázi:* Nemá přímý přístup do systému. Interaguje s praktikem, který za něj provádí rezervaci. // Prepared for Phase 2 client portal
- *Budoucí rozvoj:* Možnost veřejného objednávání přes profil praktika.

## 3. Funkční Požadavky

### 3.1. Autentizace a Správa Uživatelů
- **Přihlášení:** Jednoduchý systém ověření pomocí PIN kódu přiřazeného k profilu praktika.
- **Odhlášení:** Bezpečné ukončení relace.
- **Profily:** Každý praktik má profil obsahující jméno, titul, specializaci, foto, popis a kontaktní údaje.

### 3.2. Rezervační Systém (Kalendář - 1-on-1)
- **Zobrazení:** Interaktivní týdenní kalendář rozdělený po hodinách.
- **Místnosti:** Podpora pro více místností (např. Malá terapeutovna, Velký sál).
- **Stavy slotů:**
  - *Volno:* Možné rezervovat.
  - *Obsazeno:* Zobrazuje jméno praktika (pro Admina) nebo "Obsazeno" (pro ostatní).
- **Vytvoření rezervace:**
  - Výběr data, času a délky trvání.
  - Zadání typu služby (1-1 terapie, skupinová lekce).
  - Volitelné údaje o klientovi (jméno, email, telefon).
  - Výběr vybavení (lehátko, stůl, futon).
- **Validace a kolize:** Systém nesmí povolit překrývající se rezervace ve stejné místnosti a vynucuje povinné sanitární pauzy na úklid (30 min stejný lektor / 60 min střídání lektorů).
- **Storno podmínky a refundace (platné od 1. 11. 2026):**
  - *Více než 7 dní (> 168 h) před začátkem:* vrácení 100 % zaplacené částky (storno poplatek 0 %).
  - *7 dní až 24 hodin (24 h – 168 h) před začátkem:* storno poplatek 50 %, vrácení 50 % částky zpět na platební kartu.
  - *Méně než 24 hodin (< 24 h) před začátkem:* storno poplatek 100 %, částka propadá a termín se uvolní.
  - *Před 1. 11. 2026:* uplatňuje se přechodné pravidlo (> 24 h = 100 % refund, < 24 h = 0 % refund).
- **Garance 1× bezplatného přesunu rezervace:**
  - Každý lektor má u své aktivní rezervace možnost 1× bezplatně přesunout termín na jiný volný slot v systému (např. při náhlém onemocnění klienta).
  - Po prvním přesunu lektorem se počítadlo `rescheduleCount` zvýší na `1` a další samoobslužný přesun je uzamčen. Administrátor má možnost přesouvat termíny neomezeně.

### 3.3. Skupinové Události a Veřejné Přihlašování (Workshopy)
- **Správa událostí (Admin/Manažer):** Možnost vytvořit, upravit a smazat skupinovou lekci s definovanou kapacitou a cenou za osobu. Aktuálně je tato funkce omezena pouze na Velkou místnost (Room 2).
- **Řešení kolizí při vytváření/úpravě:** Pokud admin vytváří nebo upravuje událost v čase, kdy má lektor již rezervaci, systém kolizi detekuje a automaticky otevře okno pro přesun (reschedule) lektorovy rezervace.
- **Sdílení:** Systém vygeneruje unikátní veřejný odkaz (URL) pro danou událost.
- **Veřejná přihlašovací stránka:** Klient přes odkaz vidí detaily akce (název, lektor, čas, cena, zbývající kapacita) a může se přihlásit zadáním jména a e-mailu.
- **Ochrana proti overbookingu:** Systém hlídá kapacitu a nedovolí přihlášení, pokud je událost plná. Události také blokují sloty v kalendáři, takže lektor nemůže vytvořit rezervaci přes skupinovou událost.

### 3.4. Administrační Dashboard a Audit Přesunů
- **Přehledy (KPIs):**
  - Celkový počet rezervací a reálné tržby.
  - Vytíženost jednotlivých místností včetně započtení hygienických pauz.
  - Sledování zrealizovaných a proběhlých rezervací v minulosti.
- **Audit a monitoring přesunů (Reschedule Monitor):**
  - Samostatná záložka pro dohled nad využitím 1× bezplatného přesunu.
  - Detekce podezřelých storen po přesunu (ochrana před zneužitím refundací přesunutím do budoucna a následným zrušením).
  - Sledování předstihu (pozdní < 24 h, rizikové 24 h – 7 dní, včasné > 7 dní).
  - Přehled per lektor s dodržením striktního klíče řazení.
- **Správa Týmu:**
  - Seznam všech aktivních praktiků.
  - Formulář pro přidání nového praktika.
  - Editace stávajících údajů (změna PINu, specializace).

### 3.5. Notifikace a Komunikace
- **E-mailové potvrzení:** Automatické odeslání e-mailu klientovi/praktikovi po potvrzení rezervace (u online plateb až po zaplacení), včetně informace o storno pásmech a garanci 1× přesunu.
- **Výzva k platbě a storno:** U odložených plateb (termín > 120 dní) se posílá výzva k platbě; při neuhrazení do 24 h automatické storno + e-mail o zrušení s vyčíslením storno poplatku a případné vratky.
- **Systém:** Odesílání přes SMTP (`nodemailer`) z vlastního poštovního serveru (webkitty.eu). Šablony v `utils/emailTemplates.ts`, oslovení skloňované do 5. pádu.

### 3.6. AI Asistent (Chatbot)
- **Funkce:** Plovoucí chatovací okno dostupné na všech stránkách.
- **Schopnosti:** Odpovídání na dotazy ohledně služeb centra, ceníku a otevírací doby pomocí modelu Google Gemini.

### 3.7. Analytika a Monitoring
- **Google Analytics & Sentry:** Sledování návštěvnosti a běhových chyb.
- **Sledované události:** Zobrazení stránek, interakce s rezervačním formulářem, využití AI chatbota.

## 4. Datový Model (Entity)

### Rezervace (Booking)
- ID, Datum, Čas, Délka trvání
- ID Místnosti (Room: 1 = Malá, 2 = Velká)
- ID Praktika (Kdo rezervoval), Jméno praktika
- Údaje o klientovi (Jméno, Email, Telefon), Vybavení (lehátko/futon)
- Stav: `created`, `awaiting_payment`, `deferred_payment`, `paid`, `cancelled`, `completed`, `refunded`
- Cena, způsob platby (`invoice`/`qr`/`online`), `paymentId`, `paymentRequestedAt`
- `rescheduleCount` (počet přesunů, max 1 pro lektora), `rescheduledBy` (`practitioner` / `admin`), `rescheduledAt`
- `originalDate`, `originalTime`, `rescheduleReason`
- `refundAmount`, `cancellationFee` (vyčíslení storno poplatku a vrácené částky)

### Praktik (Practitioner)
- ID, Jméno, Role
- PIN (Hashed/Plaintext pro demo)
- Specializace, Bio
- Seznam nabízených služeb

### Skupinová Událost (GroupEvent)
- ID, Název, Lektor, Datum, Čas
- Kapacita, Cena
- Místnost (Fixně Velká místnost)

### Přihláška (EventRegistration)
- ID, ID Události
- Jméno a E-mail klienta
- Stav platby

## 5. Nefunkční Požadavky
- **Technologie:** React (Frontend), Firebase (Backend služby/Databáze) a Express.js s esbuild bundlem nasazovaný na Google Cloud Run.
- **Infrastruktura & Sítě:** Aplikace poslouchá na dynamickém portu (`process.env.PORT`) a binduje na hostitele `0.0.0.0`, aby byl povolen síťový provoz z kontejnerizační platformy Cloud Run.
- **Bezpečnost (cíl):** Striktní ochrana dat pomocí Firestore Security Rules (RBAC). **Aktuální stav:** pravidla jsou zatím otevřená a PIN se ověřuje na klientovi — nutno vyřešit před ostrým provozem (viz sekce 9 v `PROJECT_DOCUMENTATION.md`).
- **Kvalita kódu a QA:** Pokrytí kritické logiky (generování slotů) unit testy (Vitest), hlavní rezervační cesty E2E testy (Playwright) a statická analýza ESLint (včetně TypeScript typování).
- **Monitoring:** Nasazení Sentry pro proaktivní sledování chyb v produkci (HOTOVO).
- **Design:** Responsivní design (Mobile-first přístup) využívající Tailwind CSS.
- **Výkon:** Rychlé načítání kalendáře a okamžitá zpětná vazba při rezervaci.
- **Dostupnost:** Aplikace musí být dostupná 24/7.

## 6. Krátkodobá rozšíření (Phase 1.5 / MVP+)
Tyto funkce představují rychlá vylepšení s vysokou přidanou hodnotou:
- **Platby kartou a Online Rezervace (HOTOVO):** Online platby přes bránu **GoPay** (`/api/create-payment`, veřejné `/api/public-payment`, webhook `/api/gopay/notify`).
  - Rezervace > 120 dní: platba se odloží (`deferred_payment`) a výzva k platbě přijde e-mailem, až se termín přiblíží.
  - Nezaplacené rezervace se automaticky ruší (15 min na bráně / 24 h u e-mailové výzvy).
  - Business logika (frontend i backend) pro refundaci při zrušení ≥ 24 h před termínem.
- **Barevné kódování praktiků (HOTOVO):** Každý terapeut má přiřazenou barvu pro rychlou vizuální orientaci v kalendáři.
- **Víkendové rezervace (HOTOVO):** Kalendář umožňuje rezervace i o víkendech.
- **Export do osobního kalendáře (iCal/ICS):** Generování unikátní URL adresy s bezpečnostním tokenem pro každého praktika. Lektor si ji přidá do telefonu (Apple, Google Calendar) a vidí svůj rozvrh automaticky synchronizovaný.
- **Opakující se rezervace:** Možnost vytvořit sérii rezervací (např. "každé pondělí na 4 týdny") z jednoho formuláře.
- **Dostupnost praktika:** Definice pracovních hodin. Systém blokuje sloty mimo tuto dostupnost.
- **SMS Notifikace:** Integrace Twilio nebo Firebase Extensions pro zasílání SMS potvrzení (vyšší open-rate než e-mail).
- **Čekací listina (Waitlist):** Možnost zapsat se na obsazený slot. Při zrušení rezervace systém automaticky notifikuje čekající klienty.

## 7. Budoucí Rozšíření (Out of Scope pro MVP)
- Klientská zóna (přihlášení pro koncové klienty).
- Pokročilý reporting a export dat do CSV/PDF.
- Synchronizace s Google Kalendářem.
