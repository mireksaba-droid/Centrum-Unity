import React, { useState, useEffect, useMemo } from 'react';
import { Booking } from '../types';
import { GENERATED_TIMES } from '../constants';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { checkBookingCollision } from '../utils/scheduler';
import Button from './Button';
import { AlertTriangle, Clock, Calendar as CalendarIcon, X, Check, Lock, ShieldAlert } from 'lucide-react';

interface RescheduleModalProps {
  booking: Booking;
  allBookings?: Booking[];
  onClose: () => void;
  onConfirm: (newDate: string, newTime: string, reason?: string) => void;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ booking, allBookings = [], onClose, onConfirm }) => {
  const [newDate, setNewDate] = useState(booking.date);
  const [newTime, setNewTime] = useState(booking.time);
  const [reason, setReason] = useState('');
  const [isOverrideConfirmed, setIsOverrideConfirmed] = useState(false);
  const [isLateReschedule, setIsLateReschedule] = useState(false);

  // Check collision for target date and time
  const collision = useMemo(() => {
    return checkBookingCollision({
      newDate,
      newTime,
      durationMinutes: booking.durationMinutes || 60,
      room: booking.room,
      userId: booking.bookedByUserId,
      allBookings,
      excludeBookingId: booking.id
    });
  }, [newDate, newTime, booking, allBookings]);

  // Calculate 25h Rule Status
  useEffect(() => {
    const checkTime = () => {
        const now = new Date();
        const bookingDateTime = parseLocalDate(booking.date, booking.time);
        
        // Difference in hours
        const diffMs = bookingDateTime.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);
        
        // If booking is in the past, it's also considered "late" (or impossible, but for admin we allow it with reason)
        // Rule: If less than 25 hours remaining, flag it.
        setIsLateReschedule(diffHours < 25);
    };
    checkTime();
  }, [booking]);

  const handleSubmit = () => {
      if (collision.hasCollision) {
          alert(`Tento termín nelze vybrat: dochází ke kolizi s dříve vytvořenou rezervací. První vytvořená rezervace má přednostní právo.`);
          return;
      }
      if (isLateReschedule && !reason.trim()) {
          alert("Při pozdní změně (méně než 25h) je nutné vyplnit důvod pro Audit log.");
          return;
      }
      onConfirm(newDate, newTime, reason);
  };

  const dates = Array.from({length: 14}, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-stone-200">
            {/* Header */}
            <div className={`p-4 flex justify-between items-center text-white ${isLateReschedule ? 'bg-indigo-600' : 'bg-sage-600'}`}>
                <h3 className="font-bold text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5" /> Přesunout rezervaci
                </h3>
                <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 space-y-6">
                {/* Current Info */}
                <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-sm">
                    <span className="block text-stone-500 text-xs uppercase font-bold mb-1">Původní termín</span>
                    <div className="font-bold text-stone-900 flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-stone-400" />
                        {formatLocalDate(booking.date)} v {booking.time} (Místnost M{booking.room}, {booking.durationMinutes} min)
                    </div>
                </div>

                {/* New Selection */}
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-stone-500 mb-1">Nové Datum</label>
                        <select 
                            value={newDate} 
                            onChange={(e) => setNewDate(e.target.value)}
                            className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white"
                        >
                            {dates.map(d => (
                                <option key={d} value={d}>{formatLocalDate(d)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-stone-500 mb-1">Nový Čas</label>
                        <select 
                            value={newTime} 
                            onChange={(e) => setNewTime(e.target.value)}
                            className={`w-full p-2 border rounded-lg text-sm bg-white ${collision.hasCollision ? 'border-red-500 bg-red-50 text-red-900 font-bold' : 'border-stone-300'}`}
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
                                    <h4 className="text-sm font-bold text-red-900">Kolize termínu – nelze přesunout</h4>
                                    <p className="text-xs text-red-800 mt-1 leading-relaxed">
                                        {collision.reason || "V tomto čase již existuje dříve vytvořená rezervace nebo povinná pauza na úklid."}
                                    </p>
                                    <p className="text-[11px] text-red-700 font-semibold mt-1">
                                        Dříve vytvořená rezervace má přednostní právo. Zvolte prosím jiný čas nebo den.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 25h Warning / Soft Block Logic */}
                {isLateReschedule && (
                    <div className="animate-in slide-in-from-top-2 fade-in">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-bold text-amber-800">Méně než 25 hodin do začátku</h4>
                                    <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                                        Standardně nelze rezervaci takto blízko termínu měnit. 
                                        Jako administrátor můžete toto pravidlo obejít, ale akce bude zaznamenána v Audit logu.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-stone-700 mb-1">Důvod změny (Povinné pro Audit Log)</label>
                                <input 
                                    type="text" 
                                    value={reason} 
                                    onChange={(e) => setReason(e.target.value)}
                                    placeholder="Např. Nemoc lektora, dohoda s klientem..."
                                    className="w-full p-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-red-200 outline-none"
                                />
                            </div>
                            
                            <label className="flex items-center gap-2 p-3 border border-stone-200 rounded-lg cursor-pointer hover:bg-stone-50 transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={isOverrideConfirmed}
                                    onChange={(e) => setIsOverrideConfirmed(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 rounded border-stone-300 focus:ring-indigo-500"
                                />
                                <span className="text-sm font-medium text-stone-700">Potvrzuji vynucenou změnu</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="bg-stone-50 p-4 border-t border-stone-200 flex justify-end gap-3">
                <Button variant="ghost" onClick={onClose} size="sm">Zrušit</Button>
                <Button 
                    onClick={handleSubmit} 
                    disabled={collision.hasCollision || (isLateReschedule && (!isOverrideConfirmed || !reason.trim()))}
                    className={collision.hasCollision ? 'bg-stone-300 text-stone-500 cursor-not-allowed' : isLateReschedule ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-sage-600 text-white'}
                >
                    {collision.hasCollision ? 'Nelze (Kolize)' : isLateReschedule ? 'Vynutit změnu' : 'Potvrdit přesun'}
                </Button>
            </div>
        </div>
    </div>
  );
};

export default RescheduleModal;