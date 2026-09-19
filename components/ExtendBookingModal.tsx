import React, { useState, useMemo } from 'react';
import { Booking, GroupEvent } from '../types';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { checkBookingCollision, calculateRentalPrice } from '../utils/scheduler';
import { useStore } from '../store/useStore';
import Button from './Button';
import { Clock, X, CreditCard, Check, AlertCircle, Sparkles, ArrowRight, ExternalLink, RefreshCw } from 'lucide-react';

interface ExtendBookingModalProps {
  booking: Booking;
  allBookings?: Booking[];
  groupEvents?: GroupEvent[];
  onClose: () => void;
  onSuccess?: (newDuration: number, newPrice: number) => void;
}

export const ExtendBookingModal: React.FC<ExtendBookingModalProps> = ({
  booking,
  allBookings = [],
  groupEvents = [],
  onClose,
  onSuccess
}) => {
  const { token, currentUser, extendBooking } = useStore();
  const [selectedExtraMinutes, setSelectedExtraMinutes] = useState<number>(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Převod skupinových akcí na formát kompatibilní s allBookings
  const combinedBookings = useMemo(() => {
    const geAsBookings: Booking[] = groupEvents.map(ge => {
      const [startH, startM] = (ge.startTime || '00:00').split(':').map(Number);
      const [endH, endM] = (ge.endTime || '01:00').split(':').map(Number);
      const dur = Math.max(30, (endH * 60 + endM) - (startH * 60 + startM));
      return {
        id: `ge_${ge.id}`,
        room: 2,
        date: ge.date,
        time: ge.startTime,
        durationMinutes: dur,
        bookedByUserId: ge.practitionerId || 'admin',
        bookedByName: ge.practitionerName || 'Skupinová akce',
        status: 'paid' as const,
        price: 0,
        paymentMethod: 'invoice' as const,
        createdAt: ge.createdAt
      };
    });
    return [...allBookings, ...geAsBookings];
  }, [allBookings, groupEvents]);

  // Pomocné funkce pro výpočet časů
  const startMinutes = useMemo(() => {
    if (!booking.time) return 0;
    const [h, m] = booking.time.split(':').map(Number);
    return h * 60 + m;
  }, [booking.time]);

  const formatMinutesToTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const currentDuration = booking.durationMinutes || 60;
  const currentEndTime = formatMinutesToTime(startMinutes + currentDuration);

  // Zjištění, zda jsme v ochranném pásmu (24 h před začátkem akce a během akce)
  const isInProtectiveZone = useMemo(() => {
    if (!booking.date || !booking.time) return false;
    const bookingStart = parseLocalDate(booking.date, booking.time);
    const bookingEnd = new Date(bookingStart.getTime() + (booking.durationMinutes || 60) * 60000);
    const protectiveStart = new Date(bookingStart.getTime() - 24 * 60 * 60 * 1000);
    const now = new Date();
    return now >= protectiveStart && now <= bookingEnd;
  }, [booking.date, booking.time, booking.durationMinutes]);

  // Možné varianty prodloužení:
  // V ochranném pásmu (24 h před akcí a během akce): minimálně 1 hodina (60 min), dále po 30 min (60, 90, 120, 150, 180 min)
  // Mimo ochranné pásmo (>24 h před akcí): od 30 min po 30 min (30, 60, 90, 120, 150, 180 min)
  const candidateIncrements = useMemo(() => {
    return isInProtectiveZone ? [60, 90, 120, 150, 180] : [30, 60, 90, 120, 150, 180];
  }, [isInProtectiveZone]);

  const extensionOptions = useMemo(() => {
    return candidateIncrements.map(extra => {
      const newDuration = currentDuration + extra;
      const newEndTime = formatMinutesToTime(startMinutes + newDuration);
      
      const collision = checkBookingCollision({
        newDate: booking.date,
        newTime: booking.time,
        durationMinutes: newDuration,
        room: booking.room,
        userId: booking.bookedByUserId,
        allBookings: combinedBookings,
        excludeBookingId: booking.id
      });

      const newTotalPrice = calculateRentalPrice(booking.bookedByUserId, newDuration, booking.room);
      const diffPrice = Math.max(0, newTotalPrice - (booking.price || 0));

      return {
        extraMinutes: extra,
        newDuration,
        newEndTime,
        hasCollision: collision.hasCollision,
        collisionReason: collision.reason,
        diffPrice,
        newTotalPrice
      };
    });
  }, [candidateIncrements, currentDuration, startMinutes, booking, combinedBookings]);

  // Dostupné možnosti (bez kolize)
  const availableOptions = extensionOptions.filter(opt => !opt.hasCollision);

  // Výchozí vybraná možnost: první dostupná
  React.useEffect(() => {
    if (availableOptions.length > 0 && !availableOptions.some(o => o.extraMinutes === selectedExtraMinutes)) {
      setSelectedExtraMinutes(availableOptions[0].extraMinutes);
    }
  }, [availableOptions, selectedExtraMinutes]);

  const selectedOption = extensionOptions.find(o => o.extraMinutes === selectedExtraMinutes) || availableOptions[0];

  const handleStartExtension = async () => {
    if (!selectedOption || selectedOption.hasCollision) {
      setErrorMsg('Vybrané prodloužení není dostupné z důvodu kolize.');
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const cleanBase = window.location.origin;
      const res = await fetch('/api/create-extension-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          bookingId: booking.id,
          extraMinutes: selectedOption.extraMinutes,
          returnUrl: window.location.href
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Nepodařilo se vytvořit platbu za prodloužení.');
      }

      // Prodloužení zdarma (0 Kč)
      if (data.paid) {
        await extendBooking(booking.id, selectedOption.extraMinutes, selectedOption.newTotalPrice);
        setSuccessMsg(`Rezervace byla úspěšně prodloužena o +${selectedOption.extraMinutes} min.`);
        if (onSuccess) onSuccess(selectedOption.newDuration, selectedOption.newTotalPrice);
        setTimeout(() => {
          onClose();
        }, 1500);
        return;
      }

      // GoPay platba
      if (data.gwUrl) {
        setPaymentUrl(data.gwUrl);
        setPaymentId(String(data.paymentId));
        // Otevření platební brány v novém okně (kvůli iframe pravidlu)
        const newWindow = window.open(data.gwUrl, '_blank');
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          // Popup byl zablokován prohlížečem -> uživatel klikne na tlačítko v modalu
          console.warn("Popup blocked, showing direct link button in modal.");
        }
      }
    } catch (err: any) {
      console.error("Extension error:", err);
      setErrorMsg(err.message || 'Nastala neočekávaná chyba při přípravě prodloužení.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCheckPaymentStatus = async () => {
    if (!paymentId) return;
    setIsCheckingPayment(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/gopay/status?id=${encodeURIComponent(paymentId)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.state === 'PAID') {
        if (selectedOption) {
          await extendBooking(booking.id, selectedOption.extraMinutes, selectedOption.newTotalPrice);
        }
        setSuccessMsg('Platba byla úspěšně ověřena! Rezervace je prodloužena.');
        if (onSuccess && selectedOption) {
          onSuccess(selectedOption.newDuration, selectedOption.newTotalPrice);
        }
        setTimeout(() => {
          onClose();
        }, 1800);
      } else if (data.state === 'CANCELED' || data.state === 'TIMEOUTED') {
        setErrorMsg('Platba v platební bráně byla zrušena nebo vypršela.');
        setPaymentUrl(null);
        setPaymentId(null);
      } else {
        setErrorMsg(`Platba zatím nebyla dokončena (aktuální stav: ${data.state || 'čeká na úhradu'}). Dokončete ji prosím v okně GoPay.`);
      }
    } catch (err: any) {
      setErrorMsg('Nepodařilo se ověřit stav platby. Zkuste to prosím za chvíli.');
    } finally {
      setIsCheckingPayment(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" id="extend-booking-modal-overlay">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-stone-200" id="extend-booking-modal-card">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 p-5 flex justify-between items-center text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-xs border border-white/20">
              <Clock className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h3 className="font-bold text-lg leading-tight">Prodloužit rezervaci</h3>
              <p className="text-xs text-emerald-200 font-normal">Navýšení délky pronájmu s okamžitým doplatkem</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors"
            id="close-extend-modal-btn"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Informace o aktuální rezervaci */}
          <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
            <div className="text-xs uppercase font-bold text-stone-500 tracking-wider mb-2">Aktuální rezervace</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-stone-500 block text-xs">Datum & Místnost:</span>
                <span className="font-semibold text-stone-900">
                  {formatLocalDate(booking.date)} • Místnost {booking.room} ({booking.room === 1 ? 'M1' : 'M2'})
                </span>
              </div>
              <div>
                <span className="text-stone-500 block text-xs">Aktuální čas:</span>
                <span className="font-semibold text-stone-900">
                  {booking.time} – {currentEndTime} ({currentDuration} min)
                </span>
              </div>
            </div>
          </div>

          {/* Úspěchová hláška */}
          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="text-sm font-medium">{successMsg}</div>
            </div>
          )}

          {/* Chybová hláška */}
          {errorMsg && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-sm">{errorMsg}</div>
            </div>
          )}

          {/* Pokud není k dispozici ŽÁDNÉ prodloužení */}
          {availableOptions.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-base">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                Prodloužení není možné
              </div>
              <p className="text-sm text-amber-800 leading-relaxed">
                Ihned po této rezervaci následuje další program studia nebo povinná pauza na úklid (30 min stejný lektor / 60 min střídání). Prodloužení v tomto termínu nelze provést.
              </p>
            </div>
          ) : !paymentUrl ? (
            /* Výběr doby prodloužení */
            <div className="space-y-4">
              {isInProtectiveZone && (
                <div className="bg-amber-50/80 border border-amber-200 text-amber-900 rounded-xl p-3 flex items-start gap-2.5 text-xs">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold block text-amber-950">Ochranné pásmo (24 h před akcí a během akce)</strong>
                    V tomto časovém okně lze rezervaci prodloužit <strong>minimálně o 1 hodinu (60 min)</strong>, následně po 30 minutách (+90 min, +120 min...).
                  </div>
                </div>
              )}

              <label className="block text-sm font-bold text-stone-800">
                Zvolte, o kolik chcete rezervaci prodloužit:
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {extensionOptions.map(opt => {
                  const isSelected = selectedExtraMinutes === opt.extraMinutes && !opt.hasCollision;
                  return (
                    <button
                      key={opt.extraMinutes}
                      type="button"
                      disabled={opt.hasCollision || isProcessing}
                      onClick={() => !opt.hasCollision && setSelectedExtraMinutes(opt.extraMinutes)}
                      className={`p-3.5 rounded-xl border text-left transition-all relative ${
                        opt.hasCollision
                          ? 'bg-stone-100 border-stone-200 opacity-50 cursor-not-allowed text-stone-400'
                          : isSelected
                          ? 'bg-emerald-50/80 border-emerald-600 shadow-xs ring-2 ring-emerald-600/20 text-emerald-950'
                          : 'bg-white border-stone-200 hover:border-emerald-300 hover:bg-stone-50/60 text-stone-800'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-base flex items-center gap-1.5">
                          +{opt.extraMinutes} min
                          {isSelected && <Check className="w-4 h-4 text-emerald-600" />}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          opt.hasCollision
                            ? 'bg-stone-200 text-stone-500'
                            : isSelected
                            ? 'bg-emerald-200/70 text-emerald-900'
                            : 'bg-stone-100 text-stone-700'
                        }`}>
                          {opt.diffPrice > 0 ? `+${opt.diffPrice} Kč` : '0 Kč'}
                        </span>
                      </div>
                      <div className="text-xs text-stone-500">
                        Nový konec: <strong>{opt.newEndTime}</strong> ({opt.newDuration} min)
                      </div>
                      {opt.hasCollision && (
                        <div className="text-[11px] text-rose-600 mt-1 font-medium">
                          Obsazeno / kolize
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Shrnutí vybraného prodloužení */}
              {selectedOption && !selectedOption.hasCollision && (
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    Shrnutí po prodloužení
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                      <span className="text-stone-500 block">Nový čas rezervace:</span>
                      <span className="font-bold text-stone-900 text-sm">{booking.time} – {selectedOption.newEndTime}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                      <span className="text-stone-500 block">Celková délka:</span>
                      <span className="font-bold text-stone-900 text-sm">{selectedOption.newDuration} minut</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-emerald-200/60 flex justify-between items-center">
                    <span className="text-xs text-stone-600">Doplatek přes GoPay:</span>
                    <span className="text-base font-extrabold text-emerald-800">
                      {selectedOption.diffPrice > 0 ? `${selectedOption.diffPrice} Kč` : '0 Kč'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Stav čekání na platbu GoPay */
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center space-y-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-700">
                <CreditCard className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-emerald-950 text-base mb-1">Platební brána otevřena</h4>
                <p className="text-xs text-emerald-800 max-w-sm mx-auto leading-relaxed">
                  GoPay brána byla otevřena v novém okně. Proveďte prosím úhradu doplatku <strong>{selectedOption?.diffPrice || 0} Kč</strong>.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow-xs transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Přejít na bránu GoPay
                </a>
                <button
                  type="button"
                  onClick={handleCheckPaymentStatus}
                  disabled={isCheckingPayment}
                  className="inline-flex items-center justify-center gap-1.5 bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-900 text-xs font-bold py-2.5 px-4 rounded-xl transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${isCheckingPayment ? 'animate-spin text-emerald-600' : ''}`} />
                  {isCheckingPayment ? 'Ověřuji...' : 'Zkontrolovat stav úhrady'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-stone-50 border-t border-stone-200 flex justify-end gap-2.5">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            id="cancel-extend-modal-btn"
          >
            Zavřít
          </Button>
          {availableOptions.length > 0 && !paymentUrl && (
            <Button
              onClick={handleStartExtension}
              disabled={isProcessing || !selectedOption || selectedOption.hasCollision}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold"
              id="confirm-extend-booking-btn"
            >
              {isProcessing ? (
                'Zpracovávám...'
              ) : selectedOption && selectedOption.diffPrice > 0 ? (
                <>
                  <CreditCard className="w-4 h-4 mr-1.5" />
                  Zaplatit doplatek ({selectedOption.diffPrice} Kč)
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  Potvrdit prodloužení (0 Kč)
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExtendBookingModal;
