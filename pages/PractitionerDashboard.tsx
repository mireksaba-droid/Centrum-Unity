import React, { useState, useEffect, useMemo } from 'react';
import { Practitioner, Booking, Service } from '../types';
import { BUFFER_SAME_USER, BUFFER_DIFF_USER, GENERATED_TIMES } from '../constants';
import { calculateRentalPrice } from '../utils/scheduler';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import Button from '../components/Button';
import { MiniCalendar } from '../components/MiniCalendar';
import { Calendar, Check, Clock, Save, User, Settings, AlertCircle, Users, CreditCard, Wallet, Edit2, Plus, Trash2, LayoutList, Image as ImageIcon, Lock, Download, BoxSelect, ChevronLeft, ChevronRight, MapPin, X, FileText, QrCode, Apple, Loader2, ArrowRight, Bed, Layers, Sparkles, BarChart2, TrendingUp, PieChart as PieChartIcon, Activity, Phone, Mail, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useStore } from '../store/useStore';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, PieChart, Pie, Legend } from 'recharts';

interface PractitionerDashboardProps {
  practitioners: Practitioner[];
  updatePractitioner: (updated: Practitioner) => void;
  allBookings: Booking[];
  currentUser: Practitioner | null;
  onCancelBooking: (id: string) => Promise<void>;
  onInternalBook: (booking: Partial<Booking>) => Promise<void>;
}

const DAYS_MAP = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']; 

// Definice možností pronájmu pro interní rezervace
const RENTAL_OPTIONS = [60, 90, 120, 150, 180, 210, 240, 270, 300, 720];

// Helper to convert time string to minutes
const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

