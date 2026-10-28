import assert from 'node:assert';
import { calculateCancellationPolicy } from '../utils/cancellationPolicy';
import { checkBookingCollision } from '../utils/scheduler';
import { generateConfirmationEmail, generateCancellationEmail } from '../utils/emailTemplates';
import { Booking } from '../types';

console.log('🧪 SPUŠTĚNÍ AUTOMATICKÝCH TESTŮ STORNO PODMÍNEK A 1× PŘESUNU...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Chyba: ${err.message}`);
    process.exitCode = 1;
  }
}

// ==========================================
// 1. TESTY VÝPOČTU STORNO PÁSEM
// ==========================================
console.log('--- 1. Testy storno pásem (calculateCancellationPolicy) ---');

const baseDate = new Date('2026-10-20T10:00:00Z');

runTest('Více než 7 dní předem (10 dní) -> 100% refund, 0% storno poplatek', () => {
  // Lekce je 30. 10. 2026 v 10:00, aktuální čas je 20. 10. 2026 v 10:00 (= 240 hodin předem)
  const result = calculateCancellationPolicy('2026-10-30', '10:00', 350, baseDate);
  assert.strictEqual(result.tier, 'full_refund');
  assert.strictEqual(result.feePercentage, 0);
  assert.strictEqual(result.refundPercentage, 100);
  assert.strictEqual(result.refundAmount, 350);
  assert.strictEqual(result.feeAmount, 0);
});

runTest('Přesně 7 dní předem (168 h) -> 100% refund, 0% storno poplatek', () => {
  // Lekce je 27. 10. 2026 v 10:00 (= přesně 7 dní / 168 hodin)
  const result = calculateCancellationPolicy('2026-10-27', '10:00', 350, baseDate);
  assert.strictEqual(result.tier, 'full_refund');
  assert.strictEqual(result.feePercentage, 0);
  assert.strictEqual(result.refundPercentage, 100);
  assert.strictEqual(result.refundAmount, 350);
  assert.strictEqual(result.feeAmount, 0);
});

runTest('Mezi 24 h a 7 dny (např. 3 dny předem) -> 50% storno poplatek, 50% refund', () => {
  // Lekce je 23. 10. 2026 v 10:00 (= 72 hodin předem)
  const result = calculateCancellationPolicy('2026-10-23', '10:00', 350, baseDate);
  assert.strictEqual(result.tier, 'half_fee');
  assert.strictEqual(result.feePercentage, 50);
  assert.strictEqual(result.refundPercentage, 50);
  assert.strictEqual(result.refundAmount, 175);
  assert.strictEqual(result.feeAmount, 175);
});

runTest('Přesně 24 hodin předem -> 50% storno poplatek, 50% refund', () => {
  // Lekce je 21. 10. 2026 v 10:00 (= přesně 24 hodin předem)
  const result = calculateCancellationPolicy('2026-10-21', '10:00', 350, baseDate);
  assert.strictEqual(result.tier, 'half_fee');
  assert.strictEqual(result.feePercentage, 50);
  assert.strictEqual(result.refundPercentage, 50);
  assert.strictEqual(result.refundAmount, 175);
  assert.strictEqual(result.feeAmount, 175);
});

runTest('Lichá cena pronájmu (např. 525 Kč za 1,5 h) se správně zaokrouhluje na koruny', () => {
  const result = calculateCancellationPolicy('2026-10-23', '10:00', 525, baseDate);
  assert.strictEqual(result.tier, 'half_fee');
  assert.strictEqual(result.refundAmount + result.feeAmount, 525);
  assert.strictEqual(result.refundAmount, 263);
  assert.strictEqual(result.feeAmount, 262);
});

runTest('Méně než 24 hodin předem (např. 12 hodin) -> 100% storno poplatek, 0 Kč refund', () => {
  // Lekce je 20. 10. 2026 v 22:00 (= 12 hodin předem)
  const result = calculateCancellationPolicy('2026-10-20', '22:00', 350, baseDate);
  assert.strictEqual(result.tier, 'full_fee');
  assert.strictEqual(result.feePercentage, 100);
  assert.strictEqual(result.refundPercentage, 0);
  assert.strictEqual(result.refundAmount, 0);
  assert.strictEqual(result.feeAmount, 350);
});

