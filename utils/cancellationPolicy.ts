/**
 * Pravidla storno poplatků Centra Unity:
 * • Více než 7 dní před začátkem rezervace – vrácení 100 % částky (storno poplatek 0 %).
 * • 7 dní až 24 hodin před začátkem rezervace – storno poplatek 50 % (vrácení 50 % částky).
 * • Méně než 24 hodin před začátkem rezervace – storno poplatek 100 % (částka se nevrací).
 */

export interface CancellationPolicyResult {
  hoursDifference: number;
  daysDifference: number;
  tier: 'full_refund' | 'half_fee' | 'full_fee';
  feePercentage: number;     // 0, 50, 100
  refundPercentage: number;  // 100, 50, 0
  feeAmount: number;         // v Kč
  refundAmount: number;      // v Kč
  label: string;
  description: string;
}

export const CANCELLATION_POLICY_EFFECTIVE_DATE = '2026-11-01';

export function calculateCancellationPolicy(
  dateStr: string,
  timeStr: string,
  price: number,
  now: Date = new Date()
): CancellationPolicyResult {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const reservationDateTime = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);

  const diffMs = reservationDateTime.getTime() - now.getTime();
  const hoursDifference = diffMs / (1000 * 60 * 60);
  const daysDifference = hoursDifference / 24;

  const validPrice = Math.max(0, Number(price) || 0);

  // Kontrola data účinnosti (1. listopadu 2026):
  // Pokud storno probíhá ještě v říjnu 2026 pro říjnový termín, uplatňuje se původní pravidlo
  // (> 24 h = 100 % vrácení), aby nová pravidla neplatila zpětně před 1. 11. 2026.
  const isBeforeEffective = now < new Date('2026-11-01T00:00:00') && (dateStr || '') < '2026-11-01';

  if (isBeforeEffective) {
    if (hoursDifference >= 24) {
      return {
        hoursDifference,
        daysDifference,
        tier: 'full_refund',
        feePercentage: 0,
        refundPercentage: 100,
        feeAmount: 0,
        refundAmount: validPrice,
        label: 'Více než 24 h předem (platnost do 31. 10.)',
        description: 'V přechodném období do 31. 10. 2026 je při zrušení více než 24 h předem vráceno 100 % částky. Nové 3 storno pásma vstupují v účinnost od 1. 11. 2026.'
      };
    } else {
      return {
        hoursDifference,
        daysDifference,
        tier: 'full_fee',
        feePercentage: 100,
        refundPercentage: 0,
        feeAmount: validPrice,
        refundAmount: 0,
        label: 'Méně než 24 hodin předem',
        description: 'Storno poplatek 100 %. Zaplacená částka se nevrací.'
      };
    }
  }

  // S účinností od 1. listopadu 2026 (a pro všechny rezervace od 1. 11. 2026):
  // 1. Více než 7 dní (168 h): vrácení 100 %, storno poplatek 0 %
  if (hoursDifference >= 168) {
    return {
      hoursDifference,
      daysDifference,
      tier: 'full_refund',
      feePercentage: 0,
      refundPercentage: 100,
      feeAmount: 0,
      refundAmount: validPrice,
      label: 'Více než 7 dní před začátkem',
      description: 'Storno poplatek 0 %. Bude vám vráceno 100 % zaplacené částky.'
    };
  }

  // 2. 7 dní až 24 hodin (24 h – 168 h): storno poplatek 50 %
  if (hoursDifference >= 24) {
    const refund = Math.round(validPrice * 0.5);
    const fee = validPrice - refund;
    return {
      hoursDifference,
      daysDifference,
      tier: 'half_fee',
      feePercentage: 50,
      refundPercentage: 50,
      feeAmount: fee,
      refundAmount: refund,
      label: '7 dní až 24 hodin před začátkem',
      description: 'Storno poplatek 50 %. Bude vám vrácena polovina (50 %) zaplacené částky.'
    };
  }

  // 3. Méně než 24 hodin (< 24 h): storno poplatek 100 %
  return {
    hoursDifference,
    daysDifference,
    tier: 'full_fee',
    feePercentage: 100,
    refundPercentage: 0,
    feeAmount: validPrice,
    refundAmount: 0,
    label: 'Méně než 24 hodin před začátkem',
    description: 'Storno poplatek 100 %. Zaplacená částka se nevrací.'
  };
}
