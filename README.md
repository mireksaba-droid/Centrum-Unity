# Centrum Unity

Rezervační systém coworkingového wellness centra — rezervace místností, online platby (GoPay), e-mailové notifikace a admin dashboard.

Podrobná dokumentace: **[PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md)** · pravidla pro vývoj: **[AGENTS.md](AGENTS.md)**.

## Spuštění lokálně

**Požadavky:** Node.js

1. Instalace závislostí:
   `npm install`
2. Vytvořte `.env` podle `.env.example` a vyplňte klíče (GoPay, SMTP, `JWT_SECRET`, `GEMINI_API_KEY`, `CRON_SECRET`).
3. Spuštění vývojového serveru:
   `npm run dev`

## Build a produkce
- `npm run build` — sestaví frontend (Vite) a server (esbuild → `dist/server.cjs`).
- `npm start` — spustí produkční server.
- Cron `/api/cron/check-future-payments` volejte pravidelně s hlavičkou `Authorization: Bearer <CRON_SECRET>`.

## Technologie
React 19 · TypeScript · Vite · Express 5 · Firebase Firestore · GoPay · nodemailer (SMTP) · Zustand · Tailwind CSS.