const PractitionerDashboard: React.FC<PractitionerDashboardProps> = ({ 
  practitioners, 
  updatePractitioner,
  allBookings,
  currentUser,
  onCancelBooking,
  onInternalBook
}) => {
  const { token } = useStore();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'calendar'>('calendar');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(new Date());
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  
  // Temporary state for editing entire practitioner object
  const [tempPractitioner, setTempPractitioner] = useState<Practitioner | null>(currentUser);

  // Internal Booking Modal State
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<{date: string, time: string, room: 1 | 2} | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Místo výběru ze služeb lektora nyní vybíráme z RENTAL_OPTIONS
  const [selectedRentalMinutes, setSelectedRentalMinutes] = useState<number>(60);
  
  // CRM FIELDS
  const [internalClientName, setInternalClientName] = useState('');
  const [internalClientEmail, setInternalClientEmail] = useState('');
  const [internalClientPhone, setInternalClientPhone] = useState('');
  const [internalNote, setInternalNote] = useState('');
  
  const [internalPaymentMethod, setInternalPaymentMethod] = useState<'apple_pay' | 'qr'>('apple_pay');
  const [selectedEquipment, setSelectedEquipment] = useState<'table' | 'futon'>('table');
  
  // Computed price for display
  const currentPrice = bookingSlot ? calculateRentalPrice(selectedRentalMinutes, bookingSlot.room) : 0;

  useEffect(() => {
    if (currentUser) {
        setTempPractitioner(JSON.parse(JSON.stringify(currentUser)));
    } else {
        setTempPractitioner(null);
    }
    setHasUnsavedChanges(false);
  }, [currentUser]);

  // --- ANALYTICS CALCULATION ---
  const stats = useMemo(() => {
    if (!currentUser) return null;
    const myBookings = allBookings.filter(b => b.practitionerId === currentUser.id && b.status === 'confirmed');
    
    // 1. Revenue
    const totalRevenue = myBookings.reduce((sum, b) => sum + b.price, 0);
    const thisMonth = new Date().getMonth();
    const monthlyRevenue = myBookings
        .filter(b => parseLocalDate(b.date).getMonth() === thisMonth)
        .reduce((sum, b) => sum + b.price, 0);

    // 2. Booking Count & Hours
    const totalBookings = myBookings.length;
    const totalMinutes = myBookings.reduce((sum, b) => sum + b.durationMinutes, 0);
    const totalHours = Math.round(totalMinutes / 60);

    // 3. Peak Hours Heatmap
    const hoursMap: Record<string, number> = {};
    myBookings.forEach(b => {
        const hour = b.time.split(':')[0]; // "09", "10"
        hoursMap[hour] = (hoursMap[hour] || 0) + 1;
    });
    const peakHoursData = Object.keys(hoursMap)
        .sort()
        .map(h => ({ name: `${h}:00`, count: hoursMap[h] }));

    // 4. Room Utilization
    const room1Count = myBookings.filter(b => b.room === 1).length;
    const room2Count = myBookings.filter(b => b.room === 2).length;
    const roomData = [
        { name: 'Malá (R1)', value: room1Count, color: '#ba8a5b' }, // Sage 600
        { name: 'Velká (R2)', value: room2Count, color: '#7a573d' }, // Sage 800
    ];

    // 5. Equipment Preference
    const tableCount = myBookings.filter(b => b.equipment === 'table').length;
    const futonCount = myBookings.filter(b => b.equipment === 'futon').length;
    const equipmentData = [
        { name: 'Lehátko', value: tableCount, color: '#57534e' }, // Stone 600
        { name: 'Futon', value: futonCount, color: '#a8a29a' }, // Stone 400
    ];

    // 6. Revenue Trend (Mocking last 6 months based on random distribution of existing bookings + mock logic)
    const revenueTrendData = [
        { name: 'Září', revenue: Math.round(monthlyRevenue * 0.8) },
        { name: 'Říjen', revenue: Math.round(monthlyRevenue * 0.9) },
        { name: 'Listopad', revenue: Math.round(monthlyRevenue * 1.1) },
        { name: 'Prosinec', revenue: Math.round(monthlyRevenue * 1.2) },
        { name: 'Leden', revenue: Math.round(monthlyRevenue * 0.95) },
        { name: 'Únor', revenue: monthlyRevenue },
    ];

    return {
        totalRevenue,
        monthlyRevenue,
        totalBookings,
        totalHours,
        peakHoursData,
        roomData,
        equipmentData,
        revenueTrendData
    };
  }, [allBookings, currentUser]);


  if (!currentUser || !tempPractitioner) {
      return (
          <div className="flex flex-col items-center justify-center py-20 animate-in fade-in">
              <div className="w-16 h-16 bg-stone-200 rounded-full flex items-center justify-center mb-6">
                  <Lock className="w-8 h-8 text-stone-500" />
              </div>
              <h2 className="text-2xl font-bold text-stone-900 mb-2">Přístup odepřen</h2>
              <p className="text-stone-600 mb-8 text-center max-w-md">
                  Pro přístup do lektorské zóny a správu vašeho profilu se musíte přihlásit.
              </p>
              <Link to="/login">
                  <Button>Přejít na přihlášení</Button>
              </Link>
          </div>
      );
  }

  const myBookings = allBookings.filter(b => b.practitionerId === currentUser.id);

  // --- CALENDAR HELPERS ---
  const changeWeek = (offset: number) => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + (offset * 7));
    setCurrentWeekStart(newDate);
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart);
    // Adjust to Monday of current week if today isn't Monday
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff + i);
    return d;
  });

  const formatDate = (date: Date) => date.toISOString().split('T')[0];

  const isTemplateAvailable = (dayIndex: number, time: string) => {
      const dayName = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'][dayIndex];
      const avail = tempPractitioner.availability || [];
      return avail.includes(`${dayName}-${time}`);
  };

  // Get Room Status for a specific real date & time WITH DYNAMIC BUFFER LOGIC
  const getRoomStatus = (date: Date, time: string) => {
      const dateStr = formatDate(date);
      const slotStart = timeToMinutes(time);
      const slotEnd = slotStart + 30; // 30 minute granularity

      const getStatusForRoom = (roomNum: 1 | 2) => {
          // Find booking that occupies this slot directly
          const booking = allBookings.find(b => {
              if (b.date !== dateStr || b.status !== 'confirmed' || b.room !== roomNum) return false;
              const bStart = timeToMinutes(b.time);
              const bEnd = bStart + b.durationMinutes;
              return (bStart < slotEnd && bEnd > slotStart);
          });

          if (booking) return { type: 'booked' as const, booking };

          // If no direct booking, check if it's in the CLEANING BUFFER of a previous booking
          const cleaningBooking = allBookings.find(b => {
             if (b.date !== dateStr || b.status !== 'confirmed' || b.room !== roomNum) return false;
             const bStart = timeToMinutes(b.time);
             const bEnd = bStart + b.durationMinutes;
             
             // Dynamic Buffer check:
             // If I see this, I want to know if *I* can book.
             // If the booking is mine -> 30 mins buffer.
             // If the booking is others -> 60 mins buffer.
             const bufferDuration = (b.bookedByUserId === currentUser.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
             const bufferEnd = bEnd + bufferDuration;

             return (bEnd < slotEnd && bufferEnd > slotStart);
          });

          if (cleaningBooking) return { type: 'cleaning' as const, booking: cleaningBooking };

          return null;
      };

      return {
          r1: getStatusForRoom(1),
          r2: getStatusForRoom(2),
          // Helper to see if *I* am booked anywhere at this time (regardless of room)
          myBooking: allBookings.find(b => {
              if (b.date !== dateStr || b.status !== 'confirmed' || b.practitionerId !== currentUser.id) return false;
               const bStart = timeToMinutes(b.time);
               const bEnd = bStart + b.durationMinutes;
               return (bStart < slotEnd && bEnd > slotStart);
          })
      };
  };

  // --- HANDLERS ---
  const handleSave = () => {
    if (tempPractitioner) {
        updatePractitioner(tempPractitioner);
        setHasUnsavedChanges(false);
        alert('Změny byly úspěšně uloženy.');
    }
  };

  const toggleSlot = (dayName: string, time: string) => {
    const slotId = `${dayName}-${time}`;
    setTempPractitioner(prev => {
      if (!prev) return null;
      const avail = prev.availability || [];
      const newAvailability = avail.includes(slotId)
        ? avail.filter(id => id !== slotId)
        : [...avail, slotId];
      return { ...prev, availability: newAvailability };
    });
    setHasUnsavedChanges(true);
  };

  // Internal Booking Logic
  const openInternalBooking = (date: string, time: string, room: 1 | 2) => {
      setBookingSlot({ date, time, room });
      setSelectedRentalMinutes(60); // Default to 60 mins
      setInternalClientName('');
      setInternalClientEmail('');
      setInternalClientPhone('');
      setInternalNote('');
      setInternalPaymentMethod('apple_pay'); // Default
      setSelectedEquipment('table'); // Default
      setIsProcessing(false);
      setShowBookingModal(true);
  };

  const submitInternalBooking = () => {
      if (!bookingSlot) return;

      const rentalMinutes = selectedRentalMinutes;
      if (!rentalMinutes) return;

      // 1. COLLISION DETECTION WITH DYNAMIC BUFFER
      const newStart = timeToMinutes(bookingSlot.time);
      const newEnd = newStart + rentalMinutes;

      // --- USER DOUBLE BOOKING CHECK ---
      const isUserDoubleBooked = allBookings.some(b => {
            if (b.bookedByUserId !== currentUser.id) return false; 
            if (b.date !== bookingSlot.date || b.status !== 'confirmed') return false;
            
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + b.durationMinutes;

            return (newStart < bEnd && newEnd > bStart);
      });

      if (isUserDoubleBooked) {
            alert("Nelze vytvořit rezervaci: V tomto čase již máte rezervaci v jiné místnosti.");
            return;
      }
      // --------------------------------

      const hasCollision = allBookings.some(b => {
          if (b.date !== bookingSlot.date) return false;
          if (b.status !== 'confirmed') return false;
          if (b.room !== bookingSlot.room) return false; 

          const bStart = timeToMinutes(b.time);
          const bEnd = bStart + b.durationMinutes;

          // LOGIC A: Overlap with booking
          if (newStart < bEnd && newEnd > bStart) return true;

          // LOGIC B: Overlap with THEIR buffer (They block me)
          const bufferAfterThem = (b.bookedByUserId === currentUser.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
          const bBufferEnd = bEnd + bufferAfterThem;
          if (newStart < bBufferEnd && newStart >= bEnd) return true;

          // LOGIC C: Overlap with MY buffer (I block them)
          const bufferAfterMe = (b.bookedByUserId === currentUser.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
          const myBufferEnd = newEnd + bufferAfterMe;
          if (newEnd <= bStart && myBufferEnd > bStart) return true;

          return false;
      });

      if (hasCollision) {
          alert(`Nelze vytvořit rezervaci: Kolize s jinou rezervací nebo povinnou pauzou na úklid (30/60 min).`);
          return;
      }

      setIsProcessing(true);

      const delay = internalPaymentMethod === 'apple_pay' ? 1500 : 500;

      // Simulate Processing
      setTimeout(async () => {
        const finalPrice = calculateRentalPrice(rentalMinutes, bookingSlot.room);
        await onInternalBook({
            date: bookingSlot.date,
            time: bookingSlot.time,
            durationMinutes: rentalMinutes,
            room: bookingSlot.room,
            price: finalPrice,
            bookedByUserId: currentUser?.id,
            bookedByName: currentUser?.name || 'Lektor',
            clientName: internalClientName || currentUser?.name,
            clientEmail: internalClientEmail,
            clientPhone: internalClientPhone,
            paymentMethod: internalPaymentMethod as any,
            paymentStatus: internalPaymentMethod === 'apple_pay' ? 'paid' : 'invoice_pending',
            equipment: selectedEquipment,
            note: internalNote
        });
        
        setIsProcessing(false);
        setShowBookingModal(false);
      }, delay);
  };


  const handleConfirmCancel = async () => {
        if (!bookingToCancel) return;
        setIsProcessing(true);
        if (bookingToCancel.paymentId) {
            try {
                const res = await fetch('/api/refund', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ paymentId: bookingToCancel.paymentId })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Refund failed');
                
                addToast('success', 'Refundace zadána', 'Platba byla úspěšně zrušena přes GoPay.');
                onCancelBooking(bookingToCancel.id);
                addToast('success', 'Rezervace zrušena', 'Termín byl uvolněn.');
            } catch (err: any) {
                addToast('error', 'Chyba storna', err.message || 'Nastala chyba při vracení platby přes GoPay. Obraťte se prosím na podporu.');
            }
        } else {
            onCancelBooking(bookingToCancel.id);
            addToast('success', 'Rezervace zrušena', 'Termín byl uvolněn.');
        }
        setIsProcessing(false);
        setBookingToCancel(null);
  };

  // .ICS Export Logic
  const downloadCalendar = () => {
    if (myBookings.length === 0) {
        alert("Nemáte žádné rezervace k exportu.");
        return;
    }
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Centrum Unity//Wellness App//CZ\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\n";
    myBookings.forEach(booking => {
        if (booking.status !== 'confirmed') return;
        const [year, month, day] = booking.date.split('-').map(Number);
        const [hour, minute] = booking.time.split(':').map(Number);
        const startDate = new Date(year, month - 1, day, hour, minute);
        const endDate = new Date(startDate.getTime() + booking.durationMinutes * 60000);
        const formatICSDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        icsContent += "BEGIN:VEVENT\n";
        icsContent += `UID:${booking.id}@centrumunity.cz\n`;
        icsContent += `DTSTAMP:${formatICSDate(new Date())}\n`;
        icsContent += `DTSTART:${formatICSDate(startDate)}\n`;
        icsContent += `DTEND:${formatICSDate(endDate)}\n`;
        icsContent += `SUMMARY:${booking.serviceName}\n`;
        icsContent += "END:VEVENT\n";
    });
    icsContent += "END:VCALENDAR";
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', 'rezervace.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleServiceChange = (index: number, field: keyof Service, value: any) => {
    if (!tempPractitioner) return;
    const newServices = [...tempPractitioner.services];
    newServices[index] = { ...newServices[index], [field]: value };
    if (field === 'type') {
        if (value === '1-1') newServices[index].targetRoom = 1;
        if (value === 'group') newServices[index].targetRoom = 2;
        if (value === 'rental') newServices[index].targetRoom = 1;
    }
    setTempPractitioner(prev => (prev ? { ...prev, services: newServices } : null));
    setHasUnsavedChanges(true);
  };
  const addService = () => {
    const newService: Service = { id: crypto.randomUUID(), name: 'Nová Služba', durationMinutes: 60, price: 1000, type: '1-1', targetRoom: 1 };
    setTempPractitioner(prev => (prev ? { ...prev, services: [...prev.services, newService] } : null));
    setHasUnsavedChanges(true);
  };
  const removeService = (index: number) => {
    if (window.confirm('Opravdu chcete smazat tuto službu?') && tempPractitioner) {
        const newServices = tempPractitioner.services.filter((_, i) => i !== index);
        setTempPractitioner(prev => (prev ? { ...prev, services: newServices } : null));
        setHasUnsavedChanges(true);
    }
  };
  const handleProfileChange = (field: keyof Practitioner, value: any) => {
    setTempPractitioner(prev => (prev ? { ...prev, [field]: value } : null));
    setHasUnsavedChanges(true);
  };

  // Sort bookings: Today first, then ascending
  const sortedBookings = useMemo(() => {
      const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local time
      return [...myBookings].sort((a, b) => {
          if (a.date === today && b.date !== today) return -1;
          if (b.date === today && a.date !== today) return 1;
          return parseLocalDate(a.date, a.time).getTime() - parseLocalDate(b.date, b.time).getTime();
      });
  }, [myBookings]);

  return (
    <div className="animate-in fade-in duration-500 pb-12 space-y-8 relative">
      
      {/* Top Bar */}
      <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 relative">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/schedule" className="p-2 hover:bg-stone-100 text-stone-500 rounded-lg transition-colors group" title="Zpět do kalendáře">
             <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          </Link>
          <div className="bg-sage-100 p-2 rounded-full">
            <User className="w-6 h-6 text-sage-700" />
          </div>
          <div>
             <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">Lektorská zóna</span>
             <h2 className="font-heading font-bold text-lg text-stone-900">{tempPractitioner.name}</h2>
          </div>
        </div>
        
      </div>

      {/* === CALENDAR TAB === */}
      {activeTab === 'calendar' && (
          <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-2 fade-in">
              <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6 flex flex-col md:flex-row gap-8">
                  {/* Calendar view */}
                  <div className="flex-1 flex justify-center border-r border-stone-100 pr-0 md:pr-8">
                      <div>
                          <h3 className="font-bold text-stone-900 mb-4 font-heading">Přehled dnů</h3>
                          <MiniCalendar 
                              selectedDate={currentWeekStart} 
                              onSelectDate={(d) => setCurrentWeekStart(d)} 
                          />
                      </div>
                  </div>

                  {/* My Bookings List */}
                  <div className="flex-[2]">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold font-heading text-stone-900">Moje rezervace</h2>
                        <button 
                            onClick={downloadCalendar}
                            className="text-sage-700 hover:text-sage-900 hover:bg-sage-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold border border-sage-200"
                        >
                            <Download className="w-4 h-4" /> Export (.ics)
                        </button>
                    </div>
                    
                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                        {sortedBookings.length === 0 ? (
                            <div className="bg-stone-50 p-8 rounded-xl text-center border border-stone-100 mt-4">
                               <p className="text-stone-500 font-medium">Zatím nemáte žádné rezervace.</p>
                            </div>
                        ) : (
                            sortedBookings.map(booking => {
                                const isToday = booking.date === new Date().toLocaleDateString('en-CA');
                                return (
                                <div key={booking.id} className={`flex flex-col gap-3 p-5 rounded-xl border relative transition-all ${isToday ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-stone-200 shadow-sm hover:shadow-md'}`}>
                                    {isToday && (
                                        <div className="absolute -top-3 -left-2 bg-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-sm z-10 uppercase tracking-widest">
                                            Dnes
                                        </div>
                                    )}

                                    <div className="flex items-start gap-4">
                                        <div className={`p-3 rounded-full border ${isToday ? 'bg-white border-indigo-100 text-indigo-600' : 'bg-stone-50 border-stone-200 text-sage-600'}`}>
                                            <Calendar className="w-5 h-5" />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
                                                <div>
                                                    <h4 className="font-bold text-stone-900 text-lg leading-tight">{booking.serviceName}</h4>
                                                    <div className="text-xs text-stone-400 font-medium mt-0.5">#{booking.id.slice(-6).toUpperCase()}</div>
                                                </div>
                                                <div className={`flex items-center gap-2 text-xs font-bold px-2.5 py-1.5 rounded-full w-fit ${
                                                    booking.paymentStatus === 'paid' 
                                                    ? 'bg-green-100 text-green-800' 
                                                    : 'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                    {booking.paymentStatus === 'paid' ? <CreditCard className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />}
                                                    {booking.paymentStatus === 'paid' ? 'Zaplaceno' : `${booking.price} Kč`}
                                                </div>
                                            </div>

                                            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-stone-600">
                                                <div className="flex items-center gap-2 font-medium text-sage-800">
                                                    <Clock className="w-4 h-4" />
                                                    {formatLocalDate(booking.date)} v {booking.time}
                                                </div>
                                                <div className="flex items-center gap-2 font-medium">
                                                    <BoxSelect className="w-4 h-4" />
                                                    {booking.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}
                                                </div>
                                            </div>
                                            
                                            {/* CRM Info Display */}
                                            {(booking.clientEmail || booking.clientPhone || booking.note) && (
                                                <div className="mt-4 pt-3 border-t border-stone-100 space-y-2 text-sm">
                                                    {booking.clientPhone && (
                                                        <div className="flex items-center gap-2 text-stone-600">
                                                            <Phone className="w-4 h-4 text-stone-400" /> {booking.clientPhone}
                                                        </div>
                                                    )}
                                                    {booking.clientEmail && (
                                                        <div className="flex items-center gap-2 text-stone-600">
                                                            <Mail className="w-4 h-4 text-stone-400" /> {booking.clientEmail}
                                                        </div>
                                                    )}
                                                    {booking.note && (
                                                        <div className="flex items-start gap-2 text-stone-600 italic bg-stone-50 p-2 rounded-lg mt-2">
                                                            <StickyNote className="w-4 h-4 mt-0.5 text-stone-400" /> "{booking.note}"
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                {/* Action Buttons */}
                                <div className="mt-4 flex gap-3 pt-3 border-t border-stone-100">
                                                 <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="flex-1 border-stone-300 text-stone-700 hover:bg-stone-50"
                                                    onClick={() => addToast('info', 'Přebukování', 'Tato funkce bude brzy spuštěna.')}
                                                 >
                                                    Přebukovat
                                                 </Button>
                                                 <Button 
                                                    variant="outline" 
                                                    size="sm" 
                                                    className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                                                    onClick={() => setBookingToCancel(booking)}
                                                 >
                                                    Storno
                                                 </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                );
                            })
                        )}
                    </div>
                  </div>
              </div>
          </div>
      )}

      {/* Internal Booking Modal */}
      {showBookingModal && bookingSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="bg-sage-600 p-4 flex justify-between items-center text-white flex-shrink-0">
                      <h3 className="font-bold text-lg flex items-center gap-2">
                          <Plus className="w-5 h-5" /> Nová rezervace
                      </h3>
                      <button onClick={() => setShowBookingModal(false)} className="hover:bg-white/20 p-1 rounded-full"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-6 space-y-4 overflow-y-auto">
                      {/* DateTime Summary */}
                      <div className="flex gap-4 text-sm border-b border-stone-100 pb-4">
                          <div className="flex-1">
                              <span className="block text-stone-500 text-xs uppercase font-bold">Datum</span>
                              <span className="font-bold text-stone-800">{formatLocalDate(bookingSlot.date)}</span>
                          </div>
                          <div className="flex-1">
                              <span className="block text-stone-500 text-xs uppercase font-bold">Čas</span>
                              <span className="font-bold text-stone-800">{bookingSlot.time}</span>
                          </div>
                          <div className="flex-1">
                              <span className="block text-stone-500 text-xs uppercase font-bold">Místnost</span>
                              <span className="font-bold text-stone-800">{bookingSlot.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}</span>
                          </div>
                      </div>

                      <div className="bg-yellow-50 p-3 rounded-lg flex gap-2 items-start border border-yellow-100">
                           <Sparkles className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                           <p className="text-xs text-yellow-800">
                               <strong>Pozor:</strong> K této rezervaci bude automaticky připočtena pauza na úklid a větrání (30 min pokud navazujete na sebe, 60 min po jiném lektorovi).
                           </p>
                      </div>

                      {/* Inputs */}
                      <div>
                          <label className="block text-sm font-bold text-stone-700 mb-1">Délka rezervace (Pronájem)</label>
                          <select 
                            className="w-full p-2 border border-stone-300 rounded-lg bg-white text-stone-900"
                            onChange={(e) => setSelectedRentalMinutes(parseInt(e.target.value))}
                            value={selectedRentalMinutes}
                          >
                              {RENTAL_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>
                                      {opt === 720 ? 'Celý den' : `${opt} min`} – {calculateRentalPrice(opt, bookingSlot.room)} Kč
                                  </option>
                              ))}
                          </select>
                      </div>
                      
                      {/* Client CRM Details */}
                      <div className="space-y-2 pt-2 border-t border-stone-100">
                          <h4 className="text-xs font-bold text-stone-400 uppercase">Údaje o Klientovi (CRM)</h4>
                          <div>
                              <input 
                                type="text" 
                                className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-900 placeholder-stone-400"
                                placeholder="Jméno a Příjmení"
                                value={internalClientName}
                                onChange={(e) => setInternalClientName(e.target.value)}
                              />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                              <div className="relative">
                                  <Mail className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
                                  <input 
                                    type="email" 
                                    className="w-full pl-9 p-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-900 placeholder-stone-400"
                                    placeholder="Email"
                                    value={internalClientEmail}
                                    onChange={(e) => setInternalClientEmail(e.target.value)}
                                  />
                              </div>
                              <div className="relative">
                                  <Phone className="w-4 h-4 text-stone-400 absolute left-2.5 top-2.5" />
                                  <input 
                                    type="tel" 
                                    className="w-full pl-9 p-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-900 placeholder-stone-400"
                                    placeholder="Telefon"
                                    value={internalClientPhone}
                                    onChange={(e) => setInternalClientPhone(e.target.value)}
                                  />
                              </div>
                          </div>
                          <div>
                              <textarea 
                                className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white text-stone-900 placeholder-stone-400"
                                placeholder="Poznámka (např. zdravotní omezení)"
                                rows={2}
                                value={internalNote}
                                onChange={(e) => setInternalNote(e.target.value)}
                              />
                          </div>
                      </div>
                      
                      {/* Equipment Selector */}
                      <div>
                          <label className="block text-sm font-bold text-stone-700 mb-2">Vybavení místnosti</label>
                          <div className="grid grid-cols-2 gap-3">
                              <button
                                  type="button"
                                  onClick={() => setSelectedEquipment('table')}
                                  className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                                      selectedEquipment === 'table' 
                                      ? 'border-sage-600 bg-sage-50 text-sage-800' 
                                      : 'border-stone-200 text-stone-500 hover:border-sage-300'
                                  }`}
                              >
                                  <Bed className="w-6 h-6" />
                                  <span className="text-xs font-bold mt-1">Lehátko</span>
                              </button>

                              <button
                                  type="button"
                                  onClick={() => setSelectedEquipment('futon')}
                                  className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                                      selectedEquipment === 'futon' 
                                      ? 'border-sage-600 bg-sage-50 text-sage-800' 
                                      : 'border-stone-200 text-stone-500 hover:border-sage-300'
                                  }`}
                              >
                                  <Layers className="w-6 h-6" />
                                  <span className="text-xs font-bold mt-1">Futon</span>
                              </button>
                          </div>
                      </div>

                      {/* Payment Method Selector */}
                      <div>
                          <label className="block text-sm font-bold text-stone-700 mb-2">Způsob úhrady pronájmu</label>
                          <div className="grid grid-cols-2 gap-3">
                              <button
                                  type="button"
                                  onClick={() => setInternalPaymentMethod('apple_pay')}
                                  className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                                      internalPaymentMethod === 'apple_pay' 
                                      ? 'border-black bg-stone-900 text-white' 
                                      : 'border-stone-200 text-stone-500 hover:border-stone-400'
                                  }`}
                              >
                                  <Apple className="w-6 h-6" />
                                  <span className="text-xs font-bold mt-1">Apple Pay</span>
                              </button>

                              <button
                                  type="button"
                                  onClick={() => setInternalPaymentMethod('qr')}
                                  className={`p-3 rounded-lg border-2 flex flex-col items-center justify-center gap-1 transition-all ${
                                      internalPaymentMethod === 'qr' 
                                      ? 'border-sage-600 bg-sage-50 text-sage-800' 
                                      : 'border-stone-200 text-stone-500 hover:border-sage-300'
                                  }`}
                              >
                                  <QrCode className="w-6 h-6" />
                                  <span className="text-xs font-bold mt-1">QR Platba</span>
                              </button>
                          </div>
                      </div>

                      {/* Price Summary */}
                      <div className="bg-stone-50 p-4 rounded-lg flex justify-between items-center border border-stone-200">
                          <span className="text-sm font-bold text-stone-600">Celková cena:</span>
                          <span className="text-xl font-bold text-stone-900">{currentPrice} Kč</span>
                      </div>

                      <div className="pt-2 flex flex-col gap-3">
                          <Button 
                            onClick={submitInternalBooking} 
                            disabled={isProcessing}
                            className={`w-full text-white flex items-center justify-center gap-2 py-3 relative overflow-hidden transition-colors ${
                                internalPaymentMethod === 'apple_pay' 
                                ? 'bg-black hover:bg-stone-800' 
                                : 'bg-sage-600 hover:bg-sage-700'
                            }`}
                          >
                            {isProcessing ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Zpracovávám...
                                </>
                            ) : (
                                <>
                                    {internalPaymentMethod === 'apple_pay' ? <Apple className="w-5 h-5" /> : <QrCode className="w-5 h-5" />}
                                    {internalPaymentMethod === 'apple_pay' ? 'Zaplatit přes Apple Pay' : 'Potvrdit a generovat QR'}
                                </>
                            )}
                          </Button>
                          <Button variant="ghost" onClick={() => setShowBookingModal(false)} className="w-full" disabled={isProcessing}>Zrušit</Button>
                      </div>
                  </div>
              </div>
          </div>
      )}
      
      {/* Cancellation Modal */}
      {bookingToCancel && (() => {
          const bookingStart = parseLocalDate(bookingToCancel.date, bookingToCancel.time);
          const now = new Date();
          const hoursDifference = (bookingStart.getTime() - now.getTime()) / (1000 * 60 * 60);
          const isTooLate = hoursDifference < 24;

          return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 text-center">
                      <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
                          <X className="w-6 h-6" />
                      </div>
                      <h3 className="text-xl font-bold font-heading mb-2">Zrušit rezervaci</h3>
                      <p className="text-stone-600 mb-6">
                          {isTooLate && (
                              <span className="text-red-600 font-bold block mb-2">Pozor: Zbývá méně než 24 hodin!</span>
                          )}
                          Opravdu chcete zrušit tuto rezervaci z {formatLocalDate(bookingToCancel.date)} v {bookingToCancel.time}?
                          {!isTooLate && bookingToCancel.paymentId && (
                              <span className="block mt-2 font-medium text-stone-800">
                                  Částka klienta bude refundována na jeho kartu.
                              </span>
                          )}
                          {isTooLate && (
                              <span className="block mt-2 font-medium text-red-600">
                                  Termín je příliš blízko, nelze jej stornovat s nárokem na vrácení peněz klientovi online. Kontaktujte prosím manažera.
                              </span>
                          )}
                      </p>
                      <div className="flex gap-2">
                          <Button 
                              variant="outline" 
                              className="flex-1" 
                              onClick={() => setBookingToCancel(null)}
                              disabled={isProcessing}
                          >
                              Zpět
                          </Button>
                          <Button 
                              className={`flex-1 text-white ${isTooLate ? 'bg-stone-300 hover:bg-stone-300 cursor-not-allowed opacity-50' : 'bg-red-600 hover:bg-red-700'}`}
                              onClick={handleConfirmCancel}
                              disabled={isProcessing || isTooLate}
                          >
                              {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Zrušit termín'}
                          </Button>
                      </div>
                  </div>
              </div>
          </div>
          );
      })()}

    </div>
  );
};

export default PractitionerDashboard;