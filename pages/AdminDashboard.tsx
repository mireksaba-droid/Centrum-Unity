import React, { useState, useMemo } from 'react';
import { Booking, Practitioner, Service, Role, GroupEvent, EventRegistration } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, Search, MoreHorizontal, Settings, ShieldAlert, Edit, Trash2, CheckCircle, XCircle, Clock, Filter, Eye, EyeOff, Activity, Layers, BoxSelect, AlertTriangle, Trophy, LogOut, Plus, X, Save, Lock, Megaphone, Link } from 'lucide-react';
import Button from '../components/Button';
import StudioSchedule from './StudioSchedule';
import RescheduleModal from '../components/RescheduleModal';
import { useToast } from '../contexts/ToastContext';
import { checkBookingCollision, timeToMinutes } from '../utils/scheduler';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { useStore } from '../store/useStore';

interface AdminDashboardProps {
  allBookings: Booking[];
  practitioners: Practitioner[];
  groupEvents: GroupEvent[];
  eventRegistrations: EventRegistration[];
  updatePractitioner: (p: Practitioner) => void;
  onAddPractitioner: (p: Practitioner) => void;
  onAdminReschedule: (bookingId: string, newDate: string, newTime: string, reason?: string) => Promise<void>;
  onCreateGroupEvent: (event: GroupEvent) => void;
  onUpdateGroupEvent: (event: GroupEvent) => void;
  onDeleteGroupEvent: (eventId: string) => void;
  onBook: (bookingData: Partial<Booking>) => Promise<void>;
  onCancel: (bookingId: string) => Promise<void>;
  onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
    allBookings, 
    practitioners, 
    groupEvents,
    eventRegistrations,
    updatePractitioner,
    onAddPractitioner,
    onAdminReschedule,
    onCreateGroupEvent,
    onUpdateGroupEvent,
    onDeleteGroupEvent,
    onBook,
    onCancel,
    onLogout
}) => {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'calendar' | 'analytics' | 'schedule' | 'team' | 'events'>('calendar');
    const [searchQuery, setSearchQuery] = useState('');
    const [scheduleFilter, setScheduleFilter] = useState<'all' | 'today' | 'upcoming'>('all');
    
    // Reschedule Modal State
    const [reschedulingBooking, setReschedulingBooking] = useState<Booking | null>(null);

    // Practitioner Modal State (Add/Edit)
    const [isPractitionerModalOpen, setIsPractitionerModalOpen] = useState(false);
    const [editingPractitionerId, setEditingPractitionerId] = useState<string | null>(null);
    
    // Form State
    const [practitionerForm, setPractitionerForm] = useState<{name: string, title: string, pin: string, role: Role, category: string}>({
        name: '',
        title: '',
        pin: '',
        role: Role.PRACTITIONER,
        category: 'Terapie 1-1'
    });

    // Event Modal State
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [eventForm, setEventForm] = useState<Partial<GroupEvent>>({
        title: '',
        description: '',
        date: '',
        startTime: '',
        endTime: '',
        capacity: 10,
        price: 500,
        practitionerId: ''
    });

    const handleOpenEventModal = (eventToEdit?: GroupEvent) => {
        if (eventToEdit) {
            setEditingEventId(eventToEdit.id);
            setEventForm({ ...eventToEdit });
        } else {
            setEditingEventId(null);
            setEventForm({
                title: '',
                description: '',
                date: '',
                startTime: '',
                endTime: '',
                capacity: 10,
                price: 500,
                practitionerId: practitioners[0]?.id || ''
            });
        }
        setIsEventModalOpen(true);
    };

    const handleDeleteEvent = (eventId: string) => {
        if (window.confirm('Opravdu chcete smazat tuto událost?')) {
            onDeleteGroupEvent(eventId);
            addToast('success', 'Smazáno', 'Událost byla úspěšně smazána.');
        }
    };

    const handleEventSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!eventForm.title || !eventForm.date || !eventForm.startTime || !eventForm.endTime || !eventForm.practitionerId) {
            addToast('error', 'Chyba', 'Vyplňte všechna povinná pole.');
            return;
        }

        const duration = timeToMinutes(eventForm.endTime!) - timeToMinutes(eventForm.startTime!);
        if (duration <= 0) {
            addToast('error', 'Neplatný čas', 'Čas konce musí být po čase začátku.');
            return;
        }

        // Kontrola kolizí s existujícími rezervacemi a událostmi (kromě té editované)
        const combinedBookings = [
            ...allBookings,
            ...groupEvents
                .filter(ev => ev.id !== editingEventId)
                .map(ev => ({
                    id: `event-${ev.id}`,
                    bookedByUserId: ev.practitionerId,
                    bookedByName: 'Skupinová Událost',
                    date: ev.date,
                    time: ev.startTime,
                    durationMinutes: timeToMinutes(ev.endTime) - timeToMinutes(ev.startTime),
                    room: 2 as const,
                    price: 0,
                    status: 'confirmed' as const,
                    paymentStatus: 'paid' as const,
                    paymentMethod: 'invoice' as const,
                    createdAt: ev.createdAt || new Date().toISOString()
                }))
        ];

        const { hasCollision, reason, conflictingBooking } = checkBookingCollision({
            newDate: eventForm.date!,
            newTime: eventForm.startTime!,
            durationMinutes: duration,
            room: 2, // Události jsou vždy ve Velké místnosti
            userId: eventForm.practitionerId!,
            allBookings: combinedBookings
        });

        if (hasCollision) {
            if (conflictingBooking && !conflictingBooking.id.startsWith('event-')) {
                addToast('error', 'Kolize v kalendáři', `Velká místnost je obsazena. Přesměrovávám na přesun rezervace (${conflictingBooking.bookedByName}).`);
                setReschedulingBooking(conflictingBooking);
            } else {
                addToast('error', 'Kolize v kalendáři', `Nelze uložit událost. Velká místnost je obsazena: ${reason}`);
            }
            return;
        }

        if (editingEventId) {
            const updatedEvent: GroupEvent = {
                ...(eventForm as GroupEvent),
                id: editingEventId,
                capacity: Number(eventForm.capacity) || 10,
                price: Number(eventForm.price) || 0,
            };
            onUpdateGroupEvent(updatedEvent);
            addToast('success', 'Událost upravena', 'Skupinová událost byla úspěšně upravena.');
        } else {
            const newEvent: GroupEvent = {
                id: crypto.randomUUID(),
                title: eventForm.title!,
                description: eventForm.description,
                date: eventForm.date!,
                startTime: eventForm.startTime!,
                endTime: eventForm.endTime!,
                capacity: Number(eventForm.capacity) || 10,
                price: Number(eventForm.price) || 0,
                practitionerId: eventForm.practitionerId!,
                room: 2,
                createdAt: new Date().toISOString()
            };
            onCreateGroupEvent(newEvent);
            addToast('success', 'Událost vytvořena', 'Skupinová událost byla úspěšně vytvořena.');
        }
        
        setIsEventModalOpen(false);
    };

    // --- ANALYTICS DATA ---
    const stats = useMemo(() => {
        console.log("Stats calculation with allBookings:", allBookings);
        const confirmedBookings = allBookings.filter(b => b.status === 'confirmed');
        const cancelledBookings = allBookings.filter(b => b.status === 'cancelled');
        
        const totalRevenue = confirmedBookings.reduce((sum, b) => sum + b.price, 0);
        const totalBookings = confirmedBookings.length;
        
        // 1. Revenue by Day (Basic)
        const revenueByDay = confirmedBookings.reduce((acc, curr) => {
            const day = formatLocalDate(curr.date, { weekday: 'short' });
            acc[day] = (acc[day] || 0) + curr.price;
            return acc;
        }, {} as Record<string, number>);
        const chartData = Object.keys(revenueByDay).map(day => ({ name: day, value: revenueByDay[day] }));

        // 2. Peak Hours Heatmap Logic (Smart Occupancy)
        const hoursOccupancy = new Array(24).fill(0);

        confirmedBookings.forEach(b => {
            const [h, m] = b.time.split(':').map(Number);
            const startHour = h;
            const durationHours = Math.ceil(b.durationMinutes / 60);
            
            for (let i = 0; i < durationHours; i++) {
                const currentHour = startHour + i;
                if (currentHour < 24) {
                    hoursOccupancy[currentHour]++;
                }
            }
        });

        const peakHoursData = hoursOccupancy
            .map((count, hour) => ({ name: `${hour}:00`, count }))
            .filter((_, index) => index >= 7 && index <= 21);

        // 3. Equipment Utilization
        const tableCount = confirmedBookings.filter(b => b.equipment === 'table').length;
        const futonCount = confirmedBookings.filter(b => b.equipment === 'futon').length;
        const equipmentData = [
            { name: 'Lehátko', value: tableCount, color: '#4f46e5' }, // Indigo
            { name: 'Futon', value: futonCount, color: '#9ca3af' },   // Gray
        ];

        // 4. Room Utilization
        const room1Count = confirmedBookings.filter(b => b.room === 1).length;
        const room2Count = confirmedBookings.filter(b => b.room === 2).length;
        const roomData = [
            { name: 'Malá (R1)', value: room1Count, color: '#ba8a5b' }, // Gold/Sage
            { name: 'Velká (R2)', value: room2Count, color: '#7a573d' }, // Brown
        ];

        // 5. Revenue Trend (Dynamic Last 6 Months)
        const today = new Date();
        const last6Months = Array.from({ length: 6 }, (_, i) => {
            const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
            return d;
        });

        const revenueTrendData = last6Months.map((monthDate, index) => {
            const monthKey = monthDate.getMonth();
            const yearKey = monthDate.getFullYear();
            
            // Sum bookings for this month
            const monthlySum = confirmedBookings.reduce((sum, b) => {
                const bDate = parseLocalDate(b.date);
                if (bDate.getMonth() === monthKey && bDate.getFullYear() === yearKey) {
                    return sum + b.price;
                }
                return sum;
            }, 0);

            // Czech month name
            const name = monthDate.toLocaleDateString('cs-CZ', { month: 'long' });
            const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);

            return {
                name: capitalizedName,
                revenue: monthlySum, 
                isReal: true // All data is now real
            };
        });

        // 6. REVENUE ATTRIBUTION
        const revenueByPractitioner: Record<string, number> = {};
        confirmedBookings.forEach(b => {
            const name = b.practitionerName || b.bookedByName || 'Neznámý';
            revenueByPractitioner[name] = (revenueByPractitioner[name] || 0) + b.price;
        });
        const topPerformersData = Object.entries(revenueByPractitioner)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // 7. CANCELLATION METRICS (REAL CALCULATION)
        const totalCancelled = cancelledBookings.length;
        const totalAll = totalBookings + totalCancelled;
        const cancellationRate = totalAll > 0 ? ((totalCancelled / totalAll) * 100).toFixed(1) : "0";
        
        // Calculate Lead Time distribution
        const leadTimes = { critical: 0, warning: 0, safe: 0 };
        
        cancelledBookings.forEach(b => {
            if (!b.cancelledAt) {
                return; 
            }
            const bookingDate = parseLocalDate(b.date, b.time);
            const cancelDate = new Date(b.cancelledAt);
            const diffMs = bookingDate.getTime() - cancelDate.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            
            if (diffHours < 24) {
                leadTimes.critical++;
            } else if (diffHours < 48) {
                leadTimes.warning++;
            } else {
                leadTimes.safe++;
            }
        });

        const cancellationLeadTimeData = [
            { name: '< 24h (Krizové)', value: leadTimes.critical, color: '#ef4444' },
            { name: '24-48h (Varovné)', value: leadTimes.warning, color: '#f59e0b' },
            { name: '> 48h (Bezpečné)', value: leadTimes.safe, color: '#10b981' },
        ];

        return { 
            totalRevenue, 
            totalBookings, 
            chartData, 
            peakHoursData,
            equipmentData,
            roomData,
            revenueTrendData,
            topPerformersData,
            cancellationLeadTimeData,
            cancellationRate
        };
    }, [allBookings]);

    // --- TEAM MANAGEMENT HANDLERS ---
    const handleToggleActive = (practitioner: Practitioner) => {
        if (window.confirm(`Opravdu chcete ${practitioner.isActive ? 'deaktivovat' : 'aktivovat'} profil lektora ${practitioner.name}?`)) {
            updatePractitioner({
                ...practitioner,
                isActive: !practitioner.isActive
            });
            addToast('success', 'Status změněn', `Profil ${practitioner.name} byl ${practitioner.isActive ? 'deaktivován' : 'aktivován'}.`);
        }
    };

    const handleOpenAddModal = () => {
        setEditingPractitionerId(null);
        setPractitionerForm({
            name: '',
            title: '',
            pin: '',
            role: Role.PRACTITIONER,
            category: 'Terapie 1-1'
        });
        setIsPractitionerModalOpen(true);
    };

    const handleOpenEditModal = (p: Practitioner) => {
        setEditingPractitionerId(p.id);
        setPractitionerForm({
            name: p.name,
            title: p.title,
            pin: p.pin || '',
            role: p.role || Role.PRACTITIONER,
            category: p.category
        });
        setIsPractitionerModalOpen(true);
    };

    const handlePractitionerSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!practitionerForm.name || !practitionerForm.pin) {
            addToast('error', 'Chyba', 'Jméno a PIN jsou povinné údaje.');
            return;
        }

        if (editingPractitionerId) {
            // EDIT EXISTING
            const existing = practitioners.find(p => p.id === editingPractitionerId);
            if (existing) {
                const updated: Practitioner = {
                    ...existing,
                    name: practitionerForm.name,
                    title: practitionerForm.title,
                    pin: practitionerForm.pin,
                    category: practitionerForm.category,
                    role: practitionerForm.role,
                    specialties: [practitionerForm.category]
                };
                updatePractitioner(updated);
                addToast('success', 'Uloženo', `Profil ${updated.name} byl upraven.`);
            }
        } else {
            // ADD NEW
            const id = practitionerForm.name.toLowerCase().replace(/ /g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const imageUrl = `https://images.unsplash.com/photo-${Math.random() > 0.5 ? '1544005313-94ddf0286df2' : '1500648767791-00dcc994a43e'}?auto=format&fit=crop&q=80&w=400`;

            const newP: Practitioner = {
                id,
                name: practitionerForm.name,
                title: practitionerForm.title,
                category: practitionerForm.category,
                imageUrl,
                description: 'Nový člen týmu Centra Unity.',
                rating: 5.0,
                reviewCount: 0,
                specialties: [practitionerForm.category],
                availability: [],
                services: [],
                role: practitionerForm.role,
                isActive: true,
                pin: practitionerForm.pin
            };

            onAddPractitioner(newP);
            addToast('success', 'Lektor přidán', `Profil ${newP.name} byl úspěšně vytvořen.`);
        }

        setIsPractitionerModalOpen(false);
    };

    // --- SCHEDULE FILTERING ---
    const filteredBookings = allBookings.filter(b => {
        const pName = b.practitionerName || b.bookedByName || '';
        const sName = b.serviceName || '';
        const matchesSearch = pName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              sName.toLowerCase().includes(searchQuery.toLowerCase());
        
        if (!matchesSearch) return false;

        const bookingDate = parseLocalDate(b.date);
        const today = new Date();
        today.setHours(0,0,0,0);

        if (scheduleFilter === 'today') {
            return bookingDate.getTime() === today.getTime();
        }
        if (scheduleFilter === 'upcoming') {
            return bookingDate >= today;
        }
        return true;
    }).sort((a,b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime());

    // --- FUTURE PAYMENTS LOGIC ---
    const { updateBookingPaymentStatus, token } = useStore();
    const [isProcessingPayments, setIsProcessingPayments] = useState(false);

    const dueFutureBookings = useMemo(() => {
        const today = new Date();
        return allBookings.filter(b => {
            if (b.paymentStatus !== 'pending_future') return false;
            const bDate = parseLocalDate(b.date);
            const daysToReservation = (bDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
            return daysToReservation <= 120;
        });
    }, [allBookings]);

    const handleProcessFuturePayments = async () => {
        setIsProcessingPayments(true);
        let count = 0;

        for (const booking of dueFutureBookings) {
            const targetEmail = booking.clientEmail || 'mirek.saba@gmail.com'; // fallback
            
            // Note: Since we use HashRouter, the URL looks like /#/pay/ID
            const paymentLink = `${window.location.origin}/#/pay/${booking.id}`;
            const emailHtml = `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <h2 style="color: #4f46e5;">Výzva k platbě rezervace - Centrum Unity</h2>
                    <p>Dobrý den,</p>
                    <p>blíží se termín Vaší rezervace. Nyní je možné ji uhradit online.</p>
                    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Datum:</strong> ${formatLocalDate(booking.date)}</p>
                        <p><strong>Částka k úhradě:</strong> ${booking.price} Kč</p>
                    </div>
                    <a href="${paymentLink}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Zaplatit online</a>
                    <p style="margin-top: 20px;">Těšíme se na Vás,<br>Sólás Holistic Studio & Centrum Unity</p>
                </div>
            `;

            try {
                await fetch('/api/send-email', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        to: targetEmail,
                        subject: 'Výzva k platbě rezervace - Centrum Unity',
                        html: emailHtml
                    })
                });

                await updateBookingPaymentStatus(booking.id, 'unpaid'); // update status so it doesn't get processed again
                count++;
            } catch (error) {
                console.error("Failed to send payment email for booking", booking.id, error);
            }
        }

        setIsProcessingPayments(false);
        addToast('success', 'Výzvy odeslány', `Úspěšně odesláno ${count} výzev k platbě.`);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-12">
            
            {/* Admin Header */}
            <div className="bg-indigo-900 border-b-4 border-indigo-500 text-white p-8 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
                <div className="absolute right-0 top-0 opacity-10 pointer-events-none translate-x-1/4 -translate-y-1/4">
                     <img src="/logo.png?v=2" alt="Background Logo" className="w-96 h-96 object-contain invert mix-blend-screen" />
                </div>
                <div className="relative z-10 flex items-center gap-6 w-full md:w-auto">
                    <div className="hidden md:flex w-20 h-20 bg-white rounded-2xl items-center justify-center shadow-md p-3 overflow-hidden">
                        <img 
                            src="/logo.png?v=2" 
                            alt="Centrum Unity Logo" 
                            className="w-full h-full object-contain" 
                        />
                        <div className="hidden w-10 h-10 border-4 border-white rounded-full"></div>
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <div className="bg-indigo-700 p-1.5 rounded text-xs font-bold uppercase tracking-wider">Admin Zóna</div>
                            <span className="text-indigo-200 text-sm">v2.1 Intelligence</span>
                        </div>
                        <h1 className="text-3xl font-bold font-heading">Manažerský Panel</h1>
                        <p className="text-indigo-200 mt-1">Správa studia, týmu a business intelligence.</p>
                    </div>
                </div>
                <div className="relative z-10 flex flex-col items-end gap-4 w-full md:w-auto">
                     <button 
                        onClick={onLogout}
                        className="flex items-center gap-2 bg-indigo-800 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors border border-indigo-700"
                    >
                        <LogOut className="w-4 h-4" /> Odhlásit se
                    </button>
                    
                    <div className="flex gap-4">
                        <div className="text-right hidden md:block">
                            <div className="text-2xl font-bold">{stats.totalRevenue.toLocaleString()} Kč</div>
                            <div className="text-indigo-300 text-sm">Celkové tržby</div>
                        </div>
                        <div className="h-12 w-px bg-indigo-700 hidden md:block"></div>
                        <div className="text-right hidden md:block">
                            <div className="text-2xl font-bold">{stats.totalBookings}</div>
                            <div className="text-indigo-300 text-sm">Rezervací (Total: {allBookings.length})</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex overflow-x-auto gap-2 border-b border-stone-200 pb-1">
                <button 
                    onClick={() => setActiveTab('calendar')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'calendar' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <Calendar className="w-4 h-4" /> Master Kalendář
                </button>
                <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'analytics' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <TrendingUp className="w-4 h-4" /> BI & Statistiky
                </button>
                <button 
                    onClick={() => setActiveTab('schedule')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'schedule' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <Calendar className="w-4 h-4" /> Master Schedule
                </button>
                <button 
                    onClick={() => setActiveTab('team')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'team' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <Users className="w-4 h-4" /> Správa Týmu
                </button>
                <button 
                    onClick={() => setActiveTab('events')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'events' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <Megaphone className="w-4 h-4" /> Skupinové Události
                </button>
            </div>

            
            {/* === ANALYTICS TAB === */}
            {activeTab === 'analytics' && (
                <div className="space-y-8 animate-in slide-in-from-bottom-2 fade-in">
                    
                    {allBookings.length === 0 ? (
                        <div className="bg-white p-12 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mb-6">
                                <Activity className="w-10 h-10 text-stone-400" />
                            </div>
                            <h3 className="text-2xl font-bold text-stone-900 mb-2">Zatím nejsou k dispozici žádná data</h3>
                            <p className="text-stone-500 max-w-md">Statistiky a grafy se začnou zobrazovat automaticky, jakmile přijdou první reálné rezervace od vašich klientů.</p>
                        </div>
                    ) : (
                        <>
                            {/* SECTION 1: FINANCIAL PERFORMANCE */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Revenue Trend */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-6 flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-indigo-600" /> Vývoj tržeb (Posledních 6 měsíců)
                                    </h3>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats.revenueTrendData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <Tooltip 
                                                    cursor={{fill: '#f1f5f9'}} 
                                                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                                                    formatter={(value: any) => {
                                                        return [`${value.toLocaleString()} Kč`, 'Tržba'];
                                                    }}
                                                />
                                                <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Revenue Attribution (Top Performers) */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-2 flex items-center gap-2">
                                        <Trophy className="w-5 h-5 text-amber-500" /> Kdo generuje tržby
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-6">Kteří lektoři generují nejvyšší obrat studia.</p>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats.topPerformersData} layout="vertical" margin={{ left: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 11, fontWeight: 'bold'}} />
                                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                                                <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20}>
                                                    {stats.topPerformersData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={index === 0 ? '#f59e0b' : '#10b981'} />
                                                    ))}
                                                </Bar>
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 2: OPERATIONAL RISKS & CANCELLATIONS */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {/* Cancellation Rate Card */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center justify-center text-center">
                                    <div className="p-3 bg-red-50 rounded-full mb-3">
                                        <AlertTriangle className="w-6 h-6 text-red-500" />
                                    </div>
                                    <h4 className="text-3xl font-bold text-stone-900">{stats.cancellationRate}%</h4>
                                    <p className="text-sm text-stone-500 font-medium">Celková míra storna</p>
                                </div>

                                {/* Cancellation Lead Time (Donut) */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm md:col-span-2">
                                    <h3 className="text-lg font-bold text-stone-900 mb-2 flex items-center gap-2">
                                        <Clock className="w-5 h-5 text-stone-600" /> Storno okna
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-4">Kdy dochází ke zrušení rezervace před termínem.</p>
                                    
                                    <div className="h-48 w-full flex items-center">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie data={stats.cancellationLeadTimeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                                                    {stats.cancellationLeadTimeData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                                <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                    {/* SECTION 3: UTILIZATION (Heatmap & Pies) */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                         <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                            <h3 className="text-lg font-bold text-stone-900 mb-6 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-indigo-600" /> Vytíženost v čase (Peak Hours)
                            </h3>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={stats.peakHoursData}>
                                        <defs>
                                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                        <Area type="monotone" dataKey="count" stroke="#6366f1" fillOpacity={1} fill="url(#colorCount)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center">
                            <h3 className="text-lg font-bold text-stone-900 mb-2 w-full text-left flex items-center gap-2">
                                <Layers className="w-5 h-5 text-stone-600" /> Preference Vybavení vs. Místností
                            </h3>
                            <div className="h-64 w-full flex gap-4">
                                <div className="flex-1">
                                    <p className="text-xs text-center font-bold text-stone-400 mb-2">VYBAVENÍ</p>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={stats.equipmentData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value">
                                                {stats.equipmentData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                                            </Pie>
                                            <Tooltip />
                                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-center font-bold text-stone-400 mb-2">MÍSTNOSTI</p>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={stats.roomData} cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value">
                                                {stats.roomData.map((entry, index) => <Cell key={index} fill={entry.color} />)}
                                            </Pie>
                                            <Tooltip />
                                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center justify-center py-12 mt-8">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">Správa Dat</h3>
                <p className="text-stone-500 mb-6 max-w-md text-center text-sm">Vynulováním nevratně odstraníte všechny rezervace, události a registrace z databáze.</p>
                <button onClick={() => { if (window.confirm('Opravdu chcete vynulovat veškerá data o rezervacích? Toto je nevratné.')) { useStore.getState().resetData(); } }} className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors font-medium">Vynulovat Všechna Data</button>
            </div>
            </div>
            )}

            {/* === SCHEDULE TAB === */}
            {activeTab === 'schedule' && (
                <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden animate-in slide-in-from-bottom-2 fade-in">
                    <div className="p-4 border-b border-stone-200 flex flex-col md:flex-row gap-4 justify-between items-center bg-stone-50">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                                <input 
                                    type="text" 
                                    placeholder="Hledat lektora nebo službu..." 
                                    className="pl-9 pr-4 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-64"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="flex bg-white rounded-lg border border-stone-300 p-1">
                                <button onClick={() => setScheduleFilter('all')} className={`px-3 py-1 rounded text-xs font-bold ${scheduleFilter === 'all' ? 'bg-indigo-100 text-indigo-700' : 'text-stone-500 hover:bg-stone-50'}`}>Vše</button>
                                <button onClick={() => setScheduleFilter('today')} className={`px-3 py-1 rounded text-xs font-bold ${scheduleFilter === 'today' ? 'bg-indigo-100 text-indigo-700' : 'text-stone-500 hover:bg-stone-50'}`}>Dnes</button>
                                <button onClick={() => setScheduleFilter('upcoming')} className={`px-3 py-1 rounded text-xs font-bold ${scheduleFilter === 'upcoming' ? 'bg-indigo-100 text-indigo-700' : 'text-stone-500 hover:bg-stone-50'}`}>Budoucí</button>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            {dueFutureBookings.length > 0 && (
                                <Button 
                                    onClick={handleProcessFuturePayments}
                                    disabled={isProcessingPayments}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                                >
                                    {isProcessingPayments ? 'Zpracovávám...' : `Odeslat výzvy k platbě (${dueFutureBookings.length})`}
                                </Button>
                            )}
                            <div className="text-xs font-medium text-stone-500">
                                Zobrazeno {filteredBookings.length} rezervací
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-stone-100 text-stone-500 uppercase text-xs font-bold">
                                <tr>
                                    <th className="px-6 py-4">ID</th>
                                    <th className="px-6 py-4">Termín</th>
                                    <th className="px-6 py-4">Lektor & Služba</th>
                                    <th className="px-6 py-4">Místnost</th>
                                    <th className="px-6 py-4">Status</th>
                                    <th className="px-6 py-4 text-right">Akce</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                                {filteredBookings.map(booking => {
                                    const isPast = parseLocalDate(booking.date) < new Date(new Date().setHours(0,0,0,0));
                                    const isCancelled = booking.status === 'cancelled';
                                    
                                    return (
                                        <tr key={booking.id} className={`hover:bg-stone-50 transition-colors ${isPast || isCancelled ? 'opacity-60 bg-stone-50' : ''}`}>
                                            <td className="px-6 py-4 font-mono text-xs text-stone-400">#{booking.id.slice(-4)}</td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-stone-900">{formatLocalDate(booking.date)}</div>
                                                <div className="text-stone-500">{booking.time} ({booking.durationMinutes} min)</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="font-bold text-stone-900">{booking.practitionerName || booking.bookedByName}</div>
                                                <div className="text-xs text-indigo-600 font-medium">{booking.serviceName}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${booking.room === 1 ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                                    {booking.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                {booking.status === 'confirmed' ? (
                                                    <span className="text-green-600 flex items-center gap-1 text-xs font-bold"><CheckCircle className="w-3 h-3" /> Potvrzeno</span>
                                                ) : (
                                                    <span className="text-red-400 flex items-center gap-1 text-xs font-bold"><XCircle className="w-3 h-3" /> Zrušeno</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {!isPast && !isCancelled && (
                                                    <Button 
                                                        size="sm" 
                                                        variant="outline" 
                                                        className="text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                                        onClick={() => setReschedulingBooking(booking)}
                                                    >
                                                        <Clock className="w-3 h-3 mr-1" /> Přeplánovat
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* === TEAM TAB === */}
            {activeTab === 'team' && (
                <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden animate-in slide-in-from-bottom-2 fade-in">
                    <div className="p-6 border-b border-stone-200 flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-stone-900">Správa Lektorů</h2>
                            <p className="text-stone-500 text-sm">Aktivace/deaktivace profilů a správa údajů.</p>
                        </div>
                        <Button onClick={handleOpenAddModal} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                            <Plus className="w-4 h-4" /> Přidat člena
                        </Button>
                    </div>
                    <div className="divide-y divide-stone-100">
                        {practitioners.filter(p => p.role !== Role.ADMIN).map(p => (
                            <div key={p.id} className={`p-6 flex items-center justify-between ${!p.isActive ? 'bg-stone-50 opacity-75' : ''}`}>
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full overflow-hidden border border-stone-200">
                                        <img src={p.imageUrl} alt={p.name} className={`w-full h-full object-cover ${!p.isActive ? 'grayscale' : ''}`} />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-stone-900 flex items-center gap-2">
                                            {p.name}
                                            {!p.isActive && <span className="text-[10px] bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded uppercase tracking-wide">Neaktivní</span>}
                                        </h3>
                                        <p className="text-sm text-stone-500">{p.title}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right text-xs text-stone-400 mr-4 hidden md:block">
                                        <div>{p.role}</div>
                                        <div>ID: {p.id}</div>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        size="sm"
                                        onClick={() => handleToggleActive(p)}
                                        className={p.isActive ? "hover:bg-red-50 hover:text-red-600 hover:border-red-200" : "hover:bg-green-50 hover:text-green-600 hover:border-green-200"}
                                    >
                                        {p.isActive ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                                        {p.isActive ? 'Skrýt profil' : 'Aktivovat'}
                                    </Button>
                                    <Button size="sm" variant="secondary" onClick={() => handleOpenEditModal(p)}>
                                        <Edit className="w-4 h-4 mr-1" /> Upravit
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* === EVENTS TAB === */}
            {activeTab === 'events' && (
                <div className="space-y-6 animate-in slide-in-from-bottom-2 fade-in">
                    <div className="flex justify-between items-center">
                        <h2 className="text-2xl font-bold text-stone-900 font-heading">Skupinové Události a Workshopy</h2>
                        <Button onClick={() => handleOpenEventModal()} className="flex items-center gap-2">
                            <Plus className="w-4 h-4" /> Nová Událost
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {groupEvents.map(event => {
                            const registeredCount = eventRegistrations.filter(r => r.eventId === event.id).length;
                            const isFull = registeredCount >= event.capacity;
                            const practitioner = practitioners.find(p => p.id === event.practitionerId);
                            const eventUrl = `${window.location.origin}/#/event/${event.id}`;

                            return (
                                <div key={event.id} className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                                    <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-lg text-indigo-900">{event.title}</h3>
                                            <p className="text-sm text-indigo-700">{practitioner?.name}</p>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-xs font-bold ${isFull ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                            {registeredCount} / {event.capacity}
                                        </div>
                                    </div>
                                    <div className="p-4 flex-grow space-y-3">
                                        <div className="flex items-center gap-2 text-sm text-stone-600">
                                            <Calendar className="w-4 h-4" /> {formatLocalDate(event.date)}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-stone-600">
                                            <Clock className="w-4 h-4" /> {event.startTime} - {event.endTime}
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-stone-600">
                                            <DollarSign className="w-4 h-4" /> {event.price} Kč
                                        </div>
                                        <p className="text-sm text-stone-500 line-clamp-2 mt-2">{event.description}</p>
                                    </div>
                                    <div className="p-4 border-t border-stone-100 bg-stone-50 flex justify-between items-center">
                                        <button 
                                            onClick={() => {
                                                navigator.clipboard.writeText(eventUrl);
                                                addToast('success', 'Zkopírováno', 'Odkaz na událost byl zkopírován do schránky.');
                                            }}
                                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1"
                                        >
                                            <Link className="w-4 h-4" /> Kopírovat odkaz
                                        </button>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={() => handleOpenEventModal(event)}>
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:border-red-200" onClick={() => handleDeleteEvent(event.id)}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => window.open(eventUrl, '_blank')}>
                                                Zobrazit
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {groupEvents.length === 0 && (
                            <div className="col-span-full text-center py-12 bg-white rounded-xl border border-stone-200 border-dashed">
                                <Megaphone className="w-12 h-12 text-stone-300 mx-auto mb-3" />
                                <h3 className="text-lg font-medium text-stone-900">Zatím žádné události</h3>
                                <p className="text-stone-500 mt-1 mb-4">Vytvořte první skupinovou událost nebo workshop.</p>
                                <Button onClick={() => handleOpenEventModal()}>Vytvořit událost</Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {/* === CALENDAR TAB === */}
            {activeTab === 'calendar' && (
                <div className="animate-in slide-in-from-bottom-2 fade-in">
                    <StudioSchedule 
                        currentUser={practitioners.find(p => p.role === Role.ADMIN) || practitioners[0]}
                        allBookings={allBookings}
                        groupEvents={groupEvents}
                        onBook={onBook}
                        onCancel={onCancel}
                        onLogout={onLogout}
                    />
                </div>
            )}

            {/* Event Modal */}
            {isEventModalOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95">
                        <div className="flex justify-between items-center p-6 border-b border-stone-100 sticky top-0 bg-white z-10">
                            <h2 className="text-2xl font-bold font-heading text-stone-900">{editingEventId ? 'Upravit Událost' : 'Nová Skupinová Událost'}</h2>
                            <button onClick={() => setIsEventModalOpen(false)} className="text-stone-400 hover:text-stone-600 p-2">
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        
                        <form onSubmit={handleEventSubmit} className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Název události *</label>
                                    <input 
                                        type="text" 
                                        required
                                        value={eventForm.title}
                                        onChange={e => setEventForm({...eventForm, title: e.target.value})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        placeholder="Např. Večerní meditace"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Popis</label>
                                    <textarea 
                                        value={eventForm.description}
                                        onChange={e => setEventForm({...eventForm, description: e.target.value})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none min-h-[100px]"
                                        placeholder="Popis události pro klienty..."
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Datum *</label>
                                    <input 
                                        type="date" 
                                        required
                                        value={eventForm.date}
                                        onChange={e => setEventForm({...eventForm, date: e.target.value})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-bold text-stone-700 mb-1">Od *</label>
                                        <input 
                                            type="time" 
                                            required
                                            value={eventForm.startTime}
                                            onChange={e => setEventForm({...eventForm, startTime: e.target.value})}
                                            className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-stone-700 mb-1">Do *</label>
                                        <input 
                                            type="time" 
                                            required
                                            value={eventForm.endTime}
                                            onChange={e => setEventForm({...eventForm, endTime: e.target.value})}
                                            className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Kapacita (počet osob) *</label>
                                    <input 
                                        type="number" 
                                        required
                                        min="1"
                                        value={eventForm.capacity}
                                        onChange={e => setEventForm({...eventForm, capacity: parseInt(e.target.value)})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Cena (Kč) *</label>
                                    <input 
                                        type="number" 
                                        required
                                        min="0"
                                        value={eventForm.price}
                                        onChange={e => setEventForm({...eventForm, price: parseInt(e.target.value)})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Lektor *</label>
                                    <select 
                                        required
                                        value={eventForm.practitionerId}
                                        onChange={e => setEventForm({...eventForm, practitionerId: e.target.value})}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    >
                                        <option value="">Vyberte lektora</option>
                                        {practitioners.filter(p => p.isActive).map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            <div className="pt-6 border-t border-stone-100 flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setIsEventModalOpen(false)}>Zrušit</Button>
                                <Button type="submit" className="flex items-center gap-2">
                                    <Save className="w-4 h-4" /> {editingEventId ? 'Uložit změny' : 'Vytvořit Událost'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reschedule Modal */}
            {reschedulingBooking && (
                <RescheduleModal 
                    booking={reschedulingBooking} 
                    onClose={() => setReschedulingBooking(null)} 
                    onConfirm={(date, time, reason) => {
                        onAdminReschedule(reschedulingBooking.id, date, time, reason);
                        setReschedulingBooking(null);
                    }} 
                />
            )}

            {/* Add/Edit Practitioner Modal */}
            {isPractitionerModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                        <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                {editingPractitionerId ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                                {editingPractitionerId ? 'Upravit člena týmu' : 'Přidat člena týmu'}
                            </h3>
                            <button onClick={() => setIsPractitionerModalOpen(false)} className="hover:bg-white/20 p-1 rounded-full"><X className="w-5 h-5" /></button>
                        </div>
                        
                        <form onSubmit={handlePractitionerSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-stone-700 mb-1">Jméno a Příjmení</label>
                                <input 
                                    type="text" 
                                    value={practitionerForm.name}
                                    onChange={e => setPractitionerForm({...practitionerForm, name: e.target.value})}
                                    className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white"
                                    placeholder="Např. Jana Novotná"
                                    required
                                />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Titul / Role</label>
                                    <input 
                                        type="text" 
                                        value={practitionerForm.title}
                                        onChange={e => setPractitionerForm({...practitionerForm, title: e.target.value})}
                                        className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white"
                                        placeholder="Masérka"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Kategorie</label>
                                    <select 
                                        value={practitionerForm.category}
                                        onChange={e => setPractitionerForm({...practitionerForm, category: e.target.value})}
                                        className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white"
                                    >
                                        <option value="Terapie 1-1">Terapie</option>
                                        <option value="Masáže">Masáže</option>
                                        <option value="Koučink">Koučink</option>
                                        <option value="Fyzio">Fyzio</option>
                                        <option value="Semináře">Jóga / Semináře</option>
                                        <option value="Pronájem prostor">Externista</option>
                                    </select>
                                </div>
                            </div>

                            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                <label className="block text-xs font-bold text-indigo-800 mb-1 flex items-center gap-1">
                                    <Lock className="w-3 h-3" /> PIN pro přihlášení
                                </label>
                                <input 
                                    type="text" 
                                    value={practitionerForm.pin}
                                    onChange={e => setPractitionerForm({...practitionerForm, pin: e.target.value})}
                                    className="w-full p-2 border border-indigo-200 rounded-lg text-sm bg-white font-mono text-center tracking-widest font-bold text-lg"
                                    placeholder="1234"
                                    maxLength={4}
                                    required
                                />
                                <p className="text-[10px] text-indigo-600 mt-2">
                                    * Tento PIN bude lektor používat pro vstup do svého profilu.
                                </p>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <Button type="button" variant="ghost" onClick={() => setIsPractitionerModalOpen(false)} className="flex-1">Zrušit</Button>
                                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white flex justify-center items-center gap-2">
                                    <Save className="w-4 h-4" /> {editingPractitionerId ? 'Uložit změny' : 'Vytvořit profil'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminDashboard;