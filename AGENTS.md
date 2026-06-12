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
