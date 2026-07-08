import React, { useState } from 'react';
import { Practitioner, Booking } from '../types';
import { GENERATED_TIMES, CATEGORIES, BUFFER_SAME_USER, BUFFER_DIFF_USER } from '../constants';
import { MiniCalendar } from '../components/MiniCalendar';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Users, Sparkles, AlertCircle, Filter, X } from 'lucide-react';

interface CalendarViewProps {
  practitioners: Practitioner[];
  bookings: Booking[];
  onBook: (practitioner: Practitioner, date: string, time: string) => void;
  isAdmin?: boolean;
}

const DAYS_MAP = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

// Helper to convert time string to minutes
const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

const CalendarView: React.FC<CalendarViewProps> = ({ practitioners, bookings, onBook, isAdmin = false }) => {
  const [currentWeekStart, setCurrentWeekStart] = useState(new Date());
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  
  // State for the "Show All" modal when a slot has too many people
  const [expandedSlot, setExpandedSlot] = useState<{date: Date, time: string, people: Practitioner[]} | null>(null);

  // Helper to move weeks
  const changeWeek = (offset: number) => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + (offset * 7));
    setCurrentWeekStart(newDate);
  };

  // Generate dates for the view (Monday to Friday)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart);
    // Adjust to Monday of current week if today isn't Monday
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    d.setDate(diff + i);
    return d;
  });

  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  const getAvailablePractitionersForSlot = (date: Date, time: string) => {
    const dateStr = formatDate(date);
    const dayName = DAYS_MAP[date.getDay()]; // "Po", "Út"...
    const availabilityKey = `${dayName}-${time}`;
    
    // Convert current slot time to minutes for overlap check
    const slotStartMinutes = timeToMinutes(time);

    // Filter Practitioners
    return practitioners.filter(p => {
      // 0. EXCLUDE RENTALS
      if (p.category === 'Pronájem prostor' || p.id === 'rental') return false;

      // ADMIN: Show all practitioners
      if (isAdmin) return true;

      // 1. Availability Template
      const avail = p.availability || [];
      if (!avail.includes(availabilityKey)) return false;

      // 2. Personal Booking (If practitioner is already booked somewhere else at this time)
      const isPersonallyBooked = bookings.some(b => {
          if (b.date !== dateStr || !['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status) || b.practitionerId !== p.id) return false;
          const bStart = timeToMinutes(b.time);
          const bEnd = bStart + b.durationMinutes;
          // Check overlap with slot start
          return (slotStartMinutes >= bStart && slotStartMinutes < bEnd);
      });
      if (isPersonallyBooked) return false;

      // 3. Room Constraints & DYNAMIC BUFFER
      const needsRoom1 = p.services.some(s => s.type === '1-1' || s.targetRoom === 1);
      const needsRoom2 = p.services.some(s => s.type === 'group' || s.targetRoom === 2);
      
      const isRoomAvailableForP = (roomNum: 1 | 2) => {
          // Check if any booking in this room blocks P
          return !bookings.some(b => {
                if (b.date !== dateStr || !['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status) || b.room !== roomNum) return false;
                
                const bStart = timeToMinutes(b.time);
                const bEnd = bStart + b.durationMinutes;
                
                // DYNAMIC BUFFER:
                // If the existing booking is by P -> 30 min buffer.
                // If the existing booking is by someone else -> 60 min buffer.
                const bufferAfterB = (b.practitionerId === p.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
                const blockedUntil = bEnd + bufferAfterB;
                
                // Is the slot start time blocked?
                // Booking interval: [bStart, bEnd]
                // Cleaning interval: [bEnd, blockedUntil]
                
                if (slotStartMinutes >= bStart && slotStartMinutes < blockedUntil) return true;
                
                return false;
          });
      };
      
      if (needsRoom1 && !isRoomAvailableForP(1)) return false;
      if (needsRoom2 && !isRoomAvailableForP(2)) {
          // For Room 2, we might have different logic for groups, but assuming strict slot booking here.
          return false;
      }

      return true;
    });
  };

  // Helper to render a practitioner button (used in both grid and modal)
  const renderPractitionerButton = (p: Practitioner, date: Date, time: string) => (
      <button
          key={p.id}
          onClick={() => {
              onBook(p, formatDate(date), time);
              setExpandedSlot(null);
          }}
          className="w-full text-left bg-white border border-stone-200 rounded-lg p-1.5 shadow-sm hover:shadow-md hover:border-sage-300 hover:ring-1 hover:ring-sage-300 transition-all group mb-1 last:mb-0"
      >
          <div className="flex items-center justify-between gap-1 mb-0.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-sage-600 bg-sage-50 px-1 py-0.5 rounded-sm truncate max-w-[80px]">
                  {p.category.split(' ')[0]}
              </span>
              <Sparkles className="w-2.5 h-2.5 text-stone-300 group-hover:text-sage-500 flex-shrink-0" />
          </div>
          <div className="text-xs font-bold text-stone-800 leading-tight truncate">
              {p.name}
          </div>
      </button>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12 relative">
      {/* Header */}
      <div className="flex flex-col gap-6 pt-4 px-2">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
            <div>
               <h1 className="text-3xl font-bold text-stone-900 font-heading">Rozvrh dostupných lektorů</h1>
               <p className="text-stone-600">Vyberte si termín a rezervujte si své místo.</p>
            </div>
            
            {/* Week Navigation */}
            <div className="flex items-center justify-between w-full md:w-auto md:justify-center gap-4 bg-white p-2 rounded-xl shadow-sm border border-stone-200">
                <button onClick={() => changeWeek(-1)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-600">
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="relative flex items-center gap-2 font-medium min-w-[140px] justify-center text-stone-800 hover:text-sage-700 transition-colors cursor-pointer" title="Vybrat datum">
                    <button onClick={() => setShowCalendarPicker(!showCalendarPicker)} className="flex items-center gap-2 focus:outline-none">
                        <CalendarIcon className="w-4 h-4 text-sage-600" />
                        <span>
                            {weekDays[0].getDate()}. {weekDays[0].getMonth() + 1}. – {weekDays[6].getDate()}. {weekDays[6].getMonth() + 1}.
                        </span>
                    </button>
                    {showCalendarPicker && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowCalendarPicker(false)} />
                            <div className="absolute top-12 left-1/2 -translate-x-1/2 md:translate-x-0 z-50 origin-top animate-in fade-in zoom-in-95 duration-200">
                                <MiniCalendar 
                                    selectedDate={currentWeekStart} 
                                    onSelectDate={(d) => { setCurrentWeekStart(d); setShowCalendarPicker(false); }} 
                                />
                            </div>
                        </>
                    )}
                </div>
                <button onClick={() => changeWeek(1)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-600">
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto pb-4">
        <div className="min-w-[1000px] bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
            {/* Header Row */}
            <div className="grid grid-cols-8 border-b border-stone-200 bg-stone-50">
                <div className="p-4 text-center font-bold text-stone-400 border-r border-stone-200 flex items-center justify-center">
                    <Clock className="w-5 h-5" />
                </div>
                {weekDays.map(d => (
                    <div key={d.toString()} className="p-4 text-center border-r border-stone-200 last:border-0">
                        <div className="font-bold text-sage-900">{DAYS_MAP[d.getDay()]}</div>
                        <div className="text-sm text-stone-500">{d.getDate()}. {d.getMonth() + 1}.</div>
                    </div>
                ))}
            </div>

            {/* Time Rows */}
            {GENERATED_TIMES.map((time, idx) => {
                const isHalfHour = time.endsWith(':30');
                return (
                <div key={time} className={`grid grid-cols-8 border-b border-stone-100 last:border-0 hover:bg-stone-50/30 transition-colors ${isHalfHour ? 'bg-stone-50/20' : ''}`}>
                    {/* Time Column */}
                    <div className={`p-4 flex items-center justify-center font-bold border-r border-stone-200 bg-stone-50/50 ${isHalfHour ? 'text-stone-400 text-xs' : 'text-stone-600'}`}>
                        {time}
                    </div>

                    {/* Days Columns */}
                    {weekDays.map(date => {
                        const availablePeople = getAvailablePractitionersForSlot(date, time);
                        const isPast = date < new Date(new Date().setHours(0,0,0,0));
                        
                        // LOGIC FOR HANDLING MANY PRACTITIONERS
                        const MAX_VISIBLE = 3;
                        const visiblePeople = availablePeople.slice(0, MAX_VISIBLE);
                        const hiddenCount = availablePeople.length - MAX_VISIBLE;

                        return (
                            <div key={`${date}-${time}`} className="p-2 border-r border-stone-200 last:border-0 min-h-[80px] relative">
                                {isPast ? (
                                    <div className="absolute inset-0 bg-stone-100/50 flex items-center justify-center">
                                        {/* Grayed out for past */}
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {availablePeople.length === 0 ? (
                                            <div className="h-full flex items-center justify-center text-stone-300 text-xs py-4">
                                                -
                                            </div>
                                        ) : (
                                            <>
                                                {visiblePeople.map(p => renderPractitionerButton(p, date, time))}
                                                
                                                {/* "Show More" Button if too many people */}
                                                {hiddenCount > 0 && (
                                                    <button 
                                                        onClick={() => setExpandedSlot({ date, time, people: availablePeople })}
                                                        className="w-full text-center text-[10px] font-bold text-sage-700 bg-sage-50 hover:bg-sage-100 py-1.5 rounded transition-colors"
                                                    >
                                                        +{hiddenCount} dalších
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )})}
        </div>
      </div>
      
      <div className="bg-sage-50 p-4 rounded-xl flex items-start gap-3 border border-sage-100 max-w-2xl mx-auto">
        <AlertCircle className="w-5 h-5 text-sage-600 mt-0.5" />
        <div className="text-sm text-sage-800">
            <p className="font-bold mb-1">Jak číst rozvrh?</p>
            <p>Kliknutím na kartičku přejdete k rezervaci.</p>
        </div>
      </div>

      {/* Expanded Slot Modal */}
      {expandedSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                  <div className="bg-sage-600 p-4 flex justify-between items-center text-white flex-shrink-0">
                      <div>
                          <h3 className="font-bold text-lg">Volné termíny</h3>
                          <p className="text-sage-100 text-sm">
                              {DAYS_MAP[expandedSlot.date.getDay()]} {expandedSlot.date.getDate()}.{expandedSlot.date.getMonth()+1}. v {expandedSlot.time}
                          </p>
                      </div>
                      <button onClick={() => setExpandedSlot(null)} className="hover:bg-white/20 p-1 rounded-full">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="p-4 overflow-y-auto space-y-2">
                      <p className="text-sm text-stone-500 mb-2">V tento čas je k dispozici {expandedSlot.people.length} lektorů:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {expandedSlot.people.map(p => renderPractitionerButton(p, expandedSlot.date, expandedSlot.time))}
                      </div>
                  </div>

                  <div className="p-4 border-t border-stone-100 bg-stone-50 text-right flex-shrink-0">
                      <button onClick={() => setExpandedSlot(null)} className="text-stone-500 hover:text-stone-800 text-sm font-medium">Zavřít</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default CalendarView;