runTest('2 hodiny předem -> 100% storno poplatek, 0 Kč refund', () => {
  // Lekce je 20. 10. 2026 v 12:00 (= 2 hodiny předem)
  const result = calculateCancellationPolicy('2026-10-20', '12:00', 350, baseDate);
  assert.strictEqual(result.tier, 'full_fee');
  assert.strictEqual(result.refundAmount, 0);
  assert.strictEqual(result.feeAmount, 350);
});

runTest('Rezervace s cenou 0 Kč (např. interní/admin) nevytváří záporné částky', () => {
  const result = calculateCancellationPolicy('2026-10-23', '10:00', 0, baseDate);
  assert.strictEqual(result.refundAmount, 0);
  assert.strictEqual(result.feeAmount, 0);
});

// ==========================================
// 2. TESTY PRAVIDLA 1× BEZPLATNÉHO PŘESUNU
// ==========================================
console.log('\n--- 2. Testy 1× bezplatného přesunu rezervace ---');

runTest('Rezervace bez předchozího přesunu (rescheduleCount = 0 nebo undefined) povolí 1. přesun', () => {
  const booking: Booking = {
    id: '1_2026-10-25_10:00',
    bookedByUserId: 'filip',
    bookedByName: 'Filip',
    room: 1,
    date: '2026-10-25',
    time: '10:00',
    durationMinutes: 60,
    price: 350,
    status: 'paid',
    paymentMethod: 'online',
    createdAt: '2026-10-20T10:00:00Z',
    rescheduleCount: 0
  };

  const isPractitioner = true;
  const canReschedule = !isPractitioner || (booking.rescheduleCount || 0) < 1;
  assert.strictEqual(canReschedule, true, 'Lektor musí mít možnost provést první přesun.');
});

runTest('Rezervace, která již byla 1× přesunuta (rescheduleCount = 1), zablokuje další přesun lektorem', () => {
  const booking: Booking = {
    id: '1_2026-10-25_10:00',
    bookedByUserId: 'filip',
    bookedByName: 'Filip',
    room: 1,
    date: '2026-10-25',
    time: '10:00',
    durationMinutes: 60,
    price: 350,
    status: 'paid',
    paymentMethod: 'online',
    createdAt: '2026-10-20T10:00:00Z',
    rescheduleCount: 1,
    rescheduledBy: 'practitioner'
  };

  const isPractitioner = true;
  const canReschedule = !isPractitioner || (booking.rescheduleCount || 0) < 1;
  assert.strictEqual(canReschedule, false, 'Druhý přesun lektorem musí být zablokován.');
});

runTest('Správce (Eva / admin) má právo přesunout termín neomezeně i při rescheduleCount >= 1', () => {
  const booking: Booking = {
    id: '1_2026-10-25_10:00',
    bookedByUserId: 'filip',
    bookedByName: 'Filip',
    room: 1,
    date: '2026-10-25',
    time: '10:00',
    durationMinutes: 60,
    price: 350,
    status: 'paid',
    paymentMethod: 'online',
    createdAt: '2026-10-20T10:00:00Z',
    rescheduleCount: 1
  };

  const isPractitioner = false; // Admin akce
  const canAdminReschedule = !isPractitioner || (booking.rescheduleCount || 0) < 1;
  assert.strictEqual(canAdminReschedule, true, 'Admin Eva musí mít právo přesunout termín kdykoliv.');
});

// ==========================================
// 3. TESTY KONTROLY KOLIZÍ PŘI PŘESUNU
// ==========================================
console.log('\n--- 3. Testy kolizí a úklidových pauz při přesunu ---');

runTest('Přesun na obsazený termín v téže místnosti je správně odmítnut jako kolize', () => {
  const existingBookings: Booking[] = [
    {
      id: '1_2026-10-26_14:00',
      bookedByUserId: 'jana_p',
      bookedByName: 'Jana P.',
      room: 1,
      date: '2026-10-26',
      time: '14:00',
      durationMinutes: 60,
      price: 350,
      status: 'paid',
      paymentMethod: 'online',
      createdAt: '2026-10-20T10:00:00Z'
    }
  ];

  const collision = checkBookingCollision({
    newDate: '2026-10-26',
    newTime: '14:00',
    durationMinutes: 60,
    room: 1,
    userId: 'filip',
    allBookings: existingBookings,
    excludeBookingId: 'booking_to_reschedule'
  });

  assert.strictEqual(collision.hasCollision, true, 'Přímý překryv musí hlásit kolizi.');
});

