import { Booking } from '../types';
import { toVocative } from './vocative';

// Veřejná URL loga (v produkci se servíruje z public/logo.png)
export const LOGO_URL = 'https://rezervace.centrumunity.cz/logo.png';
const BRAND_TAGLINE = 'Coworking Space a prostor pro Váš růst. Poskytujeme zázemí pro masáže, energetické terapie, individuální sezení, workshopy a osobní rozvoj.';

// Sdílená hlavička s logem
const emailHeader = () => `
    <div style="background:#6b8f71;padding:28px 32px 22px;text-align:center;">
      <img src="${LOGO_URL}" alt="Centrum Unity" width="64" height="64" style="display:block;margin:0 auto 10px;width:64px;height:64px;border-radius:50%;background:#ffffff;padding:6px;object-fit:contain;" />
      <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Centrum Unity</div>
      <div style="color:#e8f0e9;font-size:11px;text-transform:uppercase;letter-spacing:3px;margin-top:4px;">Coworking Space</div>
    </div>`;

// Sdílená patička
const emailFooter = () => `
    <div style="background:#faf7f2;padding:22px 32px;text-align:center;border-top:1px solid #ece3d6;">
      <div style="color:#57534e;font-size:13px;font-weight:700;margin-bottom:6px;">Centrum Unity</div>
      <div style="color:#a8a29e;font-size:12px;line-height:1.6;margin-bottom:8px;">${BRAND_TAGLINE}</div>
      <div style="color:#a8a29e;font-size:12px;">info@centrumunity.cz · rezervace.centrumunity.cz</div>
    </div>`;

export const generatePaymentRequestEmail = (booking: Partial<Booking>, baseUrl: string = 'https://rezervace.centrumunity.cz') => {
    const hasHash = baseUrl.includes('/#') || (typeof window !== 'undefined' && (
        window.location.hostname.includes('usercontent.goog') ||
        window.location.hostname.includes('webcontainer.io') ||
        window.location.hostname.includes('idx.google.com')
    ));
    const cleanBase = baseUrl.replace(/\/+$/, '').replace('/#', '');
    const paymentLink = hasHash 
        ? `${cleanBase}/#/pay/${encodeURIComponent(booking.id || '')}` 
        : `${cleanBase}/pay/${encodeURIComponent(booking.id || '')}`;
    return `
    <div style="background-color:#f1e9dc;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        ${emailHeader()}
        <div style="padding:32px;">
            <h1 style="margin:0 0 8px;font-size:21px;color:#1c1917;">Výzva k platbě rezervace</h1>
            <p style="margin:0 0 20px;color:#57534e;font-size:15px;line-height:1.6;">Dobrý den,<br/>blíží se termín Vaší rezervace. Nyní je možné ji uhradit online.</p>
            <div style="background:#faf7f2;border:1px solid #ece3d6;border-radius:12px;padding:18px 24px;margin-bottom:24px;">
                <p style="margin:6px 0;color:#1c1917;font-size:15px;"><strong>Datum:</strong> ${booking.date}</p>
                <p style="margin:6px 0;color:#1c1917;font-size:15px;"><strong>Částka k úhradě:</strong> ${booking.price} Kč</p>
            </div>
            <a href="${paymentLink}" style="display:inline-block;background-color:#6b8f71;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;">Zaplatit online</a>
            <p style="margin-top:24px;color:#57534e;font-size:15px;">Těšíme se na Vás,<br/>tým Centra Unity</p>
        </div>
        ${emailFooter()}
      </div>
    </div>
    `;
};

