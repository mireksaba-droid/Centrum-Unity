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
