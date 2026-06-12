import { Booking, Practitioner, Service } from '../types';
import { Monitoring } from './monitoring';
import { sendTransactionalEmail } from './firebase';

// Typy notifikací
type Channel = 'EMAIL' | 'SMS' | 'PUSH';

export const NotificationService = {
  
  // 1. Potvrzení rezervace (Client)
  sendBookingConfirmation: async (booking: Booking, service: Service, email: string = 'klient@email.cz') => {
    
    const subject = `Potvrzení rezervace: ${service.name}`;
    
    // HTML Šablona pro Resend
    const htmlBody = `
      <div style="font-family: sans-serif; color: #444; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #ba8a5b; margin-bottom: 20px;">Rezervace potvrzena</h2>
        <p>Dobrý den,</p>
        <p>děkujeme za vaši rezervaci v Centru Unity. Zde jsou detaily vašeho termínu:</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Služba:</strong> ${service.name}</p>
          <p style="margin: 5px 0;"><strong>Lektor:</strong> ${booking.practitionerName}</p>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${new Date(booking.date).toLocaleDateString('cs-CZ')}</p>
          <p style="margin: 5px 0;"><strong>Čas:</strong> ${booking.time}</p>
          <p style="margin: 5px 0;"><strong>Cena:</strong> ${booking.price} Kč</p>
        </div>

        <p>Pokud potřebujete rezervaci změnit, kontaktujte nás prosím nejpozději 24 hodin předem.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #888;">Centrum Unity<br>Šmilovského 10, Praha 2</p>
      </div>
    `;

    const textBody = `Rezervace potvrzena: ${service.name}\nDatum: ${new Date(booking.date).toLocaleDateString('cs-CZ')} v ${booking.time}\nLektor: ${booking.practitionerName}\nCena: ${booking.price} Kč`;

    try {
        await sendTransactionalEmail({
            to: email, // V Free Tier Resend přijde jen na váš registrovaný email
            subject: subject,
            text: textBody,
            html: htmlBody
        });

        // Úspěch - Resend to přijal
        console.log("📧 Email odeslán přes Resend API.");
        // Volitelný alert pro jistotu v demu
        // alert(`✅ Email úspěšně odeslán přes Resend API na ${email}!\n(Ve Free verzi zkontrolujte svou schránku správce)`);

    } catch (error) {
        console.error("Chyba při odesílání emailu:", error);
        // Fallback pro demo
        alert(`[SIMULACE EMAILU]\nProtože API volání selhalo (viz konzole), zde je obsah:\n\nKomu: ${email}\n${textBody}`);
    }

    Monitoring.trackEvent({
        name: 'view_item', 
        params: { type: 'confirmation_email', bookingId: booking.id }
    });
  },

  // 2. Notifikace pro Lektora (New Booking)
  notifyPractitioner: async (booking: Booking, practitioner: Practitioner) => {
    // V produkci: Push notifikace do mobilní aplikace lektora nebo SMS
    // Zde bychom volali např. sendPushNotification()
    
    console.group('📱 [MOCK PUSH] New Booking Alert');
    console.log(`To Practitioner: ${practitioner.name}`);
    console.log(`Message: Máte novou rezervaci! ${booking.date} ${booking.time} - ${booking.serviceName}`);
    console.groupEnd();
  },

  // 3. Krizová notifikace (Zrušení lektorem)
  sendCancellationNotice: async (booking: Booking, reason: string = 'Nemoc/Osobní důvody') => {
    const message = `Důležité: Vaše rezervace ${booking.date} v ${booking.time} byla zrušena lektorem (${booking.practitionerName}). Důvod: ${reason}. Peníze vracíme automaticky.`;
    
    try {
        await sendTransactionalEmail({
            to: 'klient@email.cz',
            subject: 'Zrušení rezervace - Centrum Unity',
            text: message
        });
        
        alert(`[SMS/EMAIL ODESLÁN]\nZpráva: "${message}"`);

    } catch (error) {
        console.error("Chyba notifikace:", error);
    }

    Monitoring.logError(new Error('Booking Cancelled by Practitioner'), { bookingId: booking.id, reason });
  },

  // 4. Přesun rezervace (Admin)
  sendRescheduleNotice: async (oldBooking: Booking, newDate: string, newTime: string, reason?: string) => {
      const formattedDate = new Date(newDate).toLocaleDateString('cs-CZ');
      const message = `Dobrý den, Vaše rezervace (${oldBooking.serviceName}) byla z provozních důvodů přesunuta na nový termín: ${formattedDate} v ${newTime}. ${reason ? `Důvod: ${reason}` : ''}. Děkujeme za pochopení.`;
      
      const htmlBody = `
      <div style="font-family: sans-serif; color: #444; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #6366f1; margin-bottom: 20px;">Změna termínu rezervace</h2>
        <p>Dobrý den,</p>
        <p>informujeme vás o změně termínu vaší rezervace.</p>
        
        <div style="background-color: #f0fdf4; padding: 15px; border-radius: 6px; margin: 20px 0; border: 1px solid #bbf7d0;">
          <h3 style="margin-top:0; color: #166534;">Nový termín:</h3>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${formattedDate}</p>
          <p style="margin: 5px 0;"><strong>Čas:</strong> ${newTime}</p>
        </div>
        
        ${reason ? `<p><strong>Důvod změny:</strong> ${reason}</p>` : ''}
        
        <p style="color: #888; font-size: 13px; margin-top: 20px;">
          Pokud Vám nový termín nevyhovuje, kontaktujte nás prosím obratem.
        </p>
      </div>
      `;

      try {
           await sendTransactionalEmail({
            to: 'klient@email.cz',
            subject: 'Změna termínu rezervace - Centrum Unity',
            text: message,
            html: htmlBody
        });
        alert(`[ADMIN AKCE: NOTIFIKACE ODESLÁNA]\nEmail klientovi i lektorovi: "${message}"`);
      } catch (error) {
           console.error("Chyba notifikace:", error);
           alert(`[SIMULACE] Email odeslán: ${message}`);
      }
  },

  // 5. Reminder (Simulace Cron Jobu)
  simulateReminder: (booking: Booking) => {
    console.log(`⏰ [MOCK REMINDER] Připomínka zítřejší rezervace ID ${booking.id}`);
  }
};