// Připomínka platby - pošle se pár hodin před vypršením lhůty, když rezervace stále není zaplacená.
export const generatePaymentReminderEmail = (booking: Partial<Booking>, hoursLeft: number = 6, baseUrl: string = 'https://rezervace.centrumunity.cz') => {
    const hasHash = baseUrl.includes('/#') || (typeof window !== 'undefined' && (
        window.location.hostname.includes('usercontent.goog') ||
        window.location.hostname.includes('webcontainer.io') ||
        window.location.hostname.includes('idx.google.com')
    ));
    const cleanBase = baseUrl.replace(/\/+$/, '').replace('/#', '');
    const paymentLink = hasHash 
        ? `${cleanBase}/#/pay/${encodeURIComponent(booking.id || '')}` 
        : `${cleanBase}/pay/${encodeURIComponent(booking.id || '')}`;
    const dateParts = booking.date?.split('-') || [];
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}. ${dateParts[1]}. ${dateParts[0]}` : booking.date;
    return `
    <div style="background-color:#f1e9dc;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        ${emailHeader()}
        <div style="padding:32px;">
            <div style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:16px;">Připomínka platby</div>
            <h1 style="margin:0 0 8px;font-size:21px;color:#1c1917;">Rezervace čeká na úhradu</h1>
            <p style="margin:0 0 20px;color:#57534e;font-size:15px;line-height:1.6;">
                Dobrý den,<br/>připomínáme, že Vaše rezervace zatím není uhrazená. Zbývá přibližně <strong>${hoursLeft} h</strong> na platbu, poté bude rezervace automaticky zrušena a termín uvolněn.
            </p>
            <div style="background:#faf7f2;border:1px solid #ece3d6;border-radius:12px;padding:18px 24px;margin-bottom:24px;">
                <p style="margin:6px 0;color:#1c1917;font-size:15px;"><strong>Termín:</strong> ${formattedDate} v ${booking.time}</p>
                <p style="margin:6px 0;color:#1c1917;font-size:15px;"><strong>Částka k úhradě:</strong> ${booking.price} Kč</p>
            </div>
            <a href="${paymentLink}" style="display:inline-block;background-color:#6b8f71;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;">Zaplatit online</a>
        </div>
        ${emailFooter()}
      </div>
    </div>
    `;
};

export const generateConfirmationEmail = (booking: Partial<Booking>, isPaid: boolean = false) => {
    const dateParts = booking.date?.split('-') || [];
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}. ${dateParts[1]}. ${dateParts[0]}` : booking.date;
    const price = typeof booking.price === 'number' ? booking.price.toFixed(2).replace('.', ',') : booking.price;
    const roomLabel = booking.room === 1 ? 'M1 – Malá místnost' : 'M2 – Velká místnost';
    // E-mail je pro informování LEKTORA (nebo hosta) – oslovujeme jeho, ne klienta z poznámky.
    const greetName = booking.bookedByName || '';
    // Jméno z pole "Klient / Poznámka" u lektorské rezervace zmíníme jako info, ne jako oslovení.
    const clientInfo = (booking.clientName && booking.bookedByUserId !== 'guest') ? String(booking.clientName) : '';

    // Barevný stav podle toho, zda je zaplaceno
    const badgeText = isPaid ? '✓ Zaplaceno' : 'K úhradě fakturou';
    const badgeBg = isPaid ? '#dcfce7' : '#fef3c7';
    const badgeColor = isPaid ? '#166534' : '#92400e';
    const paymentInfo = isPaid ? 'Platba online (uhrazeno)' : 'Faktura';

    // Vybavení místnosti (co si klient zvolil)
    const equipmentLabel = booking.equipment === 'futon' ? 'Futon'
        : booking.equipment === 'table' ? 'Lehátko'
        : booking.equipment === 'none' ? 'Bez vybavení'
        : '';

    const row = (label: string, value: string | number | undefined) => `
        <tr>
            <td style="padding:8px 0;color:#78716c;font-size:14px;">${label}</td>
            <td style="padding:8px 0;color:#1c1917;font-size:14px;font-weight:600;text-align:right;">${value ?? ''}</td>
        </tr>`;

    return `
    <div style="background-color:#f1e9dc;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        ${emailHeader()}

        <!-- Tělo -->
        <div style="padding:32px;">
          <div style="display:inline-block;background:${badgeBg};color:${badgeColor};font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:16px;">${badgeText}</div>

          <h1 style="margin:0 0 8px;font-size:22px;color:#1c1917;">Rezervace potvrzena</h1>
          <p style="margin:0 0 24px;color:#57534e;font-size:15px;line-height:1.6;">
            ${greetName ? `Dobrý den, ${toVocative(greetName)},` : 'Dobrý den,'}<br/>
            ${clientInfo
              ? `byla vytvořena rezervace pro klienta ${clientInfo}. Níže najdete její shrnutí.`
              : `děkujeme za Vaši rezervaci v Centru Unity. Níže najdete její shrnutí.`}
          </p>

          <!-- Detail rezervace -->
          <div style="background:#faf7f2;border:1px solid #ece3d6;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              ${row('Termín', `${formattedDate} v ${booking.time}`)}
              ${row('Místnost', roomLabel)}
              ${row('Doba trvání', `${booking.durationMinutes} min`)}
              ${equipmentLabel ? row('Vybavení', equipmentLabel) : ''}
              ${row('Způsob platby', paymentInfo)}
              <tr><td colspan="2" style="border-top:1px solid #ece3d6;padding-top:12px;"></td></tr>
              <tr>
                <td style="padding:4px 0;color:#1c1917;font-size:16px;font-weight:700;">Celková cena</td>
                <td style="padding:4px 0;color:#6b8f71;font-size:20px;font-weight:800;text-align:right;">${price} Kč</td>
              </tr>
            </table>
          </div>

          <!-- Adresa -->
          <div style="margin-bottom:24px;">
            <div style="color:#78716c;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Kde nás najdete</div>
            <div style="color:#1c1917;font-size:15px;font-weight:600;">Šmilovského 1268/9, Vinohrady, Praha 2</div>
          </div>

          <!-- Storno podmínky -->
          <div style="background:#fff;border-left:3px solid #6b8f71;padding:12px 16px;">
            <div style="color:#1c1917;font-size:13px;font-weight:700;margin-bottom:4px;">Storno podmínky</div>
            <div style="color:#78716c;font-size:13px;line-height:1.6;">
              Rezervaci lze bezplatně zrušit nejpozději 24 hodin před termínem. Při včasném zrušení Vám bude zaplacená částka vrácena v plné výši.
            </div>
          </div>
        </div>

        ${emailFooter()}

      </div>
    </div>
    `;
};

