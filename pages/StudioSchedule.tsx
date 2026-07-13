import React, { useState, useMemo, useEffect } from 'react';
import { Booking, BookingStatus, Practitioner, GroupEvent, Role } from '../types';
import { GENERATED_TIMES, BUFFER_SAME_USER, BUFFER_DIFF_USER, RENTAL_PRICING } from '../constants';
import Button from '../components/Button';
import { MiniCalendar } from '../components/MiniCalendar';
import { Calendar, ChevronLeft, ChevronRight, Clock, User, Check, AlertCircle, Info, Lock, Zap, LogOut, Loader2, Bed, Layers, Sparkles, History, Monitor, Smartphone, Mail, Phone, X, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { useStore } from '../store/useStore';
import { checkBookingCollision, calculateRentalPrice, timeToMinutes } from '../utils/scheduler';
import { generateConfirmationEmail } from '../utils/emailTemplates';
import { capitalizeName } from '../utils/vocative';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';

declare global {
  interface Window {
    _gopay?: any;
    gopay?: any;
  }
}

interface StudioScheduleProps {
  currentUser: Practitioner;
  allBookings: Booking[];
  groupEvents?: GroupEvent[];
  onBook: (bookingData: Partial<Booking>) => Promise<void>;
  onCancel: (bookingId: string) => Promise<void>;
  onLogout: () => void;
}

const DAYS_MAP = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

const StudioSchedule: React.FC<StudioScheduleProps> = ({ 
    currentUser, 
    allBookings, 
    groupEvents = [],
    onBook, 
    onCancel,
    onLogout
}) => {
    // Hooks
    const { token, practitionersList, updateBookingStatus, attachPaymentId, removeBooking } = useStore();
    const { addToast } = useToast();

    const sendConfirmationEmail = async (booking: Booking, isPaid: boolean = false) => {
        // Příjemci: klient (pokud vyplněn) + lektor, který rezervaci vytvořil.
        const practitioner = practitionersList.find(p => p.id === booking.bookedByUserId);
        const recipientList = [booking.clientEmail, practitioner?.email]
            .map(x => (x || '').trim())
            .filter(Boolean)
            .join(', ');

        if (recipientList) {
            const emailHtml = generateConfirmationEmail(booking, isPaid);

            fetch('/api/send-email', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    to: recipientList,
                    subject: 'Potvrzení rezervace - Centrum Unity',
                    html: emailHtml
                })
            }).catch(console.error); // Do not block UI
        }
    };

    // Handle Return from GoPay Redirect
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const paymentId = params.get('id');
        if (paymentId) {
            // Find booking with this paymentId
            const booking = allBookings.find(b => b.paymentId === String(paymentId));
            if (booking && booking.status !== 'paid') {
                // Verify with backend
                fetch(`/api/gopay/status?id=${paymentId}`)
                    .then(res => res.json())
                    .then(data => {
                        if (data.state === 'PAID') {
                            updateBookingStatus(booking.id, 'paid');
                            addToast('success', 'Platba úspěšná', 'Vaše rezervace byla zaplacena.');
                            // Potvrzovací e-mail odešle server v rámci /api/gopay/status (na clientEmail),
                            // aby dorazil právě jednou a správnému příjemci - klient ho už neposílá.
                        } else if (data.state === 'CANCELED' || data.state === 'TIMEOUTED') {
                            addToast('error', 'Platba neúspěšná', 'Platba byla zrušena nebo vypršela. Můžete ji zkusit znovu.');
                            onCancel(booking.id);
                        } else {
                            addToast('info', 'Zpracováváme platbu', 'Čekáme na potvrzení platby od banky.');
                        }
                    })
                    .catch(err => console.error("Error checking gopay status:", err));
            }
            
            // Clean up URL
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }, [allBookings, updateBookingStatus, addToast]);

    // View State
    const [viewMode, setViewMode] = useState<'day' | 'week'>('week');
    const [currentDate, setCurrentDate] = useState(new Date()); 
    const [showCalendarPicker, setShowCalendarPicker] = useState(false);
    
    // Check screen size on mount and resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 768) {
                setViewMode('day');
            } else {
                setViewMode('week');
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const [selectedSlot, setSelectedSlot] = useState<{date: string, time: string, room: 1 | 2} | null>(null);
    const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
    
    // Booking Form State
    const [duration, setDuration] = useState<number>(60);
    const [clientName, setClientName] = useState(''); 
    const [equipment, setEquipment] = useState<'table' | 'futon' | 'none'>('table');
    const [isProcessing, setIsProcessing] = useState(false);

    const [paymentIntentIdState, setPaymentIntentIdState] = useState<string | null>(null);

    const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

    // GUEST SPECIFIC STATE
    const [guestName, setGuestName] = useState('');
    const [guestEmail, setGuestEmail] = useState('');
    const [guestPhone, setGuestPhone] = useState('');
    const [isTestPayment, setIsTestPayment] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<'invoice' | 'online'>('online');

    const isGuest = currentUser.id === 'guest';

    // Reset fields when modal opens/closes
    useEffect(() => {
        if (selectedSlot) {
            setDuration(60);
            setClientName('');
            setEquipment('table');
            setGuestName('');
            setGuestEmail('');
            setGuestPhone('');
            setIsTestPayment(false);
            setPaymentMethod('online');
        }
    }, [selectedSlot, isGuest]);

    // --- CALENDAR LOGIC ---
    
    const handleNavigate = (offset: number) => {
        const newDate = new Date(currentDate);
        if (viewMode === 'day') {
            newDate.setDate(newDate.getDate() + offset);
        } else {
            newDate.setDate(newDate.getDate() + (offset * 7));
        }
        setCurrentDate(newDate);
    };

    const visibleDays = useMemo(() => {
        if (viewMode === 'day') {
            return [new Date(currentDate)];
        } else {
            return Array.from({ length: 7 }, (_, i) => {
                const d = new Date(currentDate);
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1);
                d.setDate(diff + i);
                return d;
            });
        }
    }, [currentDate, viewMode]);

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    const combinedBookings = useMemo(() => {
        const mappedEvents: Booking[] = groupEvents.map(event => {
            const duration = timeToMinutes(event.endTime) - timeToMinutes(event.startTime);
            return {
                id: `event-${event.id}`,
                bookedByUserId: event.practitionerId,
                bookedByName: 'Skupinová Událost',
                date: event.date,
                time: event.startTime,
                durationMinutes: duration > 0 ? duration : 60,
                room: 2, // Group events are in room 2
                price: 0,
                status: 'paid',
                paymentMethod: 'invoice',
                createdAt: event.createdAt || new Date().toISOString(),
                note: `Skupinová událost: ${event.title}`
            } as Booking;
        });
        return [...allBookings, ...mappedEvents];
    }, [allBookings, groupEvents]);

    // Note: getSlotStatus remains here as it's purely view logic (rendering the grid)
    const getSlotStatus = (date: Date, time: string, room: 1 | 2) => {
        const dateStr = formatDate(date);
        const slotStart = timeToMinutes(time);
        const slotEnd = slotStart + 30; 

        const now = new Date();
        const slotDateTime = parseLocalDate(dateStr, time);
        
        // Past check logic...

        const overlap = combinedBookings.find(b => {
            if (b.date !== dateStr || !['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status) || b.room !== room) return false;
            
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + b.durationMinutes;
            
            const bufferDuration = (b.bookedByUserId === currentUser.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
            const bBufferEnd = bEnd + bufferDuration;

            const isBooking = (slotStart < bEnd && slotEnd > bStart);
            const isBuffer = (slotStart < bBufferEnd && slotEnd > bEnd);

            return isBooking || isBuffer;
        });

        if (!overlap) {
            if (slotDateTime < now) return { status: 'past' as const };
            return { status: 'free' as const };
        }

        const bStart = timeToMinutes(overlap.time);
        const bEnd = bStart + overlap.durationMinutes;
        const isBuffer = slotStart >= bEnd; 
        const isMine = overlap.bookedByUserId === currentUser.id || currentUser.role === Role.ADMIN;

        return {
            status: isBuffer ? 'cleaning' as const : (isMine ? 'mine' as const : 'occupied' as const),
            booking: overlap,
            bufferUsed: (overlap.bookedByUserId === currentUser.id) ? BUFFER_SAME_USER : BUFFER_DIFF_USER
        };
    };

    // --- HANDLERS ---

    const handleSlotClick = async (date: Date, time: string, room: 1 | 2, statusData: ReturnType<typeof getSlotStatus>) => {
        if (statusData.status === 'past') {
            addToast('info', 'Minulost', 'Nelze rezervovat termíny v minulosti.');
            return;
        }
        
        if (statusData.status === 'free') {
            setSelectedSlot({
                date: formatDate(date),
                time,
                room
            });
        } else if (statusData.status === 'mine' && statusData.booking) {
            if (statusData.booking.id.startsWith('event-')) {
                addToast('info', 'Skupinová událost', 'Skupinové události nelze zrušit z kalendáře. Přejděte do Admin panelu.');
                return;
            }

            setBookingToCancel(statusData.booking);
        } else if (statusData.status === 'occupied') {
            addToast('info', 'Obsazeno', 'Tento termín je již rezervován jiným lektorem.');
        } else if (statusData.status === 'cleaning') {
            addToast('info', 'Technická pauza', 'Čas na úklid a větrání po předchozí rezervaci.');
        }
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
                    body: JSON.stringify({ 
                        paymentId: bookingToCancel.paymentId,
                        amount: bookingToCancel.price * 100 // send amount in halers
                    })
                });
                
                let data;
                const textResponse = await res.text();
                try {
                    data = JSON.parse(textResponse);
                } catch (e) {
                    console.error("Non-JSON response from /api/refund:", textResponse);
                    throw new Error(`Server vrátil neplatnou odpověď (kód ${res.status}). Zkuste to prosím znovu.`);
                }
                
                if (!res.ok) {
                    throw new Error(data.error || 'Refund failed');
                }
                
                if (data.message) {
                    addToast('success', 'Rezervace zrušena', data.message);
                } else {
                    addToast('success', 'Refundace zadána', 'Platba byla úspěšně zrušena přes GoPay.');
                }
                onCancel(bookingToCancel.id);
            } catch (err: any) {
                addToast('error', 'Chyba storna', err.message || 'Nastala chyba při vracení platby přes GoPay. Obraťte se prosím na podporu.');
            }
        } else {
            onCancel(bookingToCancel.id);
            addToast('success', 'Rezervace zrušena', 'Termín byl uvolněn.');
        }
        
        setIsProcessing(false);
        setBookingToCancel(null);
    };

    const handleConfirmBooking = async () => {
        if (!selectedSlot) return;

        // Validation for Guest
        if (isGuest) {
            if (!guestName.trim() || !guestEmail.trim() || !guestPhone.trim()) {
                addToast('error', 'Chybí údaje', 'Jako host musíte vyplnit jméno, email a telefon.');
                return;
            }
        }

        // --- NEW UTILITY USAGE FOR COLLISION CHECK ---
        const { hasCollision, reason } = checkBookingCollision({
            newDate: selectedSlot.date,
            newTime: selectedSlot.time,
            durationMinutes: duration,
            room: selectedSlot.room,
            userId: currentUser.id,
            allBookings: combinedBookings
        });

        if (hasCollision) {
            addToast('error', 'Nelze rezervovat', reason);
            return;
        }

        setIsProcessing(true);
        const finalPrice = calculateRentalPrice(currentUser.id, duration, selectedSlot.room);

        // Zjištění zda je rezervace za více než 120 dní
        const selectedDateObj = parseLocalDate(selectedSlot.date, selectedSlot.time);
        const daysToReservation = (selectedDateObj.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);

        if (finalPrice === 0) {
            await finalizeBooking('paid');
            return;
        }

        if (paymentMethod === 'online') {
            if (daysToReservation > 120) {
               addToast('info', 'Platba bude vyžadována později', 'Vaše rezervace je dále než 120 dní. Výzva k platbě vám přijde e-mailem, až se termín přiblíží.');
               await finalizeBooking('deferred_payment'); 
               return;
            }

            // ID rezervace (deterministické) - definujeme před try, ať je dostupné i pro rollback.
            const bookingId = `${selectedSlot.room}_${selectedSlot.date}_${selectedSlot.time}`;
            let bookingCreated = false;
            try {
                // 1. Nejdřív založíme rezervaci (awaiting_payment), aby ji server mohl ocenit a spárovat.
                await finalizeBooking('awaiting_payment', undefined, false); // neuzavřít okno ještě
                bookingCreated = true;
                setIsProcessing(true);

                // 2. Platbu vytvoříme odkazem na bookingId - cenu i párování řeší server z DB.
                const response = await fetch('/api/create-payment', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        bookingId: bookingId,
                        returnUrl: window.location.origin + window.location.pathname
                    })
                });
                const text = await response.text();
                let data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    throw new Error(`Odpověď ze serveru není validní JSON: ${text.substring(0, 100)}`);
                }
                if (data.error) throw new Error(data.error);

                // 2b. Rezervace zdarma (server vrátí paid) - žádná brána.
                if (data.paid) {
                    updateBookingStatus(bookingId, 'paid');
                    addToast('success', 'Rezervace potvrzena', 'Rezervace nevyžaduje platbu.');
                    setSelectedSlot(null);
                    setIsProcessing(false);
                    return;
                }

                // Bez adresy brány nemá smysl pokračovat - vyvoláme rollback.
                if (!data.gwUrl) {
                    throw new Error("Platební brána nevrátila adresu pro platbu.");
                }

                // 3. paymentId zapsal server do DB; promítneme ho i do lokálního stavu.
                setPaymentIntentIdState(data.paymentId);
                attachPaymentId(bookingId, data.paymentId);

                setPaymentUrl(data.gwUrl);

                // Pokus o otevření GoPay okna.
                // Jelikož appka může běžet v iframe (např. AI Studio preview),
                // GoPay zablokuje zobrazení kvůli X-Frame-Options. Otevřeme proto v novém panelu.
                try {
                    const newWindow = window.open(data.gwUrl, '_blank');
                    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
                        // Popup was blocked, user will have to click the button
                        addToast('info', 'Vyskakovací okno zablokováno', 'Prosím, klikněte na tlačítko "Pokračovat na platební bránu" pro dokončení platby.');
                    }
                } catch (e) {
                    console.error('Nepodařilo se otevřít okno platební brány:', e);
                }
                setIsProcessing(false);
            } catch (err: any) {
                // Rollback: když se platba nepodařila inicializovat, uvolníme právě založený slot,
                // ať nezůstane viset rezervace "čeká na platbu" bez platby.
                if (bookingCreated) {
                    await removeBooking(bookingId);
                }
                addToast('error', 'Platbu se nepodařilo spustit', (err.message || 'Nepodařilo se inicializovat platbu GoPay.') + ' Termín zůstává volný, zkuste to prosím znovu.');
                setIsProcessing(false);
            }
            return;
        }

        // For invoice payments, book immediately
        await finalizeBooking('deferred_payment');
    };

    const finalizeBooking = async (status: BookingStatus = 'awaiting_payment', paymentId?: string, closeModal: boolean = true) => {
        if (!selectedSlot) return;
        setIsProcessing(true);
        
        const finalPrice = calculateRentalPrice(currentUser.id, duration, selectedSlot.room);

        try {
            await onBook({
                bookedByUserId: currentUser.id,
                bookedByName: isGuest ? capitalizeName(guestName) : currentUser.name,
                date: selectedSlot.date,
                time: selectedSlot.time,
                durationMinutes: duration,
                room: selectedSlot.room,
                price: finalPrice,
                status: status,
                paymentMethod: paymentMethod,
                clientName: capitalizeName(clientName),
                clientEmail: isGuest ? guestEmail : undefined,
                clientPhone: isGuest ? guestPhone : undefined,
                equipment: equipment,
                paymentId: paymentId || (status === 'paid' ? paymentIntentIdState || undefined : undefined)
            });

            // --- Send Confirmation Email ---
            if (status !== 'awaiting_payment') {
                sendConfirmationEmail({
                    id: 'temp', // Not strictly needed for email
                    bookedByUserId: currentUser.id,
                    bookedByName: isGuest ? capitalizeName(guestName) : currentUser.name,
                    date: selectedSlot.date,
                    time: selectedSlot.time,
                    durationMinutes: duration,
                    room: selectedSlot.room,
                    price: finalPrice,
                    status: status,
                    paymentMethod: paymentMethod,
                    clientName: capitalizeName(clientName),
                    clientEmail: isGuest ? guestEmail : undefined,
                    clientPhone: isGuest ? guestPhone : undefined,
                    equipment: equipment,
                    paymentId: paymentId || undefined
                } as Booking, status === 'paid');
            }
            // -------------------------------

            addToast('success', 'Rezervace potvrzena', status === 'paid' ? 'Platba byla úspěšná.' : `Částka k úhradě: ${finalPrice.toFixed(0)} Kč`);
            if (closeModal) {
                setSelectedSlot(null);
            }
        } catch (e: any) {
            addToast('error', 'Rezervace se nezdařila', e.message || 'Nepodařilo se uložit rezervaci.');
        }

        setIsProcessing(false);
    };

    return (
        <div className="min-h-screen bg-stone-50 pb-20">
            {/* Header / Navbar */}
            <div className="bg-white border-b border-stone-200 relative z-30 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 min-h-[4rem] py-2 flex flex-wrap lg:flex-nowrap items-center justify-between relative gap-2">
                    <div className="flex items-center gap-3">
                         <div className={`w-10 h-10 rounded-full overflow-hidden border ${isGuest ? 'border-amber-400' : 'border-stone-200'}`}>
                             <img src={currentUser.imageUrl} alt="Profile" className="w-full h-full object-cover" />
                         </div>
                         <div>
                             <h1 className="font-bold text-stone-900 leading-tight truncate max-w-[120px] md:max-w-none">{currentUser.name}</h1>
                             <div className="text-xs text-stone-500 font-medium">
                                 {isGuest ? 'Externí přístup' : 'Lektor'}
                             </div>
                         </div>
                    </div>

                    {/* Centered Logo */}
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:flex items-center">
                        <img 
                            src="/logo.png?v=2" 
                            alt="Centrum Unity Logo" 
                            className="h-10 w-auto" 
                        />
                        <span className="text-xl font-bold font-logo text-stone-800 hidden md:block ml-3 mt-1">Centrum Unity</span>
                    </div>

                    <div className="flex items-center gap-4">
                        {!isGuest && (
                            <Link to="/dashboard" className="p-2 hover:bg-stone-100 text-stone-500 hover:text-stone-900 rounded-lg transition-colors" title="Můj přehled">
                                <LayoutDashboard className="w-5 h-5" />
                            </Link>
                        )}
                        <button onClick={onLogout} className="p-2 hover:bg-red-50 text-stone-400 hover:text-red-600 rounded-lg transition-colors">
                            <LogOut className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-2 md:px-4 py-6">
                
                {/* Controls */}
                <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                     <div className="flex items-center justify-between w-full md:w-auto gap-4">
                        <h2 className="text-2xl font-bold font-heading text-stone-800">Rozvrh</h2>
                        {/* View Toggle */}
                        <div className="flex bg-stone-200 rounded-lg p-1 md:hidden">
                            <button 
                                onClick={() => setViewMode('day')} 
                                className={`p-1.5 rounded-md transition-all ${viewMode === 'day' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500'}`}
                            >
                                <Smartphone className="w-4 h-4" />
                            </button>
                            <button 
                                onClick={() => setViewMode('week')} 
                                className={`p-1.5 rounded-md transition-all ${viewMode === 'week' ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500'}`}
                            >
                                <Monitor className="w-4 h-4" />
                            </button>
                        </div>
                     </div>
                     
                     <div className="flex items-center gap-2 md:gap-4 bg-white p-1.5 rounded-xl shadow-sm border border-stone-200 w-full md:w-auto justify-between md:justify-start">
                        <button onClick={() => handleNavigate(-1)} className="p-3 md:p-2 hover:bg-stone-100 rounded-lg text-stone-600 active:scale-95 transition-transform"><ChevronLeft className="w-5 h-5" /></button>
                        <div className="relative flex items-center gap-2 px-2 font-medium text-stone-800 hover:text-sage-700 transition-colors cursor-pointer" title="Vybrat datum">
                            <button onClick={() => setShowCalendarPicker(!showCalendarPicker)} className="flex items-center gap-2 focus:outline-none">
                                <Calendar className="w-4 h-4 text-sage-600 hidden md:block" />
                                {viewMode === 'day' ? (
                                    <span className="text-sm font-bold capitalize">
                                        {visibleDays[0].toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
                                    </span>
                                ) : (
                                    <span className="text-sm">
                                        {visibleDays[0].getDate()}.{visibleDays[0].getMonth()+1}. – {visibleDays[6].getDate()}.{visibleDays[6].getMonth()+1}.
                                    </span>
                                )}
                            </button>
                            {showCalendarPicker && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowCalendarPicker(false)} />
                                    <div className="absolute top-12 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-0 z-50 origin-top animate-in fade-in zoom-in-95 duration-200">
                                        <MiniCalendar 
                                            selectedDate={currentDate} 
                                            onSelectDate={(d) => { setCurrentDate(d); setShowCalendarPicker(false); }} 
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                        <button onClick={() => handleNavigate(1)} className="p-3 md:p-2 hover:bg-stone-100 rounded-lg text-stone-600 active:scale-95 transition-transform"><ChevronRight className="w-5 h-5" /></button>
                     </div>
                </div>

                {/* --- THE CALENDAR GRID --- */}
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                    <div className="overflow-x-auto scrollbar-hide">
                        <div className={viewMode === 'week' ? 'min-w-[800px]' : ''}>
                            {/* Header Row */}
                            <div 
                                className="grid border-b border-stone-200"
                                style={{ gridTemplateColumns: viewMode === 'day' ? '60px 1fr' : '60px repeat(7, 1fr)' }}
                            >
                                 <div className="p-4 bg-stone-50/50 border-r border-stone-100"></div> 
                                 {visibleDays.map(d => (
                                     <div key={d.toISOString()} className="text-center border-r border-stone-100 last:border-0 flex flex-col h-full animate-in fade-in">
                                         <div className="p-2 border-b border-stone-100/50 bg-white">
                                             <div className="text-xs uppercase font-bold text-stone-400 mb-0.5">{DAYS_MAP[d.getDay()]}</div>
                                             <div className={`font-bold text-lg ${d.toDateString() === new Date().toDateString() ? 'text-sage-700' : 'text-stone-800'}`}>
                                                 {d.getDate()}
                                             </div>
                                         </div>
                                         <div className="flex flex-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">
                                             <div className="flex-1 py-1 bg-stone-50 border-r border-stone-100 flex items-center justify-center gap-1">
                                                 <span className="w-2 h-2 rounded-full bg-stone-300"></span> M1 <span className={`${viewMode === 'week' ? 'hidden xl:inline' : ''}`}>(Malá)</span>
                                             </div>
                                             <div className="flex-1 py-1 bg-indigo-50/30 flex items-center justify-center gap-1">
                                                 <span className="w-2 h-2 rounded-full bg-indigo-200"></span> M2 <span className={`${viewMode === 'week' ? 'hidden xl:inline' : ''}`}>(Velká)</span>
                                             </div>
                                         </div>
                                     </div>
                                 ))}
                            </div>

                            {/* Time Rows */}
                            <div className="relative">
                                {GENERATED_TIMES.map((time, tIdx) => (
                                    <div 
                                        key={time} 
                                        className="grid min-h-[50px] border-b border-stone-100 last:border-0 group"
                                        style={{ gridTemplateColumns: viewMode === 'day' ? '60px 1fr' : '60px repeat(7, 1fr)' }}
                                    >
                                <div className="py-2 px-1 text-center text-xs font-medium text-stone-400 border-r border-stone-100 flex items-start justify-center pt-3 bg-stone-50/30">
                                    {time}
                                </div>
                                {visibleDays.map((date, dIdx) => {
                                    const r1 = getSlotStatus(date, time, 1);
                                    const r2 = getSlotStatus(date, time, 2);
                                    
                                    const renderSubSlot = (roomNum: 1|2, data: typeof r1) => {
                                        let bgClass = roomNum === 1 ? "bg-white hover:bg-stone-50" : "bg-indigo-50/10 hover:bg-indigo-50";
                                        let content = null;
                                        
                                        if (data.status === 'past') {
                                            bgClass = "bg-stone-100/60 cursor-not-allowed";
                                        } else if (data.status === 'mine') {
                                            if (data.booking?.id.startsWith('event-')) {
                                                bgClass = "bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm";
                                                const eventName = (currentUser.role === Role.ADMIN && data.booking?.bookedByUserId !== currentUser.id) 
                                                    ? 'Cizí akce' 
                                                    : 'MOJE AKCE';
                                                content = <span className="text-[10px] font-bold truncate px-1 uppercase">{eventName}</span>;
                                            } else {
                                                const practitioner = practitionersList.find(p => p.id === data.booking?.bookedByUserId);
                                                const isPending = data.booking?.status === 'awaiting_payment';
                                                const colorClass = practitioner?.colorCode ? `${practitioner.colorCode} hover:opacity-90` : 'bg-emerald-500 hover:bg-emerald-600';
                                                bgClass = `${colorClass} text-white shadow-sm flex flex-col items-center justify-center py-1 leading-tight ${isPending ? 'opacity-70 ring-2 ring-amber-300 ring-inset' : ''}`;

                                                const displayName = (currentUser.role === Role.ADMIN && data.booking?.bookedByUserId !== currentUser.id)
                                                    ? (data.booking?.bookedByName || 'Obsazeno')
                                                    : 'MOJE';

                                                content = (
                                                    <>
                                                        <span className="text-[9px] font-bold truncate px-1 text-center uppercase">{displayName}</span>
                                                        {isPending ? (
                                                            <span className="flex items-center gap-0.5 text-[8px] font-bold text-amber-100 uppercase mt-0.5">
                                                                <Clock className="w-2.5 h-2.5" /> platba
                                                            </span>
                                                        ) : (
                                                            <div className="flex gap-1 mt-0.5">
                                                                {data.booking?.equipment === 'table' && <Bed className="w-3 h-3 text-white/80" />}
                                                                {data.booking?.equipment === 'futon' && <Layers className="w-3 h-3 text-white/80" />}
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            }
                                        } else if (data.status === 'occupied') {
                                            if (data.booking?.id.startsWith('event-')) {
                                                bgClass = "bg-indigo-100 cursor-not-allowed border border-indigo-200";
                                                content = <span className="text-[9px] font-bold text-indigo-700 truncate px-1">Skupinová Událost</span>;
                                            } else {
                                                const practitioner = practitionersList.find(p => p.id === data.booking?.bookedByUserId);
                                                const isPending = data.booking?.status === 'awaiting_payment';
                                                const colorClass = practitioner?.colorCode || 'bg-stone-200';
                                                bgClass = `${colorClass} cursor-not-allowed text-white shadow-sm flex flex-col items-center justify-center py-1 leading-tight ${isPending ? 'opacity-70 ring-2 ring-amber-300 ring-inset' : ''}`;
                                                content = (
                                                    <>
                                                        <span className="text-[9px] font-bold truncate px-1 text-center">{data.booking?.bookedByName}</span>
                                                        {isPending ? (
                                                            <span className="flex items-center gap-0.5 text-[8px] font-bold text-amber-100 uppercase mt-0.5">
                                                                <Clock className="w-2.5 h-2.5" /> platba
                                                            </span>
                                                        ) : (
                                                            <div className="flex gap-1 mt-0.5">
                                                                {data.booking?.equipment === 'table' && <Bed className="w-3 h-3 text-white/80" />}
                                                                {data.booking?.equipment === 'futon' && <Layers className="w-3 h-3 text-white/80" />}
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            }
                                        } else if (data.status === 'cleaning') {
                                            bgClass = "bg-amber-100 cursor-not-allowed repeating-linear-gradient-45";
                                        }

                                        return (
                                            <div 
                                                onClick={() => handleSlotClick(date, time, roomNum, data)}
                                                className={`flex-1 flex items-center justify-center transition-all cursor-pointer relative ${bgClass} ${roomNum === 1 ? 'border-r border-stone-200' : ''}`}
                                            >
                                                {content}
                                                {data.status === 'free' && (
                                                    <div className="opacity-0 hover:opacity-100 absolute inset-0 flex items-center justify-center bg-sage-100/50 text-sage-700 font-bold text-xs">
                                                        +
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    };

                                    return (
                                        <div key={`${date}-${time}`} className="border-r border-stone-100 last:border-0 flex">
                                            {renderSubSlot(1, r1)}
                                            {renderSubSlot(2, r2)}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                  </div>
                </div>
                </div>

                <div className="mt-6 flex flex-col md:flex-row gap-2 md:gap-4 text-xs text-stone-400 justify-center items-center text-center">
                    <div className="flex gap-4">
                        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-stone-50 border border-stone-200"></span> M1 (Malá)</span>
                        <span className="text-stone-300">|</span>
                        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-indigo-50 border border-indigo-100"></span> M2 (Velká)</span>
                    </div>
                    <div className="flex flex-col md:flex-row gap-1 md:gap-4 md:ml-4">
                        <span className="text-amber-600 font-bold">* Úklid: 30 min (stejný lektor) / 60 min (výměna)</span>
                        <span className="text-red-400 font-bold">* Storno: min. 24h předem</span>
                    </div>
                </div>

            </div>

            {/* Booking Modal */}
            {selectedSlot && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 md:zoom-in-95 flex flex-col max-h-[90vh]">
                        <div className={`text-white p-6 relative flex-shrink-0 ${isGuest ? 'bg-amber-600' : 'bg-stone-900'}`}>
                            <h3 className="text-xl font-bold font-heading">
                                {isGuest ? 'Jednorázová Rezervace' : 'Nová Rezervace'}
                            </h3>
                            <div className={`flex items-center gap-4 text-sm mt-2 ${isGuest ? 'text-amber-100' : 'text-stone-400'}`}>
                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {formatLocalDate(selectedSlot.date)}</span>
                                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {selectedSlot.time}</span>
                            </div>
                            <button onClick={() => { setSelectedSlot(null); setPaymentUrl(null); }} className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20"><X className="w-4 h-4" /></button>
                        </div>
                        
                        <div className={`p-6 space-y-6 overflow-y-auto`}>
                            {/* Room Info */}
                            <div className="flex gap-4">
                                <div className={`flex-1 p-3 rounded-xl border-2 text-center ${selectedSlot.room === 1 ? 'border-sage-500 bg-sage-50 text-sage-800' : 'border-stone-100 text-stone-400 bg-stone-50 opacity-50'}`}>
                                    <div className="text-xs font-bold uppercase mb-1">Místnost 1</div>
                                    <div className="font-bold text-sm md:text-base">Malá Terapeutovna</div>
                                    <div className="text-xs mt-1">{RENTAL_PRICING.room1} Kč/h</div>
                                </div>
                                <div className={`flex-1 p-3 rounded-xl border-2 text-center ${selectedSlot.room === 2 ? 'border-sage-500 bg-sage-50 text-sage-800' : 'border-stone-100 text-stone-400 bg-stone-50 opacity-50'}`}>
                                    <div className="text-xs font-bold uppercase mb-1">Místnost 2</div>
                                    <div className="font-bold text-sm md:text-base">Velký Sál</div>
                                    <div className="text-xs mt-1">{RENTAL_PRICING.room2} Kč/h</div>
                                </div>
                            </div>

                            {/* Equipment Selection */}
                            <div>
                                <label className="block text-sm font-bold text-stone-700 mb-2">Jaké vybavení potřebujete?</label>
                                <div className="grid grid-cols-3 gap-3">
                                    <button
                                        onClick={() => setEquipment('table')}
                                        className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                                            equipment === 'table'
                                            ? 'border-sage-600 bg-sage-50 text-sage-900 shadow-sm'
                                            : 'border-stone-200 text-stone-500 hover:border-sage-200 hover:bg-stone-50'
                                        }`}
                                    >
                                        <Bed className="w-6 h-6" />
                                        <span className="font-bold text-sm">Lehátko (Stůl)</span>
                                    </button>
                                    <button
                                        onClick={() => setEquipment('futon')}
                                        className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                                            equipment === 'futon'
                                            ? 'border-sage-600 bg-sage-50 text-sage-900 shadow-sm'
                                            : 'border-stone-200 text-stone-500 hover:border-sage-200 hover:bg-stone-50'
                                        }`}
                                    >
                                        <Layers className="w-6 h-6" />
                                        <span className="font-bold text-sm">Futon (Země)</span>
                                    </button>
                                    <button
                                        onClick={() => setEquipment('none')}
                                        className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                                            equipment === 'none'
                                            ? 'border-sage-600 bg-sage-50 text-sage-900 shadow-sm'
                                            : 'border-stone-200 text-stone-500 hover:border-sage-200 hover:bg-stone-50'
                                        }`}
                                    >
                                        <X className="w-6 h-6" />
                                        <span className="font-bold text-sm">Bez vybavení</span>
                                    </button>
                                </div>
                            </div>

                            {/* Duration Slider/Select */}
                            <div>
                                <label className="block text-sm font-bold text-stone-700 mb-2">Délka rezervace</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[60, 90, 120, 150, 180, 210, 240, 270, 300, 720].map(m => (
                                        <button
                                            key={m}
                                            onClick={() => setDuration(m)}
                                            className={`py-2 rounded-lg text-sm font-bold transition-all ${duration === m ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                                        >
                                            {m === 720 ? 'Celý den' : `${m} min`}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* GUEST SPECIFIC FIELDS */}
                            {isGuest ? (
                                <div className="space-y-4 pt-4 border-t border-amber-100 bg-amber-50 p-4 rounded-xl border">
                                    <h4 className="font-bold text-amber-800 text-sm flex items-center gap-2">
                                        <User className="w-4 h-4" /> Údaje o Hostovi (Povinné)
                                    </h4>
                                    
                                    <div>
                                        <label className="block text-xs font-bold text-stone-600 mb-1">Vaše Jméno a Příjmení</label>
                                        <input 
                                            type="text" 
                                            className="w-full p-2 border border-stone-300 rounded-lg text-sm"
                                            placeholder="Jan Novák"
                                            value={guestName}
                                            onChange={e => setGuestName(e.target.value)}
                                        />
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs font-bold text-stone-600 mb-1">Email (pro fakturu)</label>
                                            <div className="relative">
                                                <Mail className="absolute left-2.5 top-2.5 w-4 h-4 text-stone-400" />
                                                <input 
                                                    type="email" 
                                                    className="w-full pl-9 p-2 border border-stone-300 rounded-lg text-sm"
                                                    placeholder="@"
                                                    value={guestEmail}
                                                    onChange={e => setGuestEmail(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-stone-600 mb-1">Telefon</label>
                                            <div className="relative">
                                                <Phone className="absolute left-2.5 top-2.5 w-4 h-4 text-stone-400" />
                                                <input 
                                                    type="tel" 
                                                    className="w-full pl-9 p-2 border border-stone-300 rounded-lg text-sm"
                                                    placeholder="+420"
                                                    value={guestPhone}
                                                    onChange={e => setGuestPhone(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                        {isGuest && (
                                            <p className="text-[10px] text-amber-700 leading-tight">
                                                * Na zadaný email vám po potvrzení dorazí informace.
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                /* Regular Client Note */
                                <div className="mt-4">
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Klient / Poznámka (Volitelné)</label>
                                    <input 
                                        type="text" 
                                        className="w-full p-3 bg-white border border-stone-200 rounded-xl text-stone-900 placeholder-stone-400 focus:ring-2 focus:ring-sage-500 outline-none"
                                        placeholder="Jméno klienta pro vaši orientaci..."
                                        value={clientName}
                                        onChange={e => setClientName(e.target.value)}
                                    />
                                </div>
                                )}

                            {/* Payment Method Selection */}
                            <div className="mt-4 border-t border-stone-200 pt-4">
                                <label className="block text-sm font-bold text-stone-700 mb-2">Způsob úhrady</label>
                                <div className="grid grid-cols-1 gap-2 mb-2">
                                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm font-bold text-indigo-700 text-center">
                                        Online Platba
                                    </div>
                                </div>
                                <p className="text-xs text-indigo-700 leading-tight mt-2 text-center">
                                    Budete přesměrováni na bezpečnou platební bránu (Apple Pay, Google Pay, nebo platba kartou).
                                </p>
                            </div>

                            {/* Summary & Action */}
                            <div className="bg-stone-50 p-4 rounded-xl flex flex-col md:flex-row gap-4 md:justify-between md:items-center border border-stone-100 mt-auto">
                                <div>
                                    <div className="text-xs font-bold text-stone-500 uppercase">Cena celkem</div>
                                    <div className="text-xl font-bold text-stone-900">
                                        {calculateRentalPrice(currentUser.id, duration, selectedSlot.room)} Kč
                                    </div>
                                </div>
                                {paymentUrl ? (
                                    <a 
                                        href={paymentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-white px-6 w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 py-2 rounded-xl font-medium text-center shadow-sm"
                                    >
                                        Pokračovat na platební bránu
                                    </a>
                                ) : (
                                    <Button 
                                        onClick={handleConfirmBooking} 
                                        disabled={isProcessing}
                                        className="text-white px-6 w-full md:w-auto bg-indigo-600 hover:bg-indigo-700"
                                    >
                                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Zaplatit online'}
                                    </Button>
                                )}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
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
                                Opravdu chcete zrušit rezervaci z {formatLocalDate(bookingToCancel.date)} v {bookingToCancel.time}?
                                {!isTooLate && bookingToCancel.paymentId && (
                                    <span className="block mt-2 font-medium text-stone-800">
                                        Částka bude refundována na Vaši kartu.
                                    </span>
                                )}
                                {isTooLate && (
                                    <span className="block mt-2 font-medium text-red-600">
                                        Termín je příliš blízko, nelze jej stornovat s nárokem na vrácení peněz online. Kontaktujte prosím manažera.
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

export default StudioSchedule;