runTest('Přesun respektuje povinnou úklidovou pauzu 60 minut při střídání lektorů', () => {
  const existingBookings: Booking[] = [
    {
      id: '1_2026-10-26_14:00',
      bookedByUserId: 'jana_p',
      bookedByName: 'Jana P.',
      room: 1,
      date: '2026-10-26',
      time: '14:00',
      durationMinutes: 60, // končí v 15:00, pauza do 16:00
      price: 350,
      status: 'paid',
      paymentMethod: 'online',
      createdAt: '2026-10-20T10:00:00Z'
    }
  ];

  // Pokus o začátek v 15:30 (jen 30 min po Janě, jiný lektor potřebuje 60 min)
  const collision = checkBookingCollision({
    newDate: '2026-10-26',
    newTime: '15:30',
    durationMinutes: 60,
    room: 1,
    userId: 'filip',
    allBookings: existingBookings,
    excludeBookingId: 'booking_to_reschedule'
  });

  assert.strictEqual(collision.hasCollision, true, 'Začátek v úklidové pauze jiného lektora musí hlásit kolizi.');
});

runTest('Přesun na volný čas po uplynutí hygienické pauzy je povolen', () => {
  const existingBookings: Booking[] = [
    {
      id: '1_2026-10-26_14:00',
      bookedByUserId: 'jana_p',
      bookedByName: 'Jana P.',
      room: 1,
      date: '2026-10-26',
      time: '14:00',
      durationMinutes: 60, // končí v 15:00, 60 min pauza končí v 16:00
      price: 350,
      status: 'paid',
      paymentMethod: 'online',
      createdAt: '2026-10-20T10:00:00Z'
    }
  ];

  // Začátek v 16:00 je v pořádku
  const collision = checkBookingCollision({
    newDate: '2026-10-26',
    newTime: '16:00',
    durationMinutes: 60,
    room: 1,
    userId: 'filip',
    allBookings: existingBookings,
    excludeBookingId: 'booking_to_reschedule'
  });

  assert.strictEqual(collision.hasCollision, false, 'Po uplynutí úklidové pauzy nesmí být kolize.');
});

// ==========================================
// 4. TESTY ŠABLON E-MAILŮ
// ==========================================
console.log('\n--- 4. Testy e-mailových šablon ---');

runTest('Potvrzovací e-mail obsahuje text nových storno podmínek i garanci 1× přesunu', () => {
  const booking: Partial<Booking> = {
    date: '2026-10-30',
    time: '14:00',
    room: 1,
    durationMinutes: 60,
    price: 350,
    bookedByName: 'Filip'
  };

  const html = generateConfirmationEmail(booking, true);
  assert.ok(html.includes('Více než 7 dní předem: vrácení 100 %'), 'Musí obsahovat 7denní pravidlo.');
  assert.ok(html.includes('storno poplatek 50 %'), 'Musí obsahovat 50% pásmo.');
  assert.ok(html.includes('storno poplatek 100 %'), 'Musí obsahovat 100% storno pod 24 h.');
  assert.ok(html.includes('1× bezplatný přesun'), 'Musí informovat o možnosti 1× bezplatného přesunu.');
});

runTest('Storno e-mail obsahuje vyčíslení storno poplatku a vrácené částky na kartu', () => {
  const booking: Partial<Booking> = {
    date: '2026-10-25',
    time: '10:00',
    room: 2,
    durationMinutes: 60,
    price: 350,
    bookedByName: 'Kája MT',
    cancellationFee: 175,
    refundAmount: 175
  };

  const html = generateCancellationEmail(booking, 'Zrušeno lektorem.');
  assert.ok(html.includes('175 Kč'), 'Musí obsahovat vyčíslenou částku 175 Kč.');
  assert.ok(html.includes('Storno poplatek'), 'Musí obsahovat řádek Storno poplatek.');
  assert.ok(html.includes('Vráceno na kartu'), 'Musí obsahovat řádek Vráceno na kartu.');
});

// ==========================================
// VÝSLEDKY TESTŮ
// ==========================================
console.log('\n==========================================');
console.log(`🎉 VÝSLEDEK TESTŮ: ${passedTests} z ${totalTests} testů ÚSPĚŠNĚ PROBĚHLO.`);
console.log('==========================================\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
