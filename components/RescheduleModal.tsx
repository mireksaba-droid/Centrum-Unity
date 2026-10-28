import React, { useState, useEffect, useMemo } from 'react';
import { Booking } from '../types';
import { GENERATED_TIMES } from '../constants';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { checkBookingCollision } from '../utils/scheduler';
import Button from './Button';
import { AlertTriangle, Clock, Calendar as CalendarIcon, X, Check, Lock, ShieldAlert, Bed, Layers } from 'lucide-react';

interface RescheduleModalProps {
  booking: Booking;
  allBookings?: Booking[];
  isPractitionerSelfService?: boolean;
  onClose: () => void;
  onConfirm: (newDate: string, newTime: string, reason?: string, newRoom?: 1 | 2, newEquipment?: 'table' | 'futon' | 'none') => void;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ 
  booking, 
  allBookings = [], 
  isPractitionerSelfService = false,
  onClose, 
  onConfirm 
}) => {
  const [newDate, setNewDate] = useState(booking.date);
  const [newTime, setNewTime] = useState(booking.time);
  const [newRoom, setNewRoom] = useState<1 | 2>(booking.room || 1);
  const [newEquipment, setNewEquipment] = useState<'table' | 'futon' | 'none'>(booking.equipment || 'table');
  const [reason, setReason] = useState('');
  const [isLateReschedule, setIsLateReschedule] = useState(false);

  const isAdminBooking = booking.bookedByUserId === 'admin';
  const hasAlreadyRescheduled = isPractitionerSelfService && (booking.rescheduleCount || 0) >= 1;

  // Check collision for target date, time, and room
  const collision = useMemo(() => {
    return checkBookingCollision({
      newDate,
      newTime,
      durationMinutes: booking.durationMinutes || 60,
      room: newRoom,
      userId: booking.bookedByUserId,
      allBookings,
      excludeBookingId: booking.id
    });
  }, [newDate, newTime, newRoom, booking, allBookings]);

  // Calculate 25h Rule Status
  useEffect(() => {
    const checkTime = () => {
        const now = new Date();
        const bookingDateTime = parseLocalDate(booking.date, booking.time);
        
        // Difference in hours
        const diffMs = bookingDateTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        
        // Admin's own bookings have no 25h block
        if (isAdminBooking) {
            setIsLateReschedule(false);
        } else {
            setIsLateReschedule(diffHours < 25);
        }
    };
    checkTime();
  }, [booking, isAdminBooking]);

  const handleSubmit = () => {
      if (collision.hasCollision) {
          alert(`Tento termín v Místnosti ${newRoom} nelze vybrat: dochází ke kolizi s dříve vytvořenou rezervací. První vytvořená rezervace má přednostní právo.`);
          return;
      }
      onConfirm(newDate, newTime, reason.trim() || undefined, newRoom, newEquipment);
  };

  const dates = Array.from({length: 30}, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-stone-200 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className={`p-4 flex justify-between items-center text-white shrink-0 ${isLateReschedule && !isPractitionerSelfService ? 'bg-amber-600' : 'bg-indigo-600'}`}>
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5" /> {isPractitionerSelfService ? 'Přesunout rezervaci (1× bezplatně)' : 'Přesunout rezervaci (Čas i Místnost)'}
                </h3>
                <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
                {/* 1-time Practitioner Reschedule Info Banner */}
                {isPractitionerSelfService && (
                    <div className={`p-3.5 rounded-xl border flex items-start gap-3 ${hasAlreadyRescheduled ? 'bg-red-50 border-red-200 text-red-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900'}`}>
                        <Clock className={`w-5 h-5 shrink-0 mt-0.5 ${hasAlreadyRescheduled ? 'text-red-600' : 'text-indigo-600'}`} />
                        <div className="text-xs leading-relaxed">
                            {hasAlreadyRescheduled ? (
                                <>
                                    <strong className="block font-bold text-sm text-red-800 mb-0.5">Limit přesunů vyčerpán (1/1)</strong>
                                    Tuto rezervaci jste již jednou přesunuli. Každou rezervaci je povoleno bezplatně přesunout pouze 1×. Pro další změny prosím kontaktujte správkyni studia (Evu).
                                </>
                            ) : (
                                <>
                                    <strong className="block font-bold text-sm text-indigo-900 mb-0.5">1× bezplatný přesun termínu</strong>
                                    Pokud vám například onemocněl klient, můžete si termín bezplatně přeobjednat na jiný volný čas a rezervace vám nepropadne. Tato možnost je k dispozici 1× pro tuto rezervaci.
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Current Info */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-sm">
                    <span className="block text-stone-500 text-xs uppercase font-bold mb-1">Původní termín a místnost</span>
                    <div className="font-bold text-stone-900 flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-stone-400" />
                        {formatLocalDate(booking.date)} v {booking.time} • Místnost {booking.room} ({booking.room === 1 ? 'Malá M1' : 'Velká M2'}) • {booking.durationMinutes} min
                    </div>
                </div>

                {/* Target Room Selection */}
                <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1.5 uppercase">Cílová Místnost</label>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setNewRoom(1)}
                            className={`p-3 rounded-xl border text-left transition-all ${
                                newRoom === 1 
                                    ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200' 
                                    : 'border-stone-200 hover:border-stone-300 bg-white'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-sm text-stone-900">Místnost 1 (Malá)</span>
                                {newRoom === 1 && <Check className="w-4 h-4 text-indigo-600" />}
                            </div>
                            <span className="text-[11px] text-stone-500 block">Křesílka & masážní lehátko</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setNewRoom(2)}
                            className={`p-3 rounded-xl border text-left transition-all ${
                                newRoom === 2 
                                    ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200' 
                                    : 'border-stone-200 hover:border-stone-300 bg-white'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-bold text-sm text-stone-900">Místnost 2 (Velká)</span>
                                {newRoom === 2 && <Check className="w-4 h-4 text-indigo-600" />}
                            </div>
                            <span className="text-[11px] text-stone-500 block">Masážní lehátko i futon</span>
                        </button>
                    </div>
                </div>

                {/* Target Equipment Selection */}
                <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1.5 uppercase">Vybavení (Lehátko / Futon)</label>
                    <div className="grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => setNewEquipment('table')}
                            className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                                newEquipment === 'table' 
                                    ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 text-indigo-900 font-bold' 
                                    : 'border-stone-200 hover:border-stone-300 bg-white text-stone-600'
                            }`}
                        >
                            <Bed className="w-4 h-4 text-indigo-600" />
                            <span className="text-xs">Lehátko</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setNewEquipment('futon')}
                            className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                                newEquipment === 'futon' 
                                    ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 text-indigo-900 font-bold' 
                                    : 'border-stone-200 hover:border-stone-300 bg-white text-stone-600'
                            }`}
                        >
                            <Layers className="w-4 h-4 text-indigo-600" />
                            <span className="text-xs">Futon</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setNewEquipment('none')}
                            className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                                newEquipment === 'none' 
                                    ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-200 text-indigo-900 font-bold' 
                                    : 'border-stone-200 hover:border-stone-300 bg-white text-stone-600'
                            }`}
                        >
                            <X className="w-4 h-4 text-stone-400" />
                            <span className="text-xs">Bez</span>
                        </button>
                    </div>
                </div>

                {/* New Date & Time Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-stone-700 mb-1 uppercase">Nové Datum</label>
                        <select 
                            value={newDate} 
                            onChange={(e) => setNewDate(e.target.value)}
                            className="w-full p-2.5 border border-stone-300 rounded-lg text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                            {dates.map(d => (
                                <option key={d} value={d}>{formatLocalDate(d)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-stone-700 mb-1 uppercase">Nový Čas</label>
                        <select 
                            value={newTime} 
                            onChange={(e) => setNewTime(e.target.value)}
                            className={`w-full p-2.5 border rounded-lg text-sm bg-white font-medium focus:ring-2 focus:ring-indigo-500 outline-none ${collision.hasCollision ? 'border-red-500 bg-red-50 text-red-900 font-bold' : 'border-stone-300'}`}
                        >
                            {GENERATED_TIMES.map(t => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Collision Warning */}
                {collision.hasCollision && (
                    <div className="animate-in slide-in-from-top-2 fade-in">
                        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <ShieldAlert className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-bold text-red-900">Kolize v Místnosti {newRoom} – nelze přesunout</h4>
                                    <p className="text-xs text-red-800 mt-1 leading-relaxed">
                                        {collision.reason || "V tomto čase již existuje dříve vytvořená rezervace nebo povinná pauza na úklid."}
                                    </p>
                                    <p className="text-[11px] text-red-700 font-semibold mt-1">
                                        Dříve vytvořená rezervace má přednostní právo. Můžete vyzkoušet druhou místnost nebo jiný čas.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 25h Warning / Info for Admin */}
                {isLateReschedule && !isAdminBooking && (
                    <div className="animate-in slide-in-from-top-2 fade-in space-y-3">
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="text-sm font-bold text-amber-900">Méně než 25 hodin do začátku</h4>
                                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                                    Jako administrátorka můžete termín lektora přesunout i v tomto okně. Změna se uloží do historie.
                                </p>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-stone-700 mb-1">Důvod změny (volitelné – např. dohoda s lektorem)</label>
                            <input 
                                type="text" 
                                value={reason} 
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Např. Nemoc lektora, domluva s klientem..."
                                className="w-full p-2.5 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-300 outline-none"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer - Always visible and pinned */}
            <div className="bg-stone-50 p-4 border-t border-stone-200 flex justify-end gap-3 shrink-0">
                <Button variant="ghost" onClick={onClose} size="sm">Zpět</Button>
                <Button 
                    onClick={handleSubmit} 
                    disabled={collision.hasCollision || hasAlreadyRescheduled}
                    className={collision.hasCollision || hasAlreadyRescheduled ? 'bg-stone-300 text-stone-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white font-bold'}
                >
                    {hasAlreadyRescheduled ? 'Již přesunuto (limit 1×)' : collision.hasCollision ? 'Nelze (Kolize)' : isPractitionerSelfService ? 'Potvrdit bezplatný přesun (1×)' : 'Potvrdit přesun'}
                </Button>
            </div>
        </div>
    </div>
  );
};

export default RescheduleModal;