// E-mail o zrušení rezervace (např. když nebyla uhrazena výzva k platbě do 24 h)
export const generateCancellationEmail = (
    booking: Partial<Booking>,
    reason: string = 'Platba nebyla uhrazena ve stanovené lhůtě 24 hodin.',
    baseUrl: string = 'https://rezervace.centrumunity.cz'
) => {
    const dateParts = booking.date?.split('-') || [];
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}. ${dateParts[1]}. ${dateParts[0]}` : booking.date;
    const roomLabel = booking.room === 1 ? 'M1 – Malá místnost' : 'M2 – Velká místnost';
    // Oslovujeme lektora (nebo hosta), klienta z poznámky zmíníme jako info.
    const greetName = booking.bookedByName || '';
    const clientInfo = (booking.clientName && booking.bookedByUserId !== 'guest') ? String(booking.clientName) : '';

    return `
    <div style="background-color:#f1e9dc;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">

        ${emailHeader()}

        <div style="padding:32px;">
          <div style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:16px;">Rezervace zrušena</div>

          <h1 style="margin:0 0 8px;font-size:22px;color:#1c1917;">Vaše rezervace byla zrušena</h1>
          <p style="margin:0 0 20px;color:#57534e;font-size:15px;line-height:1.6;">
            ${greetName ? `Dobrý den, ${toVocative(greetName)},` : 'Dobrý den,'}<br/>
            ${clientInfo
              ? `rezervace pro klienta ${clientInfo} níže byla bohužel zrušena.`
              : `Vaši rezervaci níže jsme bohužel museli zrušit.`}
          </p>

          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 18px;margin-bottom:24px;">
            <div style="color:#991b1b;font-size:13px;font-weight:700;margin-bottom:4px;">Důvod zrušení</div>
            <div style="color:#7f1d1d;font-size:14px;line-height:1.6;">${reason}</div>
          </div>

          <div style="background:#faf7f2;border:1px solid #ece3d6;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#78716c;font-size:14px;">Termín</td><td style="padding:8px 0;color:#1c1917;font-size:14px;font-weight:600;text-align:right;">${formattedDate} v ${booking.time}</td></tr>
              <tr><td style="padding:8px 0;color:#78716c;font-size:14px;">Místnost</td><td style="padding:8px 0;color:#1c1917;font-size:14px;font-weight:600;text-align:right;">${roomLabel}</td></tr>
            </table>
          </div>

          <p style="margin:0 0 20px;color:#57534e;font-size:15px;line-height:1.6;">
            Termín je nyní opět volný. Pokud máte i nadále zájem, můžete si vytvořit novou rezervaci.
          </p>
          <a href="${baseUrl}" style="display:inline-block;background-color:#6b8f71;color:#ffffff;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:700;">Rezervovat znovu</a>
        </div>

        ${emailFooter()}

      </div>
    </div>
    `;
};

// Denní souhrn pro admina: nové a zrušené rezervace za dané období
export const generateAdminDailySummaryEmail = (
    newBookings: Partial<Booking>[],
    cancelledBookings: Partial<Booking>[],
    periodLabel: string = 'za posledních 24 hodin'
) => {
    const fmtDate = (d?: string) => {
        const p = (d || '').split('-');
        return p.length === 3 ? `${p[2]}. ${p[1]}. ${p[0]}` : (d || '');
    };
    const roomShort = (r?: number) => (r === 1 ? 'M1' : r === 2 ? 'M2' : '—');
    const statusLabel: Record<string, string> = {
        paid: 'Zaplaceno', awaiting_payment: 'Čeká na platbu', deferred_payment: 'Čeká na platbu',
        created: 'Nová', completed: 'Dokončeno', cancelled: 'Zrušeno', refunded: 'Refundováno',
        payment_review: 'Ke kontrole'
    };

    const row = (b: Partial<Booking>) => `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #ece3d6;font-size:13px;color:#1c1917;">${fmtDate(b.date)} <b>${b.time || ''}</b></td>
          <td style="padding:8px 10px;border-bottom:1px solid #ece3d6;font-size:13px;color:#57534e;">${roomShort(b.room)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #ece3d6;font-size:13px;color:#1c1917;">${b.bookedByName || ''}${b.clientName ? ` <span style="color:#a8a29e;">/ ${b.clientName}</span>` : ''}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #ece3d6;font-size:13px;color:#57534e;text-align:right;">${typeof b.price === 'number' ? b.price + ' Kč' : ''}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #ece3d6;font-size:12px;color:#78716c;text-align:right;">${statusLabel[b.status as string] || b.status || ''}</td>
        </tr>`;

    const section = (title: string, color: string, items: Partial<Booking>[]) => `
        <div style="margin-bottom:24px;">
          <h2 style="font-size:15px;color:${color};margin:0 0 8px;">${title} (${items.length})</h2>
          ${items.length === 0
            ? `<p style="margin:0;color:#a8a29e;font-size:13px;">Žádné položky.</p>`
            : `<table style="width:100%;border-collapse:collapse;background:#faf7f2;border:1px solid #ece3d6;border-radius:8px;overflow:hidden;">
                 ${items.map(row).join('')}
               </table>`}
        </div>`;

    return `
    <div style="background-color:#f1e9dc;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        ${emailHeader()}
        <div style="padding:32px;">
          <div style="display:inline-block;background:#e0e7ff;color:#3730a3;font-size:13px;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:16px;">Denní souhrn</div>
          <h1 style="margin:0 0 4px;font-size:22px;color:#1c1917;">Přehled rezervací</h1>
          <p style="margin:0 0 24px;color:#57534e;font-size:14px;">Nové a zrušené rezervace ${periodLabel}.</p>

          ${section('🟢 Nové rezervace', '#166534', newBookings)}
          ${section('🔴 Zrušené rezervace', '#991b1b', cancelledBookings)}
        </div>
        ${emailFooter()}
      </div>
    </div>
    `;
};
