import React, { useState, useMemo } from 'react';
import { Booking } from '../types';
import { formatLocalDate } from '../utils/dateUtils';
import { calculateRentalPrice } from '../utils/scheduler';
import { useStore } from '../store/useStore';
import Button from './Button';
import { Scissors, X, CreditCard, Check, AlertCircle, Clock, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';

interface ShortenBookingModalProps {
  booking: Booking;
  onClose: () => void;
  onSuccess?: (newDuration: number, refundAmount: number) => void;
}

export const ShortenBookingModal: React.FC<ShortenBookingModalProps> = ({
  booking,
  onClose,
  onSuccess
}) => {
  const { shortenBooking } = useStore();
  const currentDuration = booking.durationMinutes || 60;

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

  const currentEndTime = formatMinutesToTime(startMinutes + currentDuration);

  // Možné nové délky: násobky 30 min přísně menší než stávající délka (min. 30 min)
  const availableDurations = useMemo(() => {
    const options: number[] = [];
    for (let d = currentDuration - 30; d >= 30; d -= 30) {
      options.push(d);
    }
    return options.sort((a, b) => b - a); // od nejdelší po nejkratší
  }, [currentDuration]);

  const [selectedDuration, setSelectedDuration] = useState<number>(availableDurations[0] || 30);
  const [reason, setReason] = useState<string>('Provozní úprava ze strany studia (zkrácení rezervace)');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const durationOptions = useMemo(() => {
    return availableDurations.map(newDur => {
      const newEndTime = formatMinutesToTime(startMinutes + newDur);
      const freedMinutes = currentDuration - newDur;
      const originalPrice = Number(booking.price) || 0;
      const newPrice = calculateRentalPrice(booking.bookedByUserId, newDur, booking.room);
      const refundAmount = Math.max(0, originalPrice - newPrice);

      return {
        newDuration: newDur,
        newEndTime,
        freedMinutes,
        newPrice,
        refundAmount
      };
    });
  }, [availableDurations, startMinutes, currentDuration, booking]);

  const activeOption = durationOptions.find(o => o.newDuration === selectedDuration) || durationOptions[0];
  const isPaidOnline = (booking.status === 'paid' || booking.status === 'completed') && (booking.paymentMethod === 'online' || !!booking.paymentId);

  const handleConfirmShorten = async () => {
    if (!activeOption) return;
    setIsProcessing(true);
    setErrorMsg(null);

    try {
      const res = await shortenBooking(booking.id, activeOption.newDuration, reason);
      if (onSuccess) {
        onSuccess(activeOption.newDuration, res.refundAmount);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Nepodařilo se zkrátit rezervaci.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-stone-100 flex justify-between items-center bg-stone-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shadow-xs">
              <Scissors className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                Zkrátit rezervaci lektora
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-full">
                  Eva (Správce)
                </span>
              </h3>
              <p className="text-xs text-stone-500">
                Uvolnění části rezervovaného času a vrácení rozdílu ceny
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-stone-800 text-sm">
          {/* Current Booking Summary */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-stone-500 font-medium">
              <span>Lektor: <strong className="text-stone-900 font-semibold">{booking.bookedByName}</strong></span>
              <span>Místnost: <strong className="text-stone-900 font-semibold">{booking.room === 1 ? 'M1 (Malá)' : 'M2 (Velká)'}</strong></span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-stone-200/60">
              <div className="flex items-center gap-1.5 text-stone-700 font-semibold">
                <Clock className="w-4 h-4 text-stone-400" />
                <span>{formatLocalDate(booking.date)}</span>
                <span className="text-stone-400">·</span>
                <span>{booking.time} – {currentEndTime}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-stone-400 mr-1.5">{currentDuration} min</span>
                <span className="font-bold text-stone-900">{booking.price} Kč</span>
              </div>
            </div>
          </div>

          {/* Duration Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">
              Vyberte novou zkrácenou délku lekce:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {durationOptions.map(opt => {
                const isSelected = opt.newDuration === selectedDuration;
                return (
                  <button
                    key={opt.newDuration}
                    type="button"
                    onClick={() => setSelectedDuration(opt.newDuration)}
                    disabled={isProcessing}
                    className={`p-3 rounded-xl border text-left transition-all relative ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/70 ring-2 ring-amber-300 shadow-xs'
                        : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900 text-sm">
                        {opt.newDuration} min
                      </span>
                      <span className="text-xs font-bold text-stone-700">
                        {opt.newPrice} Kč
                      </span>
                    </div>
                    <div className="text-[11px] text-stone-500 mt-1 flex items-center justify-between">
                      <span>Konec v {opt.newEndTime}</span>
                      <span className="text-amber-700 font-semibold">−{opt.freedMinutes} min</span>
                    </div>
                    {opt.refundAmount > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t border-amber-200/60 text-[11px] font-bold text-emerald-700 flex items-center justify-between">
                        <span>Vrátit na kartu:</span>
                        <span>+{opt.refundAmount} Kč</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Option Overview Card */}
          {activeOption && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                  Garantované vrácení rozdílu ceny
                </span>
                <span className="bg-white border border-amber-300 px-2 py-0.5 rounded-md text-amber-900">
                  Storno poplatek 0 Kč
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div className="bg-white/80 p-2 rounded-lg border border-amber-100">
                  <div className="text-[10px] uppercase font-bold text-stone-500">Nová délka</div>
                  <div className="text-sm font-bold text-stone-900">{activeOption.newDuration} min</div>
                  <div className="text-[10px] text-stone-400">do {activeOption.newEndTime}</div>
                </div>
                <div className="bg-white/80 p-2 rounded-lg border border-amber-100">
                  <div className="text-[10px] uppercase font-bold text-stone-500">Nová cena</div>
                  <div className="text-sm font-bold text-stone-900">{activeOption.newPrice} Kč</div>
                  <div className="text-[10px] text-stone-400">původně {booking.price} Kč</div>
                </div>
                <div className="bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                  <div className="text-[10px] uppercase font-bold text-emerald-800">Vráceno lektorovi</div>
                  <div className="text-sm font-bold text-emerald-700">{activeOption.refundAmount} Kč</div>
                  <div className="text-[10px] text-emerald-600 font-medium">100 % rozdílu</div>
                </div>
              </div>
              <p className="text-[11px] text-amber-900/90 leading-relaxed pt-1">
                {isPaidOnline && activeOption.refundAmount > 0 ? (
                  <>
                    Částka <strong>{activeOption.refundAmount} Kč</strong> bude lektorovi automaticky odeslána zpět na platební kartu přes GoPay. Čas od <strong>{activeOption.newEndTime}</strong> do <strong>{currentEndTime}</strong> bude ihned uvolněn v rozvrhu.
                  </>
                ) : (
                  <>
                    Cena rezervace bude snížena na <strong>{activeOption.newPrice} Kč</strong> a uvolněný čas {activeOption.freedMinutes} minut bude k dispozici pro další rezervace.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Reason Input */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-600 mb-1">
              Důvod zkrácení (bude zaznamenán v auditu i v e-mailu lektorovi):
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isProcessing}
              placeholder="Např. Provozní úprava ze strany studia"
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            />
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-2.5">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isProcessing}
            className="text-stone-600"
          >
            Zrušit
          </Button>
          <Button
            onClick={handleConfirmShorten}
            disabled={isProcessing || !activeOption}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-2 shadow-xs"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Provádím úpravu...
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                Zkrátit na {activeOption?.newDuration} min
                {activeOption && activeOption.refundAmount > 0 && ` a vrátit ${activeOption.refundAmount} Kč`}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
export default ShortenBookingModal;
