import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MiniCalendarProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export const MiniCalendar: React.FC<MiniCalendarProps> = ({ selectedDate, onSelectDate }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));

  // Sync currentMonth with selectedDate when it changes from outside
  useEffect(() => {
    setCurrentMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [selectedDate]);

  const changeMonth = (offset: number) => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  // Adjust to Monday = 0
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const padding = Array.from({ length: startOffset }, (_, i) => i);

  const months = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
  const weekDays = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-stone-200 p-5 w-[340px] md:w-[380px] max-w-[90vw] animate-in fade-in slide-in-from-top-2">
      <div className="flex justify-between items-center mb-6">
        <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="font-bold text-lg text-stone-800 capitalize">
          {months[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </div>
        <button onClick={() => changeMonth(1)} className="p-2 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      
      <div className="grid grid-cols-7 gap-2 mb-3">
        {weekDays.map(d => (
          <div key={d} className="text-center text-sm font-bold text-stone-400">{d}</div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-y-3 gap-x-1">
        {padding.map(i => <div key={`pad-${i}`} />)}
        {days.map(d => {
          const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d);
          const isSelected = date.toDateString() === selectedDate.toDateString();
          const isToday = date.toDateString() === new Date().toDateString();
          
          return (
            <button
              key={d}
              onClick={() => onSelectDate(date)}
              className={`w-10 h-10 md:w-11 md:h-11 mx-auto rounded-full flex items-center justify-center text-sm md:text-base transition-all ${
                isSelected ? 'bg-sage-600 text-white font-bold scale-110 shadow-md' :
                isToday ? 'bg-stone-100 text-sage-700 font-bold hover:bg-stone-200' :
                'text-stone-700 hover:bg-stone-100'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
};
