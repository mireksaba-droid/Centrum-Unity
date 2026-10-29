import React, { useState, useMemo, useEffect } from 'react';
import { Booking, Practitioner, Service, Role, GroupEvent, EventRegistration, ReferralStats } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, Search, MoreHorizontal, Settings, ShieldAlert, Edit, Trash2, CheckCircle, XCircle, Clock, Filter, Eye, EyeOff, Activity, Layers, Bed, BoxSelect, AlertTriangle, Trophy, LogOut, Plus, X, Save, Lock, Megaphone, Link, ChevronDown, ChevronUp, ChevronRight, RefreshCw, Loader2, Smartphone, BarChart3, Globe, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import Button from '../components/Button';
import StudioSchedule from './StudioSchedule';
import RescheduleModal from '../components/RescheduleModal';
import { useToast } from '../contexts/ToastContext';
import { checkBookingCollision, timeToMinutes, calculateRentalPrice } from '../utils/scheduler';
import { BUFFER_SAME_USER, BUFFER_DIFF_USER, sortGroupEvents, sortPractitioners } from '../constants';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { useStore } from '../store/useStore';
import { isDemoMode } from '../services/firebase';
import { generatePaymentRequestEmail } from '../utils/emailTemplates';
import { isPreviewEnvironment } from '../utils/env';

// Testovací / ignorovaná jména – nezobrazují se ve statistikách, aktivitě ani seznamu objednávek.
// Normalizace = malá písmena + odstranění diakritiky + sjednocení mezer, ať to chytne i "MIREK SABA", "Mírek  Sába" apod.
const normalizeName = (s?: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const IGNORED_NAMES = ['Mirek Saba'].map(normalizeName);
const isIgnoredName = (name?: string) => IGNORED_NAMES.includes(normalizeName(name));

// Mapování jména lektora pro BI a přehledy (např. "mirek", "host", "externista" -> "Host / Externista")
const resolvePractitionerDisplayName = (b: { bookedByName?: string; bookedByUserId?: string }, practitionersList?: Practitioner[]): string => {
  const rawName = (b.bookedByName || '').trim();
  const normalized = normalizeName(rawName);

  if (normalized === 'mirek' || b.bookedByUserId === 'guest' || normalized === 'host' || normalized === 'externista' || normalized === 'host / externista') {
    return 'Host / Externista';
  }

  if (b.bookedByUserId) {
    const found = practitionersList?.find(p => p.id === b.bookedByUserId);
    if (found) return found.name;
  }

  return rawName || 'Neznámý';
};

interface AdminDashboardProps {
  allBookings: Booking[];
  practitioners: Practitioner[];
  groupEvents: GroupEvent[];
  eventRegistrations: EventRegistration[];
  updatePractitioner: (p: Practitioner) => void;
  onAddPractitioner: (p: Practitioner) => void;
  onAdminReschedule: (bookingId: string, newDate: string, newTime: string, reason?: string, newRoom?: 1 | 2, newEquipment?: 'table' | 'futon' | 'none') => Promise<void>;
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
    const [activeTab, setActiveTab] = useState<'calendar' | 'analytics' | 'reschedules' | 'schedule' | 'team' | 'events'>('calendar');
    const [searchQuery, setSearchQuery] = useState('');
    const [scheduleFilter, setScheduleFilter] = useState<'all' | 'today' | 'upcoming'>('all');
    const [masterCalUrl, setMasterCalUrl] = useState<string>('');
    const [masterCalLoading, setMasterCalLoading] = useState(false);
    const handleGetMasterCalendarUrl = async () => {
        setMasterCalLoading(true);
        try {
            const res = await fetch('/api/master-calendar-url', { headers: { 'Authorization': `Bearer ${useStore.getState().token}` } });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Nepodařilo se získat odkaz.');
            setMasterCalUrl(data.url);
        } catch (e: any) {
            addToast('error', 'Chyba', e.message || 'Nepodařilo se získat odkaz na kalendář.');
        } finally {
            setMasterCalLoading(false);
        }
    };
    const [expandedActivity, setExpandedActivity] = useState<Record<string, boolean>>({});
    const [expandedActivityRow, setExpandedActivityRow] = useState<Record<string, boolean>>({});
    
    // Reschedule Modal State
    const [reschedulingBooking, setReschedulingBooking] = useState<Booking | null>(null);
    const [show6DayWindowDetails, setShow6DayWindowDetails] = useState(false);

    // Referral Stats State (Příchody z centrumunity.cz)
    const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
    const [loadingReferrals, setLoadingReferrals] = useState(false);
    const [showReferralHistory, setShowReferralHistory] = useState(false);

    // Storno po měsících a lektorech
    const [stornoSelectedMonth, setStornoSelectedMonth] = useState<string>('current');
    const [expandedStornoLecturer, setExpandedStornoLecturer] = useState<string | null>(null);

    // === AUDIT A MONITORING PŘESUNŮ (RESCHEDULE AUDIT) ===
    const [rescheduleFilterType, setRescheduleFilterType] = useState<'all' | 'suspicious' | 'late' | 'sixDay' | 'safe' | 'active'>('all');
    const [reschedulePractitionerFilter, setReschedulePractitionerFilter] = useState<string>('all');
    const [rescheduleSearch, setRescheduleSearch] = useState<string>('');
    const [expandedRescheduleRows, setExpandedRescheduleRows] = useState<Record<string, boolean>>({});

    const toggleRescheduleRow = (id: string) => {
        setExpandedRescheduleRows(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const loadReferrals = async () => {
        setLoadingReferrals(true);
        try {
            const res = await fetch('/api/analytics/referrals');
            if (res.ok) {
                const data = await res.json();
                setReferralStats(data);
            }
        } catch (e) {
            console.warn('Chyba načítání referral statistik:', e);
        } finally {
            setLoadingReferrals(false);
        }
    };

    useEffect(() => {
        loadReferrals();
    }, [activeTab]);

    // Practitioner Modal State (Add/Edit)
    const [isPractitionerModalOpen, setIsPractitionerModalOpen] = useState(false);
    const [editingPractitionerId, setEditingPractitionerId] = useState<string | null>(null);
    
    // Form State
    const [practitionerForm, setPractitionerForm] = useState<{name: string, title: string, pin: string, email: string, role: Role, category: string, imageUrl: string}>({
        name: '',
        title: '',
        pin: '',
        email: '',
        role: Role.PRACTITIONER,
        category: 'Terapie 1-1',
        imageUrl: ''
    });

    // Nahrání fotky lektora: zmenšíme na čtvercový náhled 256px a uložíme jako base64 (přímo k lektorovi)
    const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            addToast('error', 'Chyba', 'Vyberte prosím obrázek (JPG/PNG).');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const size = 256;
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const scale = Math.max(size / img.width, size / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                setPractitionerForm(f => ({ ...f, imageUrl: dataUrl }));
            };
            img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    // Event Modal State
    const [isEventModalOpen, setIsEventModalOpen] = useState(false);
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [selectedParticipantsEventId, setSelectedParticipantsEventId] = useState<string | null>(null);
    const [isActionPending, setIsActionPending] = useState(false);
    const [confirmEventParallel, setConfirmEventParallel] = useState(false);
    const [eventForm, setEventForm] = useState<Partial<GroupEvent>>({
        title: '',
        description: '',
        date: '',
        startTime: '',
        endTime: '',
        capacity: 10,
        price: 350,
        practitionerId: '',
        ticketTypes: []
    });

    const eventCollisionInfo = useMemo(() => {
        if (!eventForm.date || !eventForm.startTime || !eventForm.endTime || !eventForm.practitionerId) return null;
        const duration = timeToMinutes(eventForm.endTime) - timeToMinutes(eventForm.startTime);
        if (isNaN(duration) || duration <= 0) return null;

        const combined = [
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
                    status: 'paid' as const,
                    paymentMethod: 'invoice' as const,
                    createdAt: ev.createdAt || new Date().toISOString()
                }))
        ];

        return checkBookingCollision({
            newDate: eventForm.date,
            newTime: eventForm.startTime,
            durationMinutes: duration,
            room: 2,
            userId: eventForm.practitionerId,
            allBookings: combined
        });
    }, [eventForm.date, eventForm.startTime, eventForm.endTime, eventForm.practitionerId, allBookings, groupEvents, editingEventId]);

    const handleOpenEventModal = (eventToEdit?: GroupEvent) => {
        setConfirmEventParallel(false);
        if (eventToEdit) {
            setEditingEventId(eventToEdit.id);
            setEventForm({ 
                ...eventToEdit,
                practitionerName: eventToEdit.practitionerName || '',
                ticketTypes: eventToEdit.ticketTypes || []
            });
        } else {
            setEditingEventId(null);
            setEventForm({
                title: '',
                description: '',
                date: '',
                startTime: '',
                endTime: '',
                capacity: 10,
                price: 350,
                practitionerId: 'guest',
                practitionerName: '',
                ticketTypes: []
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
                    status: 'paid' as const,
                    paymentMethod: 'invoice' as const,
                    createdAt: ev.createdAt || new Date().toISOString()
                }))
        ];

        const { hasCollision, reason, warning, conflictingBooking } = checkBookingCollision({
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
        // Měkké varování: lektor má ve stejný čas rezervaci v Malé místnosti
        if (warning && !confirmEventParallel) {
            addToast('error', 'Potvrďte souběžnou rezervaci', 'Pro pokračování zaškrtněte políčko beroucí na vědomí souběžnou rezervaci lektora.');
            return;
        }

        const selectedPractitioner = practitioners.find(p => p.id === eventForm.practitionerId);
        let practitionerName = eventForm.practitionerName?.trim();
        if (!practitionerName) {
            if (eventForm.practitionerId === 'guest') {
                practitionerName = 'Externí lektor';
            } else if (selectedPractitioner) {
                practitionerName = selectedPractitioner.name;
            } else if (eventForm.practitionerId === 'admin') {
                practitionerName = 'Eva';
            } else {
                practitionerName = 'Externí lektor';
            }
        }

        if (editingEventId) {
            const updatedEvent: GroupEvent = {
                ...(eventForm as GroupEvent),
                id: editingEventId,
                capacity: Number(eventForm.capacity) || 10,
                price: Number(eventForm.price) || 0,
                ticketTypes: eventForm.ticketTypes || [],
                practitionerName: practitionerName
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
                ticketTypes: eventForm.ticketTypes || [],
                practitionerId: eventForm.practitionerId!,
                practitionerName: practitionerName,
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
        // Vynecháme testovací/ignorovaná jména (např. "Mirek Saba"), ať nešpiní statistiky ani storna.
        const src = allBookings.filter(b => !isIgnoredName(b.bookedByName));
        const confirmedBookings = src.filter(b => ['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status));
        const cancelledBookings = src.filter(b => b.status === 'cancelled');

        // --- FINANČNÍ KBELÍKY (aby seděly s GoPay) ---
        const paidBookings = src.filter(b => ['paid', 'completed'].includes(b.status));        // reálně zaplaceno
        const pendingBookings = src.filter(b => ['awaiting_payment', 'deferred_payment'].includes(b.status)); // čeká na platbu
        const refundedBookings = src.filter(b => b.status === 'refunded');                     // vrácené peníze

        const realRevenue = paidBookings.reduce((sum, b) => sum + b.price, 0);       // peníze reálně v GoPay
        const pendingRevenue = pendingBookings.reduce((sum, b) => sum + b.price, 0); // ještě nezaplaceno (pipeline)
        const refundedRevenue = refundedBookings.reduce((sum, b) => sum + b.price, 0); // vráceno

        const totalRevenue = realRevenue; // hlavní číslo = reálná tržba
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

        // 5. Vývoj a výhled tržeb (od června 2026 po nejvzdálenější rezervaci v čase) – DVĚ křivky:
        //    'received'  = reálně přijaté peníze podle data platby (paidAt, fallback createdAt) MÍNUS vrácené (dle cancelledAt)
        //    'scheduled' = zaplacené/naplánované lekce podle data konání lekce (b.date)
        const today = new Date();
        
        // Dynamické určení časového horizontu:
        // Start: červen 2026 (zahájení provozu) nebo nejstarší rezervace
        // Konec: nejvzdálenější rezervace v systému, minimálně však 2 měsíce dopředu od dneška (srpen -> září, říjen...)
        let minBookingDate = new Date(2026, 5, 1); // 1. červen 2026
        let maxBookingDate = new Date(today.getFullYear(), today.getMonth() + 2, 1); // min. 2 měsíce dopředu (říjen 2026)

        allBookings.forEach(b => {
            if (b.date) {
                const bDate = parseLocalDate(b.date);
                if (bDate < minBookingDate && bDate.getFullYear() >= 2026) {
                    minBookingDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1);
                }
                if (bDate > maxBookingDate) {
                    maxBookingDate = new Date(bDate.getFullYear(), bDate.getMonth(), 1);
                }
            }
        });

        const startMonth = new Date(minBookingDate.getFullYear(), minBookingDate.getMonth(), 1);
        const endMonth = new Date(maxBookingDate.getFullYear(), maxBookingDate.getMonth(), 1);

        const trendMonths: Date[] = [];
        const iterMonth = new Date(startMonth);
        while (iterMonth <= endMonth) {
            trendMonths.push(new Date(iterMonth));
            iterMonth.setMonth(iterMonth.getMonth() + 1);
        }
        while (trendMonths.length < 5) {
            const last = trendMonths[trendMonths.length - 1];
            trendMonths.push(new Date(last.getFullYear(), last.getMonth() + 1, 1));
        }

        const inMonth = (d: Date | null, m: number, y: number) => !!d && d.getMonth() === m && d.getFullYear() === y;

        const revenueTrendData = trendMonths.map((monthDate) => {
            const m = monthDate.getMonth();
            const y = monthDate.getFullYear();

            // Přijaté peníze podle data platby
            const receivedIn = paidBookings.reduce((sum, b) => {
                const when = b.paidAt ? new Date(b.paidAt) : (b.createdAt ? new Date(b.createdAt) : null);
                return inMonth(when, m, y) ? sum + b.price : sum;
            }, 0);
            // Vrácené peníze podle data storna
            const refundedIn = refundedBookings.reduce((sum, b) => {
                const when = b.cancelledAt ? new Date(b.cancelledAt) : null;
                return inMonth(when, m, y) ? sum + b.price : sum;
            }, 0);
            // Naplánované lekce (zaplacené) podle data konání
            const scheduledIn = paidBookings.reduce((sum, b) => {
                return inMonth(parseLocalDate(b.date), m, y) ? sum + b.price : sum;
            }, 0);

            const name = monthDate.toLocaleDateString('cs-CZ', { month: 'long' });
            const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1);

            return {
                name: capitalizedName,
                received: receivedIn - refundedIn, // čistý příjem měsíce (po odečtení vrácených)
                scheduled: scheduledIn,
            };
        });

        // 6. KDO GENERUJE TRŽBY – jen reálně zaplacené
        const revenueByPractitioner: Record<string, number> = {};
        paidBookings.forEach(b => {
            const name = resolvePractitionerDisplayName(b, practitioners);
            revenueByPractitioner[name] = (revenueByPractitioner[name] || 0) + b.price;
        });
        const topPerformersData = Object.entries(revenueByPractitioner)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // 7. MÍRA STORNA – jen REÁLNÁ storna: rezervace, které BYLY zaplacené a pak zrušené/refundované.
        // Nedokončené / vypršelé platby (které se nikdy nepotvrdily) NEJSOU storno – jinak by se míra uměle nafoukla.
        const wasPaidThenCancelled = (b: Booking) =>
            b.status === 'refunded' ||
            (b.status === 'cancelled' && (
                !!b.paidAt ||
                ['cancelled_by_admin_paid', 'cancelled_by_guest_refunded', 'cancelled_by_practitioner', 'cancelled_by_admin'].includes(b.cancellationReason || '')
            ));
        const stornoBookings = src.filter(wasPaidThenCancelled);
        const totalCancelled = stornoBookings.length;                       // reálně stornované (zaplacené) rezervace
        const paidEverCount = paidBookings.length + stornoBookings.length;  // vše, co bylo někdy zaplaceno
        const cancellationRate = paidEverCount > 0 ? ((totalCancelled / paidEverCount) * 100).toFixed(1) : "0";

        // Lead time distribuce storen a přesunů termínů:
        // 1. < 24h (Krizové: méně než 24h před akcí, bez nároku na online refundaci)
        // 2. 24h – 7 dní / 168h (Rizikové 6denní okno: bezplatné storno/přesun, ale sál se na poslední chvíli obtížně zaplní)
        // 3. > 7 dní (Bezpečné: dostatečný předstih pro re-obsazení sálu)
        const leadTimes = { critical: 0, sixDayWindow: 0, safe: 0 };
        const leadTimeValues = { critical: 0, sixDayWindow: 0, safe: 0 };

        interface SixDayWindowItem {
            id: string;
            practitionerName: string;
            date: string;
            time: string;
            room: 1 | 2;
            price: number;
            type: 'cancellation' | 'reschedule';
            diffHours: number;
            daysAhead: number;
            reason?: string;
        }
        const sixDayWindowItems: SixDayWindowItem[] = [];

        stornoBookings.forEach(b => {
            if (!b.cancelledAt) return;
            const bookingDate = parseLocalDate(b.date, b.time);
            const cancelDate = new Date(b.cancelledAt);
            const diffHours = (bookingDate.getTime() - cancelDate.getTime()) / (1000 * 60 * 60);
            const price = b.price || 0;

            if (diffHours < 24) {
                leadTimes.critical++;
                leadTimeValues.critical += price;
            } else if (diffHours < 168) {
                leadTimes.sixDayWindow++;
                leadTimeValues.sixDayWindow += price;
                sixDayWindowItems.push({
                    id: b.id,
                    practitionerName: resolvePractitionerDisplayName(b, practitioners),
                    date: b.date,
                    time: b.time,
                    room: b.room,
                    price,
                    type: 'cancellation',
                    diffHours,
                    daysAhead: Math.round((diffHours / 24) * 10) / 10,
                    reason: b.cancellationReason
                });
            } else {
                leadTimes.safe++;
                leadTimeValues.safe += price;
            }
        });

        // Sledování přesunů termínů (Reschedules) v jednotlivých oknech
        const rescheduleLeadTimes = { critical: 0, sixDayWindow: 0, safe: 0 };
        const rescheduleLeadValues = { critical: 0, sixDayWindow: 0, safe: 0 };

        src.forEach(b => {
            const isRescheduled = !!b.rescheduledAt || (b.note && b.note.includes('ADMIN RESCHEDULE'));
            if (!isRescheduled) return;

            const originalDateStr = b.originalDate || b.date;
            const originalTimeStr = b.originalTime || b.time;
            const originalDateTime = parseLocalDate(originalDateStr, originalTimeStr);
            const rescheduleTimestamp = b.rescheduledAt 
                ? new Date(b.rescheduledAt) 
                : (b as any).updatedAt 
                    ? new Date((b as any).updatedAt) 
                    : null;
            if (!rescheduleTimestamp) return;

            const diffHours = (originalDateTime.getTime() - rescheduleTimestamp.getTime()) / (1000 * 60 * 60);
            const price = b.price || 0;

            if (diffHours < 24) {
                rescheduleLeadTimes.critical++;
                rescheduleLeadValues.critical += price;
            } else if (diffHours < 168) {
                rescheduleLeadTimes.sixDayWindow++;
                rescheduleLeadValues.sixDayWindow += price;
                sixDayWindowItems.push({
                    id: b.id,
                    practitionerName: resolvePractitionerDisplayName(b, practitioners),
                    date: originalDateStr,
                    time: originalTimeStr,
                    room: b.room,
                    price,
                    type: 'reschedule',
                    diffHours,
                    daysAhead: Math.round((diffHours / 24) * 10) / 10,
                    reason: b.rescheduleReason || (b.note ? b.note.replace(/^.*ADMIN RESCHEDULE:\s*/s, '') : undefined)
                });
            } else {
                rescheduleLeadTimes.safe++;
                rescheduleLeadValues.safe += price;
            }
        });

        // Seřadíme události v 6denním okně chronologicky podle předstihu (od nejkritičtějších)
        sixDayWindowItems.sort((a, b) => a.diffHours - b.diffHours);

        const cancellationLeadTimeData = [
            { name: '< 24h (Krizové)', value: leadTimes.critical, price: leadTimeValues.critical, color: '#ef4444' },
            { name: '24h–7d (Rizikové 6denní okno)', value: leadTimes.sixDayWindow, price: leadTimeValues.sixDayWindow, color: '#f59e0b' },
            { name: '> 7 dní (Bezpečné)', value: leadTimes.safe, price: leadTimeValues.safe, color: '#10b981' },
        ];

        const sixDayWindowMetrics = {
            cancellationsCount: leadTimes.sixDayWindow,
            cancellationsValue: leadTimeValues.sixDayWindow,
            reschedulesCount: rescheduleLeadTimes.sixDayWindow,
            reschedulesValue: rescheduleLeadValues.sixDayWindow,
            totalChangesCount: leadTimes.sixDayWindow + rescheduleLeadTimes.sixDayWindow,
            totalChangesValue: leadTimeValues.sixDayWindow + rescheduleLeadValues.sixDayWindow,
            items: sixDayWindowItems
        };

        // 8. NAPLNĚNOST MÍSTNOSTÍ (% využití) po měsících (od června po budoucí měsíce).
        // Jmenovatel = provozní doba (08:00–24:00 = 16 h) × počet dní v měsíci.
        // Celková obsazenost započítává čisté hodiny rezervací + povinné sanitární pauzy na úklid/střídání.
        const OPERATING_HOURS_PER_DAY = 16;
        const daysInMonth = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();

        const calculateRoomHoursInMonth = (room: 1 | 2, mm: number, yy: number) => {
            const roomBookings = confirmedBookings.filter(b => {
                if (b.room !== room) return false;
                return inMonth(parseLocalDate(b.date), mm, yy);
            });

            let pureMinutes = 0;
            let cleaningMinutes = 0;

            const byDate: Record<string, Booking[]> = {};
            roomBookings.forEach(b => {
                (byDate[b.date] ||= []).push(b);
            });

            Object.values(byDate).forEach(dayBookings => {
                dayBookings.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
                dayBookings.forEach((b, idx) => {
                    pureMinutes += (b.durationMinutes || 60);

                    const nextBooking = dayBookings[idx + 1];
                    if (nextBooking) {
                        const isSameUser = (nextBooking.bookedByUserId && b.bookedByUserId && nextBooking.bookedByUserId === b.bookedByUserId);
                        cleaningMinutes += isSameUser ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
                    } else {
                        cleaningMinutes += BUFFER_DIFF_USER;
                    }
                });
            });

            return {
                pureHours: pureMinutes / 60,
                cleaningHours: cleaningMinutes / 60,
                totalHours: (pureMinutes + cleaningMinutes) / 60,
            };
        };

        const occupancyTrend = trendMonths.map((monthDate) => {
            const mm = monthDate.getMonth();
            const yy = monthDate.getFullYear();
            const avail = OPERATING_HOURS_PER_DAY * daysInMonth(yy, mm);
            const nm = monthDate.toLocaleDateString('cs-CZ', { month: 'short' });
            const isCurrent = monthDate.getMonth() === today.getMonth() && monthDate.getFullYear() === today.getFullYear();

            const m1Data = calculateRoomHoursInMonth(1, mm, yy);
            const m2Data = calculateRoomHoursInMonth(2, mm, yy);

            const m1Total = avail > 0 ? Math.round((m1Data.totalHours / avail) * 100) : 0;
            const m1Pure = avail > 0 ? Math.round((m1Data.pureHours / avail) * 100) : 0;
            const m1Clean = Math.max(0, m1Total - m1Pure);

            const m2Total = avail > 0 ? Math.round((m2Data.totalHours / avail) * 100) : 0;
            const m2Pure = avail > 0 ? Math.round((m2Data.pureHours / avail) * 100) : 0;
            const m2Clean = Math.max(0, m2Total - m2Pure);

            return {
                name: nm.charAt(0).toUpperCase() + nm.slice(1),
                M1: m1Total,
                M2: m2Total,
                M1_pure: m1Pure,
                M1_clean: m1Clean,
                M2_pure: m2Pure,
                M2_clean: m2Clean,
                isCurrent,
            };
        });
        const currentOccupancy = occupancyTrend.find(o => o.isCurrent) || occupancyTrend[occupancyTrend.length - 1] || { 
            M1: 0, M2: 0, M1_pure: 0, M1_clean: 0, M2_pure: 0, M2_clean: 0, name: '' 
        };

        // --- ZREALIZOVANÉ / PROBĚHLÉ REZERVACE ---
        const now = new Date();
        const pastPaidBookings = paidBookings.filter(b => {
            try {
                const bookingDateTime = parseLocalDate(b.date, b.time);
                return bookingDateTime <= now;
            } catch (e) {
                return parseLocalDate(b.date) <= now;
            }
        });

        // Pomocná funkce pro identifikaci rezervací Evy (admin)
        const isEvaBooking = (b: Booking) => {
            const uid = (b.bookedByUserId || '').toLowerCase();
            const name = (b.bookedByName || '').trim().toLowerCase();
            return uid === 'admin' || uid === 'eva' || name === 'eva' || name.startsWith('eva ') || name === 'eva guryčová';
        };

        const realizedBookingsCount = pastPaidBookings.length;
        const realizedBookingsValue = pastPaidBookings.reduce((sum, b) => {
            const isEva = isEvaBooking(b);
            return sum + (isEva ? 0 : (b.price || 0));
        }, 0);

        // Hodnota pronajatých místností pro Evu vypočtená dle standardního ceníku
        const evaPastBookings = pastPaidBookings.filter(isEvaBooking);
        const evaSavedCount = evaPastBookings.length;
        const evaSavedValue = evaPastBookings.reduce((sum, b) => {
            const standardPrice = calculateRentalPrice('guest', b.durationMinutes || 60, (b.room || 1) as 1 | 2);
            return sum + standardPrice;
        }, 0);

        // Celková hodnota všech potvrzených rezervací Evy (včetně budoucích)
        const evaAllConfirmedBookings = confirmedBookings.filter(isEvaBooking);
        const evaAllSavedValue = evaAllConfirmedBookings.reduce((sum, b) => {
            const standardPrice = calculateRentalPrice('guest', b.durationMinutes || 60, (b.room || 1) as 1 | 2);
            return sum + standardPrice;
        }, 0);

        // 9. KDO DĚLÁ NEJVÍC STOREN – rozpad dle měsíců i celkově, s počtem a FINANČNÍ HODNOTOU v Kč.
        interface StornoPractitionerDetail {
            name: string;
            stornoCount: number;
            stornoValue: number;
            paidCount: number;
            paidValue: number;
            totalCount: number;
            rate: number;
            bookings: Array<{
                id: string;
                date: string;
                time: string;
                room: 1 | 2;
                price: number;
                reason?: string;
                cancelledAt?: string;
            }>;
        }

        interface MonthlyStornoReport {
            key: string;
            label: string;
            isCurrent: boolean;
            totalStornoCount: number;
            totalStornoValue: number;
            practitioners: StornoPractitionerDetail[];
        }

        const computeStornoReportForFilter = (key: string, label: string, isCurrent: boolean, filterFn: (b: Booking) => boolean): MonthlyStornoReport => {
            const pMap: Record<string, {
                paidCount: number;
                paidValue: number;
                stornoCount: number;
                stornoValue: number;
                bookings: any[];
            }> = {};

            paidBookings.filter(filterFn).forEach(b => {
                const n = resolvePractitionerDisplayName(b, practitioners);
                const rec = (pMap[n] ||= { paidCount: 0, paidValue: 0, stornoCount: 0, stornoValue: 0, bookings: [] });
                rec.paidCount++;
                rec.paidValue += (b.price || 0);
            });

            stornoBookings.filter(filterFn).forEach(b => {
                const n = resolvePractitionerDisplayName(b, practitioners);
                const rec = (pMap[n] ||= { paidCount: 0, paidValue: 0, stornoCount: 0, stornoValue: 0, bookings: [] });
                rec.stornoCount++;
                rec.stornoValue += (b.price || 0);
                rec.bookings.push({
                    id: b.id,
                    date: b.date,
                    time: b.time,
                    room: b.room,
                    price: b.price || 0,
                    reason: b.cancellationReason,
                    cancelledAt: b.cancelledAt
                });
            });

            let totalStornoCount = 0;
            let totalStornoValue = 0;

            const practitionersList: StornoPractitionerDetail[] = Object.entries(pMap)
                .map(([name, v]) => {
                    totalStornoCount += v.stornoCount;
                    totalStornoValue += v.stornoValue;
                    const total = v.paidCount + v.stornoCount;
                    const rate = total > 0 ? Math.round((v.stornoCount / total) * 100) : 0;
                    v.bookings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                    return {
                        name,
                        stornoCount: v.stornoCount,
                        stornoValue: v.stornoValue,
                        paidCount: v.paidCount,
                        paidValue: v.paidValue,
                        totalCount: total,
                        rate,
                        bookings: v.bookings
                    };
                })
                .filter(x => x.stornoCount > 0)
                .sort((a, b) => (b.stornoValue - a.stornoValue) || (b.stornoCount - a.stornoCount) || (b.rate - a.rate));

            return {
                key,
                label,
                isCurrent,
                totalStornoCount,
                totalStornoValue,
                practitioners: practitionersList
            };
        };

        const monthlyStornoReports: MonthlyStornoReport[] = [];

        // Jednotlivé měsíce
        const sortedTrendMonths = [...trendMonths].sort((a, b) => b.getTime() - a.getTime());
        sortedTrendMonths.forEach(mDate => {
            const mm = mDate.getMonth();
            const yy = mDate.getFullYear();
            const isCurrent = mm === today.getMonth() && yy === today.getFullYear();
            const nm = mDate.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
            const capName = nm.charAt(0).toUpperCase() + nm.slice(1);
            const key = `${yy}-${String(mm + 1).padStart(2, '0')}`;
            monthlyStornoReports.push(
                computeStornoReportForFilter(key, isCurrent ? `${capName} (Tento měsíc)` : capName, isCurrent, b => inMonth(parseLocalDate(b.date), mm, yy))
            );
        });

        // Celé období
        const allTimeStornoReport = computeStornoReportForFilter('all', 'Celé období (Vše)', false, () => true);
        monthlyStornoReports.unshift(allTimeStornoReport);

        const cancellationsByPractitioner = allTimeStornoReport.practitioners.map(p => ({
            name: p.name,
            storno: p.stornoCount,
            stornoValue: p.stornoValue,
            total: p.totalCount,
            rate: p.rate
        }));

        // 10. MĚSÍČNÍ PŘEHLED: REZERVACE V HODNOTĚ XYZ VS. ZREALIZOVÁNO XYZ
        // Pro každý měsíc spočítáme:
        // - totalValue: celková hodnota rezervací v daném měsíci (potvrzené/zaplacené rezervace)
        // - realizedValue: hodnota zrealizovaných (již proběhlých a zaplacených/dokončených) lekcí v daném měsíci
        // - pendingValue: zbývající hodnota lekcí k realizaci (budoucí lekce v daném měsíci)
        const monthlyRealizationData = trendMonths.map((monthDate) => {
            const mm = monthDate.getMonth();
            const yy = monthDate.getFullYear();

            const bookingsInMonth = confirmedBookings.filter(b => inMonth(parseLocalDate(b.date), mm, yy));
            const totalValue = bookingsInMonth.reduce((sum, b) => sum + (b.price || 0), 0);
            const totalCount = bookingsInMonth.length;

            const realizedInMonth = bookingsInMonth.filter(b => {
                if (!['paid', 'completed'].includes(b.status)) return false;
                try {
                    const bDateTime = parseLocalDate(b.date, b.time);
                    return bDateTime <= now;
                } catch {
                    return parseLocalDate(b.date) <= now;
                }
            });

            const realizedValue = realizedInMonth.reduce((sum, b) => sum + (b.price || 0), 0);
            const realizedCount = realizedInMonth.length;
            const pendingValue = Math.max(0, totalValue - realizedValue);
            const pendingCount = Math.max(0, totalCount - realizedCount);

            const monthName = monthDate.toLocaleDateString('cs-CZ', { month: 'long' });
            const capitalizedName = monthName.charAt(0).toUpperCase() + monthName.slice(1);
            const isCurrent = mm === today.getMonth() && yy === today.getFullYear();

            return {
                name: capitalizedName,
                monthKey: `${yy}-${String(mm + 1).padStart(2, '0')}`,
                isCurrent,
                totalValue,              // Rezervace v hodnotě (Kč)
                realizedValue,           // Zrealizováno (Kč)
                pendingValue,            // Zbývá zrealizovat (Kč)
                totalCount,              // Počet rezervací celkem
                realizedCount,           // Počet zrealizovaných
                pendingCount,            // Počet zbývajících
                realizationRate: totalValue > 0 ? Math.round((realizedValue / totalValue) * 100) : 0
            };
        });

        const currentMonthRealization = monthlyRealizationData.find(m => m.isCurrent) || monthlyRealizationData[0] || {
            name: 'Aktuální měsíc',
            totalValue: 0,
            realizedValue: 0,
            pendingValue: 0,
            totalCount: 0,
            realizedCount: 0,
            realizationRate: 0
        };

        return {
            totalRevenue,
            realRevenue,
            pendingRevenue,
            refundedRevenue,
            totalBookings,
            chartData,
            peakHoursData,
            equipmentData,
            roomData,
            revenueTrendData,
            topPerformersData,
            cancellationLeadTimeData,
            sixDayWindowMetrics,
            cancellationRate,
            totalCancelled,
            paidEverCount,
            occupancyTrend,
            currentOccupancy,
            cancellationsByPractitioner,
            realizedBookingsCount,
            realizedBookingsValue,
            evaSavedValue,
            evaSavedCount,
            evaAllSavedValue,
            evaAllConfirmedCount: evaAllConfirmedBookings.length,
            monthlyRealizationData,
            currentMonthRealization,
            monthlyStornoReports
        };
    }, [allBookings, practitioners]);

    const selectedStornoReport = useMemo(() => {
        if (!stats.monthlyStornoReports || stats.monthlyStornoReports.length === 0) return null;
        if (stornoSelectedMonth === 'current') {
            return stats.monthlyStornoReports.find(r => r.isCurrent) || stats.monthlyStornoReports[0];
        }
        return stats.monthlyStornoReports.find(r => r.key === stornoSelectedMonth) || stats.monthlyStornoReports[0];
    }, [stats.monthlyStornoReports, stornoSelectedMonth]);

    const sortedPractitionersForFilter = useMemo(() => {
        return sortPractitioners(practitioners);
    }, [practitioners]);

    const formatCzechDate = (dateStr?: string) => {
        if (!dateStr) return '—';
        const parts = dateStr.split('-');
        if (parts.length === 3) return `${parseInt(parts[2], 10)}. ${parseInt(parts[1], 10)}. ${parts[0]}`;
        return dateStr;
    };

    const formatCzechDateTime = (isoStr?: string) => {
        if (!isoStr) return '—';
        try {
            const d = new Date(isoStr);
            if (isNaN(d.getTime())) return isoStr;
            return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return isoStr;
        }
    };

    const rescheduleAuditData = useMemo(() => {
        const rawRescheduled = allBookings.filter(b => {
            if (isIgnoredName(b.bookedByName)) return false;
            return !!b.rescheduledAt || 
                (b.rescheduleCount && b.rescheduleCount > 0) || 
                (b.note && (b.note.includes('RESCHEDULE') || b.note.includes('PŘESUN')));
        });

        const items = rawRescheduled.map(b => {
            const originalDateStr = b.originalDate || b.date;
            const originalTimeStr = b.originalTime || b.time;
            const originalDateTime = parseLocalDate(originalDateStr, originalTimeStr);
            const newDateTime = parseLocalDate(b.date, b.time);

            const rescheduleTimestamp = b.rescheduledAt 
                ? new Date(b.rescheduledAt) 
                : (b as any).updatedAt 
                    ? new Date((b as any).updatedAt) 
                    : null;

            // Předstih v hodinách mezi okamžikem provedení přesunu a původním začátkem
            const leadHours = rescheduleTimestamp 
                ? (originalDateTime.getTime() - rescheduleTimestamp.getTime()) / (1000 * 60 * 60)
                : null;

            // O kolik dní byl termín posunut (kladné = do budoucna)
            const daysShifted = Math.round((newDateTime.getTime() - originalDateTime.getTime()) / (1000 * 60 * 60 * 24));

            // Zda byla rezervace následně po přesunu stornována / refundována
            const isCancelled = b.status === 'cancelled' || b.status === 'refunded';

            const isLate = leadHours !== null && leadHours < 24 && leadHours >= 0;
            const isRetroactive = leadHours !== null && leadHours < 0;
            const isSixDay = leadHours !== null && leadHours >= 24 && leadHours < 168;
            const isSafe = leadHours !== null && leadHours >= 168;

            const isSuspicious = isCancelled;

            const practitionerDisplayName = resolvePractitionerDisplayName(b, practitioners);

            return {
                booking: b,
                id: b.id,
                practitionerName: practitionerDisplayName,
                practitionerId: b.bookedByUserId,
                originalDateStr,
                originalTimeStr,
                originalDateTime,
                newDateStr: b.date,
                newTimeStr: b.time,
                newDateTime,
                room: b.room,
                price: b.price || 0,
                status: b.status,
                rescheduledAt: b.rescheduledAt,
                rescheduleTimestamp,
                rescheduledBy: b.rescheduledBy || (b.note?.includes('LEKTOR') ? 'practitioner' : 'admin'),
                rescheduleCount: b.rescheduleCount || 1,
                rescheduleReason: b.rescheduleReason || (b.note?.match(/RESCHEDULE: (.*)/)?.[1]),
                leadHours,
                daysShifted,
                isCancelled,
                isLate,
                isRetroactive,
                isSixDay,
                isSafe,
                isSuspicious,
                cancelledAt: b.cancelledAt,
                cancellationReason: b.cancellationReason,
                refundAmount: b.refundAmount,
                cancellationFee: b.cancellationFee,
            };
        }).sort((a, b) => {
            const tA = a.rescheduleTimestamp ? a.rescheduleTimestamp.getTime() : 0;
            const tB = b.rescheduleTimestamp ? b.rescheduleTimestamp.getTime() : 0;
            return tB - tA;
        });

        const totalCount = items.length;
        const totalValue = items.reduce((sum, it) => sum + it.price, 0);
        const suspiciousCount = items.filter(it => it.isSuspicious).length;
        const suspiciousValue = items.filter(it => it.isSuspicious).reduce((sum, it) => sum + it.price, 0);
        const lateCount = items.filter(it => it.isLate || it.isRetroactive).length;
        const sixDayCount = items.filter(it => it.isSixDay).length;
        const safeCount = items.filter(it => it.isSafe).length;
        const activeCount = items.filter(it => !it.isCancelled).length;

        // Souhrn per lektor
        const practitionerStatsMap = new Map<string, {
            name: string;
            total: number;
            late: number;
            suspicious: number;
            totalValue: number;
        }>();

        items.forEach(it => {
            const key = it.practitionerName;
            if (!practitionerStatsMap.has(key)) {
                practitionerStatsMap.set(key, {
                    name: key,
                    total: 0,
                    late: 0,
                    suspicious: 0,
                    totalValue: 0
                });
            }
            const s = practitionerStatsMap.get(key)!;
            s.total += 1;
            if (it.isLate || it.isRetroactive) s.late += 1;
            if (it.isSuspicious) s.suspicious += 1;
            s.totalValue += it.price;
        });

        const practitionerSummary = Array.from(practitionerStatsMap.values()).sort((a, b) => b.total - a.total);

        return {
            items,
            totalCount,
            totalValue,
            suspiciousCount,
            suspiciousValue,
            lateCount,
            sixDayCount,
            safeCount,
            activeCount,
            practitionerSummary
        };
    }, [allBookings, practitioners]);

    const filteredRescheduleItems = useMemo(() => {
        let list = rescheduleAuditData.items;

        if (rescheduleFilterType === 'suspicious') {
            list = list.filter(it => it.isSuspicious);
        } else if (rescheduleFilterType === 'late') {
            list = list.filter(it => it.isLate || it.isRetroactive);
        } else if (rescheduleFilterType === 'sixDay') {
            list = list.filter(it => it.isSixDay);
        } else if (rescheduleFilterType === 'safe') {
            list = list.filter(it => it.isSafe);
        } else if (rescheduleFilterType === 'active') {
            list = list.filter(it => !it.isCancelled);
        }

        if (reschedulePractitionerFilter !== 'all') {
            list = list.filter(it => it.practitionerName === reschedulePractitionerFilter || it.practitionerId === reschedulePractitionerFilter);
        }

        if (rescheduleSearch.trim()) {
            const q = normalizeName(rescheduleSearch);
            list = list.filter(it => {
                return normalizeName(it.practitionerName).includes(q) ||
                    normalizeName(it.originalDateStr).includes(q) ||
                    normalizeName(it.newDateStr).includes(q) ||
                    normalizeName(it.rescheduleReason).includes(q) ||
                    normalizeName(it.booking.clientName).includes(q);
            });
        }

        return list;
    }, [rescheduleAuditData, rescheduleFilterType, reschedulePractitionerFilter, rescheduleSearch]);

    // Feed poslední aktivity: nové rezervace (dle createdAt) a zrušení (dle cancelledAt)
    // Poslední aktivita seskupená podle lektora – jeden řádek na rezervaci (ne na akci),
    // aby se admin vyznal, i když 20 lektorů nadělá spoustu rezervací a zrušení.
    const lastActivityAt = (b: Booking) => Math.max(
        b.createdAt ? new Date(b.createdAt).getTime() : 0,
        b.paymentRequestedAt ? new Date(b.paymentRequestedAt).getTime() : 0,
        b.reminderSentAt ? new Date(b.reminderSentAt).getTime() : 0,
        b.cancelledAt ? new Date(b.cancelledAt).getTime() : 0,
    );
    const activityByPractitioner = useMemo(() => {
        const groups: Record<string, { name: string; bookings: Booking[]; lastAt: number }> = {};
        allBookings.forEach(b => {
            if (isIgnoredName(b.bookedByName)) return; // skryjeme testovací jména
            if (!b.createdAt && !b.cancelledAt) return;
            const displayName = resolvePractitionerDisplayName(b, practitioners);
            const key = b.bookedByUserId === 'guest' || normalizeName(b.bookedByName) === 'mirek' ? 'guest' : (b.bookedByUserId || displayName || 'unknown');
            if (!groups[key]) groups[key] = { name: displayName, bookings: [], lastAt: 0 };
            groups[key].bookings.push(b);
            const t = lastActivityAt(b);
            if (t > groups[key].lastAt) groups[key].lastAt = t;
        });
        return Object.entries(groups).map(([key, g]) => ({
            key,
            name: g.name,
            lastAt: g.lastAt,
            bookings: g.bookings.sort((a, b) => lastActivityAt(b) - lastActivityAt(a)).slice(0, 25),
            counts: {
                total: g.bookings.length,
                cancelled: g.bookings.filter(x => x.status === 'cancelled' || x.status === 'refunded').length,
                awaiting: g.bookings.filter(x => x.status === 'awaiting_payment' || x.status === 'deferred_payment').length,
                paid: g.bookings.filter(x => x.status === 'paid').length,
            },
        })).sort((a, b) => b.lastAt - a.lastAt);
    }, [allBookings, practitioners]);

    const statusBadge = (status?: string): [string, string] => {
        const map: Record<string, [string, string]> = {
            paid: ['Zaplaceno', 'bg-emerald-100 text-emerald-700'],
            awaiting_payment: ['Čeká na platbu', 'bg-amber-100 text-amber-700'],
            deferred_payment: ['Čeká na platbu', 'bg-amber-100 text-amber-700'],
            payment_review: ['Ke kontrole', 'bg-red-100 text-red-700'],
            refunded: ['Refundováno', 'bg-sky-100 text-sky-700'],
            cancelled: ['Zrušeno', 'bg-stone-200 text-stone-500'],
            completed: ['Dokončeno', 'bg-stone-100 text-stone-600'],
            created: ['Nová', 'bg-stone-100 text-stone-600'],
        };
        return map[status as string] || [status || '', 'bg-stone-100 text-stone-500'];
    };
    const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    
    // Chronologicky seřazené skupinové události od nejbližších (prvních) po nejzazší (poslední)
    const sortedGroupEvents = useMemo(() => sortGroupEvents(groupEvents), [groupEvents]);

    // Čitelný důvod zrušení – aby admin poznal, PROČ termín padl (nezaplaceno vs. zrušeno člověkem vs. refundace)
    const cancelReasonInfo = (b: Booking): [string, string] | null => {
        if (b.status !== 'cancelled' && b.status !== 'refunded') return null;
        const map: Record<string, [string, string]> = {
            payment_expired: ['nezaplaceno včas', 'bg-amber-100 text-amber-700'],
            payment_cancelled: ['platba zrušena v bráně', 'bg-orange-100 text-orange-700'],
            payment_failed: ['platba selhala', 'bg-red-100 text-red-700'],
            cancelled_by_guest: ['zrušil klient', 'bg-stone-200 text-stone-600'],
            cancelled_by_guest_refunded: ['zrušil klient · vráceno', 'bg-sky-100 text-sky-700'],
            cancelled_by_practitioner: ['zrušil lektor', 'bg-stone-200 text-stone-600'],
            cancelled_by_admin: ['zrušil admin', 'bg-violet-100 text-violet-700'],
            cancelled_by_admin_paid: ['zrušil admin (bylo zaplaceno)', 'bg-violet-100 text-violet-700'],
            refunded: ['refundováno', 'bg-sky-100 text-sky-700'],
        };
        if (b.cancellationReason && map[b.cancellationReason]) return map[b.cancellationReason];
        if (b.status === 'refunded') return map.refunded;
        // Bez uloženého důvodu (starší rezervace) – odhad podle toho, zda byla platba
        return b.paymentId ? ['zrušeno (bylo zaplaceno)', 'bg-stone-200 text-stone-600'] : ['důvod neznámý', 'bg-stone-100 text-stone-400'];
    };
    const buildTimeline = (b: Booking): { label: string; at?: string; color: string }[] => {
        const ev: { label: string; at?: string; color: string }[] = [];
        if (b.createdAt) ev.push({ label: 'Vytvořeno', at: b.createdAt, color: 'bg-emerald-500' });
        if (b.paymentRequestedAt) ev.push({ label: 'Výzva k platbě', at: b.paymentRequestedAt, color: 'bg-indigo-500' });
        if (b.reminderSentAt) ev.push({ label: 'Připomínka', at: b.reminderSentAt, color: 'bg-amber-500' });
        if (b.status === 'paid' || b.status === 'completed') ev.push({ label: 'Zaplaceno', color: 'bg-emerald-600' });
        if (b.cancelledAt) ev.push({ label: b.status === 'refunded' ? 'Zrušeno + refundace' : 'Zrušeno', at: b.cancelledAt, color: 'bg-red-500' });
        return ev;
    };

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
            email: '',
            role: Role.PRACTITIONER,
            category: 'Terapie 1-1',
            imageUrl: ''
        });
        setIsPractitionerModalOpen(true);
    };

    const handleDeletePractitioner = async (p: Practitioner) => {
        if (p.id === 'admin' || p.id === 'guest') {
            addToast('error', 'Chyba', 'Profil administrátora a hosta nelze smazat.');
            return;
        }
        if (!window.confirm(`Opravdu trvale smazat lektora ${p.name}? Profil bude odstraněn z databáze i všech seznamů a akci nelze vzít zpět.`)) return;
        try {
            await useStore.getState().deletePractitioner(p.id);
            addToast('success', 'Smazáno', `Lektor ${p.name} byl trvale odstraněn.`);
        } catch (e: any) {
            addToast('error', 'Chyba', e.message || 'Smazání se nezdařilo.');
        }
    };

    const handleOpenEditModal = (p: Practitioner) => {
        setEditingPractitionerId(p.id);
        setPractitionerForm({
            name: p.name,
            title: p.title,
            pin: p.pin || '',
            email: p.email || '',
            role: p.role || Role.PRACTITIONER,
            category: p.category,
            imageUrl: p.imageUrl || ''
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
                    email: practitionerForm.email.trim(),
                    category: practitionerForm.category,
                    role: practitionerForm.role,
                    specialties: [practitionerForm.category],
                    imageUrl: practitionerForm.imageUrl || existing.imageUrl
                };
                updatePractitioner(updated);
                addToast('success', 'Uloženo', `Profil ${updated.name} byl upraven.`);
            }
        } else {
            // ADD NEW
            const id = practitionerForm.name.toLowerCase().replace(/ /g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const imageUrl = practitionerForm.imageUrl || `https://images.unsplash.com/photo-${Math.random() > 0.5 ? '1544005313-94ddf0286df2' : '1500648767791-00dcc994a43e'}?auto=format&fit=crop&q=80&w=400`;

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
                pin: practitionerForm.pin,
                email: practitionerForm.email.trim()
            };

            onAddPractitioner(newP);
            addToast('success', 'Lektor přidán', `Profil ${newP.name} byl úspěšně vytvořen.`);
        }

        setIsPractitionerModalOpen(false);
    };

    // --- SCHEDULE FILTERING ---
    const filteredBookings = allBookings.filter(b => {
        if (isIgnoredName(b.bookedByName)) return false; // skryjeme testovací jména
        const pName = resolvePractitionerDisplayName(b, practitioners);
        const sName = b.serviceName || '';
        const matchesSearch = pName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                              (b.bookedByName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
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
    const { updateBookingStatus, token } = useStore();
    const [isProcessingPayments, setIsProcessingPayments] = useState(false);

    const dueFutureBookings = useMemo(() => {
        const today = new Date();
        return allBookings.filter(b => {
            if (b.status !== 'deferred_payment') return false;
            const bDate = parseLocalDate(b.date);
            const daysToReservation = (bDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
            return daysToReservation <= 120;
        });
    }, [allBookings]);

    const handleProcessFuturePayments = async () => {
        setIsProcessingPayments(true);
        let count = 0;

        for (const booking of dueFutureBookings) {
            // Výzva k platbě jde klientovi; když nemá e-mail, alespoň lektorovi, který rezervoval
            const practitionerEmail = practitioners.find(p => p.id === booking.bookedByUserId)?.email;
            const targetEmail = booking.clientEmail || practitionerEmail;
            if (!targetEmail) continue; // nemáme kam poslat - přeskočíme

            // Note: Since we use HashRouter, the URL looks like /#/pay/ID
            const emailHtml = generatePaymentRequestEmail(booking, window.location.origin);

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

                await updateBookingStatus(booking.id, 'awaiting_payment'); // update status so it doesn't get processed again
                count++;
            } catch (error) {
                console.error("Failed to send payment email for booking", booking.id, error);
            }
        }

        setIsProcessingPayments(false);
        addToast('success', 'Výzvy odeslány', `Úspěšně odesláno ${count} výzev k platbě.`);
    };

    // --- MANUÁLNÍ REFUNDACE (GOPAY KÓD 330 / SELHÁNÍ AUTOMATICKÉHO VRÁCENÍ) ---
    const pendingManualRefunds = useMemo(() => {
        return allBookings.filter(b => b.manualRefundRequired && !b.manualRefundSettled);
    }, [allBookings]);

    const [settlingRefundId, setSettlingRefundId] = useState<string | null>(null);
    const handleSettleRefund = async (bookingId: string) => {
        setSettlingRefundId(bookingId);
        try {
            const res = await fetch('/api/admin/settle-refund', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ bookingId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Nepodařilo se potvrdit refundaci.');
            addToast('success', 'Refundace vyřízena', 'Manuální refundace byla úspěšně označena jako vyplacená.');
            useStore.setState((state) => ({
                bookings: state.bookings.map(b => b.id === bookingId ? { ...b, manualRefundSettled: true, manualRefundSettledAt: new Date().toISOString() } : b)
            }));
        } catch (err: any) {
            addToast('error', 'Chyba', err.message || 'Chyba při potvrzení refundace.');
        } finally {
            setSettlingRefundId(null);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-12">

            {/* Varování: aplikace neukládá data do databáze (demo/mock režim) */}
            {isDemoMode() && (
                <div className="bg-red-600 text-white p-4 rounded-xl shadow-lg flex items-start gap-3">
                    <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
                    <div>
                        <div className="font-bold">Pozor: data se neukládají do databáze!</div>
                        <div className="text-sm text-red-100 mt-1">
                            Aplikace běží v <strong>demo režimu</strong> – připojení k databázi (Firebase) selhalo.
                            Rezervace vytvořené teď zůstanou jen v tomto prohlížeči a po zavření nebo na jiném zařízení
                            zmizí. Zkontrolujte konfiguraci Firebase, než začnete zadávat reálné rezervace.
                        </div>
                    </div>
                </div>
            )}

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
                            <div className="text-2xl font-bold">{stats.realRevenue.toLocaleString()} Kč</div>
                            <div className="text-indigo-300 text-sm">Reálná tržba (GoPay)</div>
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
                    onClick={() => setActiveTab('reschedules')}
                    className={`px-6 py-3 font-medium text-sm flex items-center gap-2 rounded-t-lg transition-colors ${activeTab === 'reschedules' ? 'bg-white text-indigo-700 border-b-2 border-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                >
                    <RefreshCw className="w-4 h-4" /> Audit přesunů
                    {pendingManualRefunds.length > 0 ? (
                        <span className="px-1.5 py-0.5 text-xs font-bold bg-amber-500 text-white rounded-full flex items-center gap-0.5 animate-pulse">
                            ⚠️ {pendingManualRefunds.length} k vrácení
                        </span>
                    ) : rescheduleAuditData.suspiciousCount > 0 ? (
                        <span className="px-1.5 py-0.5 text-xs font-bold bg-red-100 text-red-700 rounded-full border border-red-200 flex items-center gap-0.5 animate-pulse">
                            🚨 {rescheduleAuditData.suspiciousCount}
                        </span>
                    ) : rescheduleAuditData.totalCount > 0 ? (
                        <span className="px-1.5 py-0.5 text-xs font-semibold bg-stone-100 text-stone-600 rounded-full">
                            {rescheduleAuditData.totalCount}
                        </span>
                    ) : null}
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

            {/* Upozornění na manuální refundace (GoPay kód 330) */}
            {pendingManualRefunds.length > 0 && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 shadow-sm space-y-3 animate-in fade-in">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <span className="p-2.5 bg-amber-500 text-white rounded-xl shadow-xs shrink-0">
                                <AlertTriangle className="w-5 h-5" />
                            </span>
                            <div>
                                <h3 className="text-base font-bold text-amber-950 font-heading">
                                    {pendingManualRefunds.length === 1 ? '1 rezervace vyžaduje manuální refundaci z banky' : `${pendingManualRefunds.length} rezervace vyžadují manuální refundaci z banky`}
                                </h3>
                                <p className="text-xs text-amber-900 mt-0.5">
                                    Automatické vrácení peněz na platební kartu přes GoPay selhalo (kód 330: nedostatek zůstatku na GoPay peněžence po denním bankovním převodu). Termín v sále byl uvolněn a lektorovi je třeba zaslat částku manuálně z bankovního účtu.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="divide-y divide-amber-200 bg-white rounded-xl border border-amber-200 overflow-hidden">
                        {pendingManualRefunds.map(b => (
                            <div key={b.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                <div>
                                    <div className="font-bold text-stone-900 text-sm flex items-center gap-2">
                                        <span>{resolvePractitionerDisplayName(b, practitioners)}</span>
                                        <span className="text-xs font-normal text-stone-500">#{b.id.slice(-6).toUpperCase()}</span>
                                    </div>
                                    <div className="text-stone-600 mt-0.5">
                                        Termín: <strong>{formatLocalDate(b.date)} v {b.time}</strong> (Místnost {b.room === 1 ? '1 - Malá' : '2 - Velká'})
                                    </div>
                                    <div className="text-amber-900 font-medium mt-1">
                                        Částka k vyplacení z banky: <strong className="text-sm font-extrabold text-red-600">{b.refundAmount ?? (b.price / 2)} Kč</strong>
                                        {b.cancellationFee ? ` · storno poplatek studia: ${b.cancellationFee} Kč` : ''}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    disabled={settlingRefundId === b.id}
                                    onClick={() => handleSettleRefund(b.id)}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs disabled:opacity-50 self-start sm:self-center shrink-0"
                                >
                                    {settlingRefundId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    Označit jako vráceno z banky
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            
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
                            {/* SECTION 0: POSLEDNÍ AKTIVITA – seskupeno podle lektora */}
                            <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                <h3 className="text-lg font-bold text-stone-900 mb-1 flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-indigo-600" /> Poslední aktivita
                                </h3>
                                <p className="text-xs text-stone-400 mb-4">Seskupeno podle lektora. Klikni na lektora pro rozbalení, na rezervaci pro časovou osu.</p>
                                {activityByPractitioner.length === 0 ? (
                                    <p className="text-sm text-stone-500">Zatím žádná aktivita.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {activityByPractitioner.map((grp) => {
                                            const open = !!expandedActivity[grp.key];
                                            return (
                                                <div key={grp.key} className="border border-stone-200 rounded-lg overflow-hidden">
                                                    {/* Hlavička lektora */}
                                                    <button
                                                        onClick={() => setExpandedActivity(s => ({ ...s, [grp.key]: !s[grp.key] }))}
                                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50 transition-colors text-left"
                                                    >
                                                        {open ? <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />}
                                                        <span className="font-semibold text-stone-800 flex-1 min-w-0 truncate">{grp.name}</span>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{grp.counts.total} rezervací</span>
                                                            {grp.counts.awaiting > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{grp.counts.awaiting} čeká</span>}
                                                            {grp.counts.cancelled > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">{grp.counts.cancelled} zrušených</span>}
                                                        </div>
                                                        <span className="text-xs text-stone-400 shrink-0 hidden sm:inline">{fmtDateTime(new Date(grp.lastAt).toISOString())}</span>
                                                    </button>
                                                    {/* Rezervace lektora */}
                                                    {open && (
                                                        <div className="divide-y divide-stone-100 border-t border-stone-200 bg-stone-50/50">
                                                            {grp.bookings.map((b) => {
                                                                const rowKey = grp.key + '_' + b.id;
                                                                const rowOpen = !!expandedActivityRow[rowKey];
                                                                const dateParts = (b.date || '').split('-');
                                                                const resDate = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.` : b.date;
                                                                const [label, cls] = statusBadge(b.status);
                                                                const timeline = buildTimeline(b);
                                                                const reason = cancelReasonInfo(b);
                                                                return (
                                                                    <div key={rowKey}>
                                                                        <button
                                                                            onClick={() => setExpandedActivityRow(s => ({ ...s, [rowKey]: !s[rowKey] }))}
                                                                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white transition-colors text-left"
                                                                        >
                                                                            <Clock className="w-3.5 h-3.5 text-stone-300 shrink-0" />
                                                                            <span className="text-sm text-stone-700 flex-1 min-w-0 truncate">
                                                                                {b.room === 1 ? 'M1' : 'M2'} · {resDate} {b.time}
                                                                                {b.clientName ? <span className="text-stone-500"> / {b.clientName}</span> : ''}
                                                                            </span>
                                                                            {reason && <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${reason[1]}`}>{reason[0]}</span>}
                                                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>
                                                                        </button>
                                                                        {/* Malá časová osa životního cyklu */}
                                                                        {rowOpen && (
                                                                            <div className="px-4 pb-3 pt-1 pl-11 space-y-1.5">
                                                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                                                                                    {timeline.map((ev, i) => (
                                                                                        <React.Fragment key={i}>
                                                                                            {i > 0 && <span className="text-stone-300">→</span>}
                                                                                            <span className="inline-flex items-center gap-1.5">
                                                                                                <span className={`w-2 h-2 rounded-full ${ev.color}`}></span>
                                                                                                <span className="text-xs text-stone-600">{ev.label}</span>
                                                                                                {ev.at && <span className="text-[10px] text-stone-400">{fmtDateTime(ev.at)}</span>}
                                                                                            </span>
                                                                                        </React.Fragment>
                                                                                    ))}
                                                                                </div>
                                                                                {reason && (
                                                                                    <div className="text-xs text-stone-500">
                                                                                        Důvod zrušení: <span className="font-semibold text-stone-700">{reason[0]}</span>
                                                                                    </div>
                                                                                )}
                                                                                {b.note && (
                                                                                    <div className="text-xs text-stone-500 whitespace-pre-line">
                                                                                        Poznámka: <span className="text-stone-700">{b.note}</span>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* SECTION 0.5: FINANČNÍ KBELÍKY (shoda s GoPay) */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-white p-5 rounded-xl border border-emerald-200 shadow-sm">
                                    <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold mb-1">
                                        <CheckCircle className="w-4 h-4" /> Reálná tržba
                                    </div>
                                    <div className="text-2xl font-bold text-stone-900">{stats.realRevenue.toLocaleString()} Kč</div>
                                    <div className="text-xs text-stone-400 mt-1">Zaplaceno − vráceno. Odpovídá penězům v GoPay.</div>
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-amber-200 shadow-sm">
                                    <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold mb-1">
                                        <Clock className="w-4 h-4" /> Čeká na platbu
                                    </div>
                                    <div className="text-2xl font-bold text-stone-900">{stats.pendingRevenue.toLocaleString()} Kč</div>
                                    <div className="text-xs text-stone-400 mt-1">Rezervace bez zaplacení (ještě ne cash).</div>
                                </div>
                                <div className="bg-white p-5 rounded-xl border border-sky-200 shadow-sm">
                                    <div className="flex items-center gap-2 text-sky-700 text-sm font-semibold mb-1">
                                        <XCircle className="w-4 h-4" /> Vráceno
                                    </div>
                                    <div className="text-2xl font-bold text-stone-900">{stats.refundedRevenue.toLocaleString()} Kč</div>
                                    <div className="text-xs text-stone-400 mt-1">Storna s refundací přes GoPay.</div>
                                </div>
                            </div>

                            {/* SECTION 0.5: PŘÍCHODY LEKTORŮ Z WEBU CENTRUMUNITY.CZ */}
                            <div className="bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white p-6 rounded-xl border border-indigo-200/80 shadow-sm space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-xs">
                                            <Globe className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                                Příchody lektorů z webu centrumunity.cz
                                            </h3>
                                            <p className="text-xs text-stone-500">
                                                Automaticky detekuje a počítá návštěvníky a lektory, kteří přišli z odkazu v patičce a menu na hlavní prezentaci.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={loadReferrals}
                                            disabled={loadingReferrals}
                                            className="p-1.5 text-stone-500 hover:text-indigo-600 hover:bg-white rounded-lg border border-stone-200 transition-colors"
                                            title="Aktualizovat statistiky"
                                        >
                                            <RefreshCw className={`w-4 h-4 ${loadingReferrals ? 'animate-spin' : ''}`} />
                                        </button>
                                        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                            Aktivní sledování příchodů
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                                    <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-xs">
                                        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Celkem příchodů</div>
                                        <div className="text-2xl font-bold text-indigo-950 mt-1">
                                            {referralStats ? referralStats.total : 0}
                                        </div>
                                        <div className="text-[10px] text-stone-400 mt-0.5">z webu centrumunity.cz</div>
                                    </div>

                                    <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                                        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Dnes</div>
                                        <div className="text-2xl font-bold text-emerald-600 mt-1">
                                            {referralStats ? referralStats.today : 0}
                                        </div>
                                        <div className="text-[10px] text-stone-400 mt-0.5">příchodů za dnešek</div>
                                    </div>

                                    <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                                        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Posledních 7 dní</div>
                                        <div className="text-2xl font-bold text-stone-900 mt-1">
                                            {referralStats ? referralStats.last7Days : 0}
                                        </div>
                                        <div className="text-[10px] text-stone-400 mt-0.5">za uplynulý týden</div>
                                    </div>

                                    <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                                        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Poslední příchod</div>
                                        <div className="text-sm font-bold text-stone-800 mt-2 truncate">
                                            {referralStats?.lastReferralAt 
                                                ? new Date(referralStats.lastReferralAt).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
                                                : 'Zatím žádný'}
                                        </div>
                                        <div className="text-[10px] text-stone-400 mt-0.5">datum a čas návštěvy</div>
                                    </div>
                                </div>

                                {referralStats && referralStats.recent && referralStats.recent.length > 0 && (
                                    <div className="pt-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowReferralHistory(!showReferralHistory)}
                                            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 transition-colors"
                                        >
                                            {showReferralHistory ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                            <span>
                                                {showReferralHistory ? 'Skrýt historii příchodů' : `Zobrazit historii posledních příchodů (${referralStats.recent.length})`}
                                            </span>
                                        </button>

                                        {showReferralHistory && (
                                            <div className="mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
                                                <table className="w-full text-left text-xs">
                                                    <thead className="bg-stone-50 text-stone-500 font-bold border-b border-stone-200">
                                                        <tr>
                                                            <th className="py-2 px-3">Datum a čas</th>
                                                            <th className="py-2 px-3">Zdroj</th>
                                                            <th className="py-2 px-3">Cílová stránka</th>
                                                            <th className="py-2 px-3">Původní odkaz (Referrer)</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-stone-100">
                                                        {referralStats.recent.map((log) => (
                                                            <tr key={log.id} className="hover:bg-stone-50">
                                                                <td className="py-2 px-3 font-semibold text-stone-800">
                                                                    {new Date(log.timestamp).toLocaleString('cs-CZ')}
                                                                </td>
                                                                <td className="py-2 px-3 text-indigo-600 font-bold">
                                                                    {log.source}
                                                                </td>
                                                                <td className="py-2 px-3 text-stone-600 font-mono text-[11px]">
                                                                    {log.path}
                                                                </td>
                                                                <td className="py-2 px-3 text-stone-400 text-[11px] truncate max-w-xs">
                                                                    {log.referrer || 'Přímý proklik'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* SECTION 0.6: ZREALIZOVANÉ A PROBĚHLÉ REZERVACE */}
                            <div className="bg-stone-50 p-6 rounded-xl border border-stone-200 shadow-sm space-y-4">
                                <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                    <Layers className="w-5 h-5 text-indigo-600" /> Zrealizované & Proběhlé Rezervace
                                </h3>
                                <p className="text-xs text-stone-500">
                                    Statistiky zkonzumovaných (proběhlých) a zaplacených rezervací v minulosti. Nezahrnuje budoucí neproběhlé rezervace ani stornované termíny.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                                        <div className="flex items-center gap-2 text-stone-700 text-sm font-semibold mb-1">
                                            <Calendar className="w-4 h-4 text-indigo-600" /> Počet zrealizovaných lekcí
                                        </div>
                                        <div className="text-2xl font-bold text-stone-900">{stats.realizedBookingsCount}</div>
                                        <div className="text-xs text-stone-400 mt-1">Uskutečněné zaplacené nebo dokončené rezervace v minulosti.</div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
                                        <div className="flex items-center gap-2 text-stone-700 text-sm font-semibold mb-1">
                                            <DollarSign className="w-4 h-4 text-emerald-600" /> Hodnota zrealizovaných lekcí
                                        </div>
                                        <div className="text-2xl font-bold text-emerald-700">{stats.realizedBookingsValue.toLocaleString()} Kč</div>
                                        <div className="text-xs text-stone-400 mt-1">Celková hodnota proběhlých rezervací (lekce lektorky Eva započteny za 0 Kč).</div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-indigo-100 shadow-sm">
                                        <div className="flex items-center gap-2 text-indigo-700 text-sm font-semibold mb-1">
                                            <Trophy className="w-4 h-4 text-amber-500" /> Úspora lektorky (Eva zdarma)
                                        </div>
                                        <div className="text-2xl font-bold text-indigo-700">{stats.evaSavedValue.toLocaleString()} Kč</div>
                                        <div className="text-xs text-stone-500 mt-1">
                                            Hodnota pronájmů pro Evu ({stats.evaSavedCount} proběhlých lekcí). Celkem vč. budoucích: <strong className="text-indigo-900 font-semibold">{stats.evaAllSavedValue.toLocaleString()} Kč</strong>.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 0.7: MĚSÍČNÍ OBJEM REZERVACÍ VS. ZREALIZOVÁNO */}
                            <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm space-y-6">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                            <BarChart3 className="w-5 h-5 text-indigo-600" /> Rezervace vs. Zrealizováno dle měsíců
                                        </h3>
                                        <p className="text-xs text-stone-500 mt-0.5">
                                            Porovnání celkové hodnoty rezervací na daný měsíc a hodnoty lekcí, které v daném měsíci již proběhly (zrealizováno).
                                        </p>
                                    </div>

                                    {stats.currentMonthRealization && (
                                        <div className="flex flex-wrap items-center gap-2 bg-indigo-50 border border-indigo-100 px-3.5 py-2 rounded-xl text-xs">
                                            <span className="font-bold text-indigo-900 uppercase tracking-wide">
                                                {stats.currentMonthRealization.name} {new Date().getFullYear()}:
                                            </span>
                                            <span className="text-stone-600">
                                                Rezervace <strong className="text-indigo-950 font-bold">{stats.currentMonthRealization.totalValue.toLocaleString()} Kč</strong>
                                            </span>
                                            <span className="text-stone-300">•</span>
                                            <span className="text-emerald-700">
                                                Zrealizováno <strong className="font-bold">{stats.currentMonthRealization.realizedValue.toLocaleString()} Kč</strong> ({stats.currentMonthRealization.realizationRate}%)
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Měsíční přehledové kartičky */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                    {stats.monthlyRealizationData.map((m) => (
                                        <div 
                                            key={m.monthKey} 
                                            className={`p-3.5 rounded-xl border transition-all ${
                                                m.isCurrent 
                                                    ? 'bg-gradient-to-b from-indigo-50/70 to-white border-indigo-300 shadow-sm ring-2 ring-indigo-500/20' 
                                                    : 'bg-stone-50/60 border-stone-200 hover:bg-white'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-1.5">
                                                <span className="text-xs font-bold text-stone-800">{m.name}</span>
                                                {m.isCurrent && (
                                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-600 text-white px-1.5 py-0.5 rounded">
                                                        Nyní
                                                    </span>
                                                )}
                                            </div>
                                            
                                            <div className="space-y-1">
                                                <div>
                                                    <div className="text-[10px] text-stone-400 font-medium">Rezervace celkem</div>
                                                    <div className="text-sm font-bold text-indigo-950">{m.totalValue.toLocaleString()} Kč</div>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] text-stone-400 font-medium">Zrealizováno</div>
                                                    <div className="text-sm font-bold text-emerald-600">{m.realizedValue.toLocaleString()} Kč</div>
                                                </div>
                                            </div>

                                            {/* Progress bar míry realizace */}
                                            <div className="mt-2.5 pt-2 border-t border-stone-200/60">
                                                <div className="flex justify-between text-[10px] text-stone-500 mb-1">
                                                    <span>Realizováno</span>
                                                    <span className="font-bold text-stone-700">{m.realizationRate}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
                                                    <div 
                                                        className="h-full bg-emerald-500 rounded-full transition-all duration-500" 
                                                        style={{ width: `${Math.min(100, m.realizationRate)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Graf: Rezervace vs. Zrealizováno */}
                                <div className="h-72 w-full pt-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={stats.monthlyRealizationData} 
                                            margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                            <XAxis 
                                                dataKey="name" 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} 
                                            />
                                            <YAxis 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tick={{ fontSize: 12, fill: '#64748b' }}
                                                tickFormatter={(val) => `${val.toLocaleString()} Kč`}
                                            />
                                            <Tooltip
                                                contentStyle={{ 
                                                    borderRadius: '12px', 
                                                    border: '1px solid #e2e8f0', 
                                                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                                                    padding: '12px 16px',
                                                    backgroundColor: '#ffffff'
                                                }}
                                                formatter={(value: any, name: any, item: any) => {
                                                    const isTotal = name === 'totalValue';
                                                    const count = isTotal ? item.payload.totalCount : item.payload.realizedCount;
                                                    const label = isTotal ? 'Rezervace v hodnotě' : 'Zrealizováno';
                                                    return [`${Number(value).toLocaleString()} Kč (${count} ${count === 1 ? 'lekce' : count >= 2 && count <= 4 ? 'lekce' : 'lekcí'})`, label];
                                                }}
                                                labelFormatter={(label: any) => `Měsíc: ${label}`}
                                            />
                                            <Legend 
                                                verticalAlign="top" 
                                                align="right" 
                                                wrapperStyle={{ paddingBottom: '12px' }}
                                                formatter={(value) => value === 'totalValue' ? 'Rezervace v hodnotě (Kč)' : 'Zrealizováno (Kč)'} 
                                            />
                                            <Bar 
                                                dataKey="totalValue" 
                                                name="totalValue" 
                                                fill="#4f46e5" 
                                                radius={[4, 4, 0, 0]} 
                                                maxBarSize={44}
                                            />
                                            <Bar 
                                                dataKey="realizedValue" 
                                                name="realizedValue" 
                                                fill="#10b981" 
                                                radius={[4, 4, 0, 0]} 
                                                maxBarSize={44}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* SECTION 1: FINANCIAL PERFORMANCE */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Revenue Trend */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-1 flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-indigo-600" /> Vývoj a výhled tržeb
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-6">Přijaté peníze (dle data platby, po odečtu storen) vs. naplánované lekce (dle data konání, i budoucí rezervace).</p>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <LineChart data={stats.revenueTrendData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <Tooltip
                                                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                                                    formatter={(value: any, name: any) => [`${Number(value).toLocaleString()} Kč`, name === 'received' ? 'Přijaté peníze' : 'Naplánované lekce']}
                                                />
                                                <Legend formatter={(value: any) => value === 'received' ? 'Přijaté peníze' : 'Naplánované lekce'} />
                                                <Line type="monotone" dataKey="received" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} />
                                                <Line type="monotone" dataKey="scheduled" stroke="#4f46e5" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Revenue Attribution (Top Performers) */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-2 flex items-center gap-2">
                                        <Trophy className="w-5 h-5 text-amber-500" /> Kdo generuje tržby
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-6">Kteří lektoři přinesli nejvyšší reálně zaplacenou tržbu.</p>
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
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* Cancellation Rate Card */}
                                    <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center justify-center text-center">
                                        <div className="p-3 bg-red-50 rounded-full mb-3">
                                            <AlertTriangle className="w-6 h-6 text-red-500" />
                                        </div>
                                        <h4 className="text-3xl font-bold text-stone-900">{stats.cancellationRate}%</h4>
                                        <p className="text-sm text-stone-500 font-medium">Míra storna zaplacených</p>
                                        <p className="text-xs text-stone-400 mt-1">{stats.totalCancelled} z {stats.paidEverCount} zaplacených rezervací zrušeno</p>
                                    </div>

                                    {/* Cancellation Lead Time (Donut) */}
                                    <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm md:col-span-2">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                                            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                                <Clock className="w-5 h-5 text-stone-600" /> Storno okna a předstih změn
                                            </h3>
                                            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 w-fit">
                                                6denní okno (24h–7d) = {stats.sixDayWindowMetrics.cancellationsCount} storen
                                            </span>
                                        </div>
                                        <p className="text-xs text-stone-500 mb-3">Rozdělení storen podle předstihu před začátkem rezervace.</p>
                                        
                                        <div className="h-48 w-full flex items-center">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <PieChart>
                                                    <Pie data={stats.cancellationLeadTimeData} cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value">
                                                        {stats.cancellationLeadTimeData.map((entry, index) => (
                                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                                        ))}
                                                    </Pie>
                                                    <Tooltip 
                                                        formatter={(value: any, name: any, item: any) => [
                                                            `${value}× rezervací (${((item?.payload?.price || 0)).toLocaleString()} Kč)`,
                                                            name
                                                        ]}
                                                    />
                                                    <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" />
                                                </PieChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>

                                {/* DEDICATED 6-DAY WINDOW ANALYTICS (24h až 7 dní před akcí) */}
                                <div className="bg-gradient-to-br from-amber-50/60 via-white to-orange-50/40 p-6 rounded-2xl border-2 border-amber-200/80 shadow-sm">
                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-amber-100">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="p-2 rounded-xl bg-amber-500 text-white shadow-sm">
                                                    <Clock className="w-5 h-5" />
                                                </span>
                                                <h3 className="text-lg font-bold text-stone-900">
                                                    Rizikové 6denní okno změn (24h až 7 dní před akcí)
                                                </h3>
                                            </div>
                                            <p className="text-xs text-stone-600 mt-1 max-w-2xl leading-relaxed">
                                                Období 6 dnů před 24h uzávěrkou: Klient/lektor má stále nárok na bezplatné zrušení či přesun (100% refundaci), 
                                                ale uvolněný sál 2–7 dní před začátkem se již velmi obtížně znovu obsazuje.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 shadow-xs">
                                                Kritická zóna pro storno poplatky
                                            </span>
                                        </div>
                                    </div>

                                    {/* 4 KPI Cards for the 6-Day Window */}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
                                        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs">
                                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Celkem změn v okně</div>
                                            <div className="text-2xl font-bold text-amber-700 mt-1">
                                                {stats.sixDayWindowMetrics.totalChangesCount}×
                                            </div>
                                            <div className="text-[11px] text-stone-400 mt-0.5">storna i přesuny dohromady</div>
                                        </div>

                                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1">
                                                <XCircle className="w-3.5 h-3.5 text-red-500" /> Zrušeno v okně
                                            </div>
                                            <div className="text-2xl font-bold text-stone-900 mt-1">
                                                {stats.sixDayWindowMetrics.cancellationsCount}×
                                            </div>
                                            <div className="text-[11px] text-stone-500 font-medium mt-0.5">
                                                {stats.sixDayWindowMetrics.cancellationsValue.toLocaleString()} Kč uvolněno
                                            </div>
                                        </div>

                                        <div 
                                            className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs cursor-pointer hover:border-indigo-400 hover:shadow-sm transition-all"
                                            onClick={() => setActiveTab('reschedules')}
                                            title="Klikněte pro zobrazení kompletního auditu přesunů"
                                        >
                                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center justify-between">
                                                <span className="flex items-center gap-1">
                                                    <RefreshCw className="w-3.5 h-3.5 text-indigo-500" /> Přesunuto v okně
                                                </span>
                                                <span className="text-[10px] text-indigo-600 font-bold hover:underline">Audit →</span>
                                            </div>
                                            <div className="text-2xl font-bold text-stone-900 mt-1">
                                                {stats.sixDayWindowMetrics.reschedulesCount}×
                                            </div>
                                            <div className="text-[11px] text-stone-500 font-medium mt-0.5">
                                                {stats.sixDayWindowMetrics.reschedulesValue.toLocaleString()} Kč v termínech
                                            </div>
                                        </div>

                                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Ohrožená tržba sálů</div>
                                            <div className="text-2xl font-bold text-red-600 mt-1">
                                                {stats.sixDayWindowMetrics.totalChangesValue.toLocaleString()} Kč
                                            </div>
                                            <div className="text-[11px] text-stone-400 mt-0.5">celková hodnota dotčených slotů</div>
                                        </div>
                                    </div>

                                    {/* Callout button to full Reschedule Audit */}
                                    <div className="mt-4 p-3 bg-white/90 rounded-xl border border-amber-200/90 flex items-center justify-between flex-wrap gap-2 text-xs">
                                        <div className="flex items-center gap-2 text-stone-700">
                                            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                                            <span>
                                                Chcete podrobně sledovat přeobjednání a odhalit případná storna po přesunu termínu?
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setActiveTab('reschedules')}
                                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs transition-colors flex items-center gap-1.5 shadow-xs"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" />
                                            Otevřít Audit a monitoring přesunů ({rescheduleAuditData.totalCount}×)
                                        </button>
                                    </div>

                                    {/* Expandable list of specific bookings */}
                                    <div className="mt-5 pt-4 border-t border-amber-200/70">
                                        <div className="flex items-center justify-between">
                                            <button
                                                type="button"
                                                onClick={() => setShow6DayWindowDetails(!show6DayWindowDetails)}
                                                className="flex items-center gap-2 text-xs font-bold text-stone-800 hover:text-amber-700 transition-colors"
                                            >
                                                {show6DayWindowDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                <span>
                                                    {show6DayWindowDetails ? 'Skrýt detail termínů' : `Zobrazit konkrétní termíny v 6denním okně (${stats.sixDayWindowMetrics.items.length})`}
                                                </span>
                                            </button>
                                            <span className="text-[11px] text-stone-500">
                                                Řazeno od nejkratšího předstihu (blíže k 24h uzávěrce)
                                            </span>
                                        </div>

                                        {show6DayWindowDetails && (
                                            <div className="mt-3 overflow-x-auto bg-white rounded-xl border border-stone-200">
                                                {stats.sixDayWindowMetrics.items.length === 0 ? (
                                                    <div className="p-6 text-center text-xs text-stone-500 font-medium">
                                                        V tomto 6denním rizikovém okně zatím nedošlo k žádnému zrušení ani přesunu termínu.
                                                    </div>
                                                ) : (
                                                    <table className="w-full text-left text-xs">
                                                        <thead className="bg-stone-50 text-stone-500 font-bold border-b border-stone-200">
                                                            <tr>
                                                                <th className="py-2.5 px-4">Typ změny</th>
                                                                <th className="py-2.5 px-4">Lektor</th>
                                                                <th className="py-2.5 px-4">Původní termín</th>
                                                                <th className="py-2.5 px-4">Místnost</th>
                                                                <th className="py-2.5 px-4">Předstih změny</th>
                                                                <th className="py-2.5 px-4 text-right">Hodnota</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-stone-100 font-medium">
                                                            {stats.sixDayWindowMetrics.items.map((item, idx) => (
                                                                <tr key={`${item.id}-${idx}`} className="hover:bg-amber-50/40 transition-colors">
                                                                    <td className="py-2.5 px-4">
                                                                        {item.type === 'cancellation' ? (
                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-700">
                                                                                <X className="w-3 h-3" /> Zrušeno
                                                                            </span>
                                                                        ) : (
                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-700">
                                                                                <RefreshCw className="w-3 h-3" /> Přesunuto
                                                                            </span>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-2.5 px-4 font-bold text-stone-900">{item.practitionerName}</td>
                                                                    <td className="py-2.5 px-4 text-stone-700">{formatLocalDate(item.date)} v {item.time}</td>
                                                                    <td className="py-2.5 px-4">
                                                                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${item.room === 1 ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                                                            {item.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="py-2.5 px-4">
                                                                        <span className="font-bold text-amber-800">
                                                                            {item.daysAhead} dne předem
                                                                        </span>
                                                                        <span className="text-stone-400 text-[10px] ml-1">
                                                                            ({Math.round(item.diffHours)} h)
                                                                        </span>
                                                                    </td>
                                                                    <td className="py-2.5 px-4 text-right font-bold text-stone-900">
                                                                        {item.price.toLocaleString()} Kč
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* SECTION 2.5: NAPLNĚNOST MÍSTNOSTÍ + STORNA LEKTORŮ */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Naplněnost místností */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <div className="flex items-start justify-between mb-1">
                                        <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                            <BoxSelect className="w-5 h-5 text-indigo-600" /> Naplněnost místností
                                        </h3>
                                        <span className="text-[11px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-100">
                                            Včetně sanitárních pauz
                                        </span>
                                    </div>
                                    <p className="text-xs text-stone-500 mb-3">% celkového blokovaného času z provozní doby (08–24 h = 16 h/den × dny v měsíci).</p>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                                        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-amber-900 uppercase tracking-wide">M1 (Malá)</span>
                                                <span className="text-[11px] text-stone-500">{stats.currentOccupancy.name}</span>
                                            </div>
                                            <div className="text-2xl font-black text-stone-900 mt-1">{stats.currentOccupancy.M1}%</div>
                                            <div className="mt-2 pt-2 border-t border-amber-200/60 flex flex-col gap-0.5 text-xs">
                                                <div className="flex justify-between text-stone-600">
                                                    <span>Čisté rezervace:</span>
                                                    <span className="font-bold text-stone-800">{stats.currentOccupancy.M1_pure}%</span>
                                                </div>
                                                <div className="flex justify-between text-amber-900">
                                                    <span>Sanitární pauzy:</span>
                                                    <span className="font-bold">{stats.currentOccupancy.M1_clean}%</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-stone-50 border border-stone-200 rounded-xl p-3.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-stone-800 uppercase tracking-wide">M2 (Velká)</span>
                                                <span className="text-[11px] text-stone-500">{stats.currentOccupancy.name}</span>
                                            </div>
                                            <div className="text-2xl font-black text-stone-900 mt-1">{stats.currentOccupancy.M2}%</div>
                                            <div className="mt-2 pt-2 border-t border-stone-200 flex flex-col gap-0.5 text-xs">
                                                <div className="flex justify-between text-stone-600">
                                                    <span>Čisté rezervace:</span>
                                                    <span className="font-bold text-stone-800">{stats.currentOccupancy.M2_pure}%</span>
                                                </div>
                                                <div className="flex justify-between text-stone-800">
                                                    <span>Sanitární pauzy:</span>
                                                    <span className="font-bold">{stats.currentOccupancy.M2_clean}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="bg-indigo-50/60 rounded-lg px-3 py-2 text-[11px] text-indigo-900 border border-indigo-100/80 mb-4 flex items-start gap-1.5">
                                        <span className="font-bold shrink-0">Poznámka:</span>
                                        <span>Sanitární pauzy (30 min stejný lektor / 60 min střídání) jsou započteny do celkové obsazenosti jako reálně blokovaný čas kapacity.</span>
                                    </div>

                                    <div className="h-52">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats.occupancyTrend}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} unit="%" domain={[0, 100]} />
                                                <Tooltip 
                                                    cursor={{fill: '#f1f5f9'}} 
                                                    contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} 
                                                    formatter={(v: any, n: any, item: any) => {
                                                        const p = item?.payload;
                                                        if (n === 'M1 (Malá)' && p) {
                                                            return [`${v}% (čisté: ${p.M1_pure}%, úklid: ${p.M1_clean}%)`, n];
                                                        }
                                                        if (n === 'M2 (Velká)' && p) {
                                                            return [`${v}% (čisté: ${p.M2_pure}%, úklid: ${p.M2_clean}%)`, n];
                                                        }
                                                        return [`${v} %`, n];
                                                    }} 
                                                />
                                                <Legend />
                                                <Bar name="M1 (Malá)" dataKey="M1" fill="#ba8a5b" radius={[4, 4, 0, 0]} />
                                                <Bar name="M2 (Velká)" dataKey="M2" fill="#7a573d" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Kdo dělá nejvíc storen – s měsíčním filtrem a hodnotou v Kč */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm space-y-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                                                <AlertTriangle className="w-5 h-5 text-red-500" /> Storna lektorů dle měsíců
                                            </h3>
                                            <p className="text-xs text-stone-500 mt-0.5">
                                                Přehled počtu a finanční hodnoty (v Kč) zrušených rezervací pro jednotlivé lektory.
                                            </p>
                                        </div>

                                        {/* Výběr měsíce */}
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={stornoSelectedMonth}
                                                onChange={(e) => {
                                                    setStornoSelectedMonth(e.target.value);
                                                    setExpandedStornoLecturer(null);
                                                }}
                                                className="bg-stone-50 border border-stone-300 text-stone-800 text-xs font-semibold rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                                            >
                                                {stats.monthlyStornoReports.map(rep => (
                                                    <option key={rep.key} value={rep.key}>
                                                        {rep.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Souhrnná lišta za vybraný měsíc */}
                                    {selectedStornoReport && (
                                        <div className="bg-red-50/70 border border-red-200/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-red-900 uppercase tracking-wide">
                                                    {selectedStornoReport.label}:
                                                </span>
                                                <span className="text-xs text-red-700">
                                                    Celkem stornováno <strong className="font-bold text-red-950">{selectedStornoReport.totalStornoValue.toLocaleString()} Kč</strong>
                                                </span>
                                                <span className="text-xs text-stone-300">•</span>
                                                <span className="text-xs text-stone-600">
                                                    {selectedStornoReport.totalStornoCount} zrušených lekcí
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-red-800 font-medium">
                                                {selectedStornoReport.practitioners.length} lektorů se stornem
                                            </div>
                                        </div>
                                    )}

                                    {/* Tabulka lektorů */}
                                    {!selectedStornoReport || selectedStornoReport.practitioners.length === 0 ? (
                                        <div className="text-center py-8 text-stone-400 text-sm">
                                            V tomto období nejsou evidována žádná storna. 🎉
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[11px] font-bold text-stone-400 uppercase tracking-wide pb-2 border-b border-stone-100">
                                                <span>Lektor</span>
                                                <span className="text-right">Hodnota storna</span>
                                                <span className="text-right">Počet</span>
                                                <span className="text-right">Míra</span>
                                            </div>

                                            <div className="divide-y divide-stone-100">
                                                {selectedStornoReport.practitioners.map((p) => {
                                                    const isExpanded = expandedStornoLecturer === p.name;
                                                    return (
                                                        <div key={p.name} className="py-2.5">
                                                            <div 
                                                                onClick={() => setExpandedStornoLecturer(isExpanded ? null : p.name)}
                                                                className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center cursor-pointer hover:bg-stone-50/80 p-1.5 -mx-1.5 rounded-lg transition-colors"
                                                            >
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <span className="text-stone-400 text-xs">
                                                                        {isExpanded ? '▾' : '▸'}
                                                                    </span>
                                                                    <span className="text-sm font-semibold text-stone-800 truncate">
                                                                        {p.name}
                                                                    </span>
                                                                </div>

                                                                <span className="text-sm font-bold text-red-600 text-right">
                                                                    {p.stornoValue.toLocaleString()} Kč
                                                                </span>

                                                                <span className="text-xs text-stone-600 text-right">
                                                                    {p.stornoCount}× <span className="text-stone-400">/ {p.totalCount}</span>
                                                                </span>

                                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full justify-self-end ${
                                                                    p.rate >= 30 ? 'bg-red-100 text-red-700' : p.rate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'
                                                                }`}>
                                                                    {p.rate}%
                                                                </span>
                                                            </div>

                                                            {/* Rozbalovací detail zrušených rezervací lektora */}
                                                            {isExpanded && p.bookings.length > 0 && (
                                                                <div className="mt-2 ml-5 p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1.5 text-xs">
                                                                    <div className="font-bold text-stone-700 mb-1">
                                                                        Konkrétní stornované termíny lektora ({p.bookings.length}):
                                                                    </div>
                                                                    {p.bookings.map((b: any, idx: number) => {
                                                                        const dateParts = (b.date || '').split('-');
                                                                        const dateFormatted = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : b.date;
                                                                        return (
                                                                            <div key={b.id || idx} className="flex items-center justify-between py-1 border-b border-stone-200/50 last:border-none">
                                                                                <span className="text-stone-700">
                                                                                    <strong>{dateFormatted}</strong> v {b.time} · {b.room === 1 ? 'M1 (Malá)' : 'M2 (Velká)'}
                                                                                </span>
                                                                                <span className="font-bold text-red-700">
                                                                                    {b.price.toLocaleString()} Kč
                                                                                </span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
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

            <div className="bg-white p-6 rounded-xl border border-emerald-200 shadow-sm flex flex-col items-center justify-center py-10 mt-8">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4">
                    <Users className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">Synchronizace lektorů</h3>
                <p className="text-stone-500 mb-6 max-w-md text-center text-sm">
                    Přepíše lektory v databázi aktuální konfigurací (PINy, e-maily, fotky, role).
                    Použij po úpravě seznamu lektorů, aby se změny projevily.
                </p>
                <button
                    onClick={async () => {
                        if (!window.confirm('Přepsat lektory v databázi aktuální konfigurací? Aktualizuje PINy, e-maily, fotky a role u všech lektorů.')) return;
                        try {
                            const res = await fetch('/api/admin/sync-practitioners', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${useStore.getState().token}` }
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || 'Synchronizace selhala.');
                            addToast('success', 'Hotovo', `Synchronizováno ${data.count} lektorů. Obnovuji stránku…`);
                            setTimeout(() => window.location.reload(), 1200);
                        } catch (e: any) {
                            addToast('error', 'Chyba', e.message || 'Synchronizace selhala.');
                        }
                    }}
                    className="bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700 transition-colors font-medium flex items-center gap-2"
                >
                    <Users className="w-4 h-4" /> Synchronizovat lektory z konfigurace
                </button>
            </div>

            <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm flex flex-col items-center justify-center py-12 mt-8">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
                    <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">Správa Dat</h3>
                <p className="text-stone-500 mb-6 max-w-md text-center text-sm">Vynulováním nevratně odstraníte všechny rezervace, události a registrace z databáze.</p>
                <button
                    onClick={() => {
                        // Dvojité potvrzení + nutnost napsat přesně SMAZAT, aby nešlo omylem
                        if (!window.confirm('Opravdu chcete NEVRATNĚ smazat všechny rezervace, události a registrace? Tuto akci nelze vzít zpět.')) return;
                        const typed = window.prompt('Pro potvrzení napište velkými písmeny: SMAZAT');
                        if (typed === null) return;
                        if (typed.trim() !== 'SMAZAT') {
                            addToast('info', 'Zrušeno', 'Text nesouhlasí, data nebyla smazána.');
                            return;
                        }
                        useStore.getState().resetData();
                    }}
                    className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                    Vynulovat Všechna Data
                </button>
            </div>
            </div>
            )}

            {/* === RESCHEDULE AUDIT & MONITORING TAB === */}
            {activeTab === 'reschedules' && (
                <div className="space-y-6 animate-in slide-in-from-bottom-2 fade-in">
                    {/* Header info banner */}
                    <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-950 text-white p-6 rounded-2xl shadow-md border border-indigo-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="bg-amber-400 text-stone-900 text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-xs">
                                    Monitoring & Ochrana studia
                                </span>
                                <span className="text-indigo-200 text-xs">
                                    Reálné sledování chování po zavedení 1× bezplatného přeobjednání
                                </span>
                            </div>
                            <h2 className="text-2xl font-bold font-heading flex items-center gap-2.5">
                                <RefreshCw className="w-6 h-6 text-amber-400" />
                                Audit a monitoring přesunů termínů
                            </h2>
                            <p className="text-indigo-200 text-xs mt-1.5 max-w-2xl leading-relaxed">
                                Kompletní přehled o všech přeobjednaných rezervacích, předstihu před původním termínem a automatická detekce 
                                podezřelých storen (např. posun do budoucna a následné storno pro získání 100% refundace).
                            </p>
                        </div>
                        <div className="flex md:flex-col items-center md:items-end justify-between gap-2 border-t md:border-t-0 md:border-l border-indigo-700/60 pt-3 md:pt-0 md:pl-6">
                            <div className="text-left md:text-right">
                                <div className="text-3xl font-extrabold text-amber-400 font-heading">
                                    {rescheduleAuditData.totalCount}×
                                </div>
                                <div className="text-xs text-indigo-200">
                                    Celkem přesunů v historii ({rescheduleAuditData.totalValue.toLocaleString()} Kč)
                                </div>
                            </div>
                            {rescheduleAuditData.suspiciousCount > 0 && (
                                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-200 border border-red-500/40 rounded-full text-xs font-bold animate-pulse">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                                    {rescheduleAuditData.suspiciousCount} {rescheduleAuditData.suspiciousCount === 1 ? 'storno' : 'storna'} po přesunu!
                                </div>
                            )}
                        </div>
                    </div>

                    {/* 5 KPI Metric Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
                                <RefreshCw className="w-3.5 h-3.5 text-indigo-600" /> Celkem přesunů
                            </div>
                            <div className="text-2xl font-bold text-stone-900 mt-1">
                                {rescheduleAuditData.totalCount}×
                            </div>
                            <div className="text-[11px] text-stone-500 font-medium mt-0.5">
                                {rescheduleAuditData.totalValue.toLocaleString()} Kč hodnota
                            </div>
                        </div>

                        <div className={`p-4 rounded-xl border shadow-xs ${rescheduleAuditData.suspiciousCount > 0 ? 'bg-red-50/70 border-red-300 ring-1 ring-red-300' : 'bg-white border-stone-200'}`}>
                            <div className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 text-red-700">
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> Zrušeno po přesunu
                            </div>
                            <div className="text-2xl font-bold text-red-700 mt-1">
                                {rescheduleAuditData.suspiciousCount}×
                            </div>
                            <div className="text-[11px] text-red-600 font-medium mt-0.5">
                                {rescheduleAuditData.suspiciousCount > 0 ? `${rescheduleAuditData.suspiciousValue.toLocaleString()} Kč podezřelých storen` : 'Žádné podezřelé storno'}
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-red-500" /> Pozdní přesun (&lt; 24h)
                            </div>
                            <div className="text-2xl font-bold text-red-600 mt-1">
                                {rescheduleAuditData.lateCount}×
                            </div>
                            <div className="text-[11px] text-stone-400 mt-0.5">
                                termín uvolněn na poslední chvíli
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs">
                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-amber-500" /> Okno 24h – 7 dní
                            </div>
                            <div className="text-2xl font-bold text-amber-700 mt-1">
                                {rescheduleAuditData.sixDayCount}×
                            </div>
                            <div className="text-[11px] text-stone-400 mt-0.5">
                                rizikovější na re-obsazení sálu
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs col-span-2 lg:col-span-1">
                            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1.5">
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Včasné (&gt; 7 dní)
                            </div>
                            <div className="text-2xl font-bold text-emerald-700 mt-1">
                                {rescheduleAuditData.safeCount}×
                            </div>
                            <div className="text-[11px] text-stone-400 mt-0.5">
                                bezpečný předstih pro studio
                            </div>
                        </div>
                    </div>

                    {/* Educational / Explanatory card for Eva */}
                    <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-xl text-xs text-amber-950 space-y-2">
                        <div className="font-bold flex items-center gap-1.5 text-amber-900 text-sm">
                            <ShieldAlert className="w-4 h-4 text-amber-700" />
                            Jak tento monitoring chrání Centrum Unity před zneužitím:
                        </div>
                        <p className="leading-relaxed">
                            <strong>Garance 1× bezplatného přesunu</strong> slouží lektorům pro případ, že klient náhle onemocní, aby rezervace nepropadla. 
                            <strong>Riziko zneužití:</strong> Kdyby lektor zjistil, že klient nemůže přijít a do začátku zbývá méně než 24 h (kdy by storno stálo 100 %), mohl by termín přesunout o měsíc dopředu a z nového termínu ho ihned zrušit se 100% vrácením peněz.
                        </p>
                        <p className="leading-relaxed">
                            <strong>Strategie:</strong> Nyní tento audit v reálném čase monitoruje každý přesun a označuje podezřelá storna červeným štítkem <strong>🚨 ZRUŠENO PO PŘESUNU</strong>. Na základě reálných dat vyhodnotíme, zda je nutné zavést automatické uzamčení storno poplatku k původnímu termínu.
                        </p>
                    </div>

                    {/* Practitioner Summary Table */}
                    {rescheduleAuditData.practitionerSummary.length > 0 && (
                        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-xs space-y-3">
                            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                                <Users className="w-4 h-4 text-indigo-600" />
                                Přehled využití přesunů podle lektorů
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {rescheduleAuditData.practitionerSummary.map(ps => (
                                    <div 
                                        key={ps.name}
                                        onClick={() => {
                                            setReschedulePractitionerFilter(reschedulePractitionerFilter === ps.name ? 'all' : ps.name);
                                        }}
                                        className={`p-3 rounded-xl border transition-all cursor-pointer ${
                                            reschedulePractitionerFilter === ps.name 
                                                ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-200' 
                                                : 'bg-stone-50/60 border-stone-200 hover:bg-stone-100/70'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-stone-900 text-xs truncate max-w-[150px]">
                                                {ps.name}
                                            </span>
                                            <span className="text-xs font-extrabold px-2 py-0.5 bg-white rounded-md border border-stone-200 text-indigo-700">
                                                {ps.total}×
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-2 text-[11px] text-stone-600">
                                            <span>Pozdní: <strong className={ps.late > 0 ? 'text-red-600' : 'text-stone-700'}>{ps.late}</strong></span>
                                            <span>Storna: <strong className={ps.suspicious > 0 ? 'text-red-700 bg-red-100 px-1 rounded' : 'text-stone-700'}>{ps.suspicious}</strong></span>
                                            <span className="ml-auto text-stone-500 font-medium">{ps.totalValue.toLocaleString()} Kč</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Filter toolbar & Search */}
                    <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                onClick={() => setRescheduleFilterType('all')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    rescheduleFilterType === 'all' 
                                        ? 'bg-indigo-600 text-white shadow-xs' 
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                Všechny ({rescheduleAuditData.totalCount})
                            </button>
                            <button
                                onClick={() => setRescheduleFilterType('suspicious')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${
                                    rescheduleFilterType === 'suspicious' 
                                        ? 'bg-red-600 text-white shadow-xs' 
                                        : rescheduleAuditData.suspiciousCount > 0 
                                            ? 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-200' 
                                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                🚨 Zrušeno po přesunu ({rescheduleAuditData.suspiciousCount})
                            </button>
                            <button
                                onClick={() => setRescheduleFilterType('late')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    rescheduleFilterType === 'late' 
                                        ? 'bg-red-600 text-white shadow-xs' 
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                🔴 Pozdní &lt; 24h ({rescheduleAuditData.lateCount})
                            </button>
                            <button
                                onClick={() => setRescheduleFilterType('sixDay')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    rescheduleFilterType === 'sixDay' 
                                        ? 'bg-amber-600 text-white shadow-xs' 
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                🟡 24h – 7 dní ({rescheduleAuditData.sixDayCount})
                            </button>
                            <button
                                onClick={() => setRescheduleFilterType('safe')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    rescheduleFilterType === 'safe' 
                                        ? 'bg-emerald-600 text-white shadow-xs' 
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                🟢 &gt; 7 dní ({rescheduleAuditData.safeCount})
                            </button>
                            <button
                                onClick={() => setRescheduleFilterType('active')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                                    rescheduleFilterType === 'active' 
                                        ? 'bg-stone-800 text-white shadow-xs' 
                                        : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                                }`}
                            >
                                Jen aktivní ({rescheduleAuditData.activeCount})
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Practitioner dropdown */}
                            <select
                                value={reschedulePractitionerFilter}
                                onChange={(e) => setReschedulePractitionerFilter(e.target.value)}
                                className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs bg-white text-stone-700 outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="all">Všichni lektoři</option>
                                {sortedPractitionersForFilter.map(p => (
                                    <option key={p.id} value={p.name}>{p.name}</option>
                                ))}
                            </select>

                            {/* Search box */}
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={rescheduleSearch}
                                    onChange={(e) => setRescheduleSearch(e.target.value)}
                                    placeholder="Hledat termín, lektora..."
                                    className="pl-8 pr-3 py-1.5 border border-stone-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500 w-44 sm:w-56"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Detailed Reschedule Audit Log Table */}
                    <div className="bg-white rounded-xl border border-stone-200 shadow-xs overflow-hidden">
                        {filteredRescheduleItems.length === 0 ? (
                            <div className="p-12 text-center">
                                <div className="w-12 h-12 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-3 text-stone-400">
                                    <RefreshCw className="w-6 h-6" />
                                </div>
                                <h4 className="text-base font-bold text-stone-800 mb-1">
                                    {rescheduleAuditData.totalCount === 0 ? 'Zatím neproběhl žádný přesun termínu' : 'Žádné záznamy neodpovídají zadanému filtru'}
                                </h4>
                                <p className="text-xs text-stone-500 max-w-md mx-auto">
                                    {rescheduleAuditData.totalCount === 0 
                                        ? 'Jakmile některý z lektorů nebo administrátor využije možnost přeobjednání na jiný termín, záznam a detailní audit se zobrazí zde.'
                                        : 'Zkuste změnit nastavení filtrů nebo vyhledávání.'}
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-stone-50 text-stone-600 font-bold border-b border-stone-200">
                                        <tr>
                                            <th className="py-3 px-4">Lektor</th>
                                            <th className="py-3 px-4">Původní termín ➔ Nový termín</th>
                                            <th className="py-3 px-4">Kdy & Kdo přesunul</th>
                                            <th className="py-3 px-4">Předstih v době přesunu</th>
                                            <th className="py-3 px-4">Stav po přesunu</th>
                                            <th className="py-3 px-4 text-right">Hodnota</th>
                                            <th className="py-3 px-4 text-center">Detail</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-stone-100">
                                        {filteredRescheduleItems.map((item) => {
                                            const isExpanded = !!expandedRescheduleRows[item.id];
                                            return (
                                                <React.Fragment key={item.id}>
                                                    <tr className={`hover:bg-stone-50/70 transition-colors ${item.isSuspicious ? 'bg-red-50/30' : ''}`}>
                                                        <td className="py-3 px-4">
                                                            <div className="font-bold text-stone-900">{item.practitionerName}</div>
                                                            <div className="text-[11px] text-stone-400">
                                                                Místnost {item.room === 1 ? 'M1 (Malá)' : 'M2 (Velká)'}
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-4">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="line-through text-stone-400 font-mono">
                                                                    {formatCzechDate(item.originalDateStr)} {item.originalTimeStr}
                                                                </span>
                                                                <span className="text-stone-400 font-bold">➔</span>
                                                                <span className="font-bold text-indigo-900 font-mono">
                                                                    {formatCzechDate(item.newDateStr)} {item.newTimeStr}
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-stone-500 mt-0.5">
                                                                {item.daysShifted === 0 ? 'Přesunuto v rámci stejného dne' : item.daysShifted > 0 ? `Posun o +${item.daysShifted} ${item.daysShifted === 1 ? 'den' : item.daysShifted < 5 ? 'dny' : 'dní'} dopředu` : `Posun o ${item.daysShifted} dní zpět`}
                                                            </div>
                                                        </td>

                                                        <td className="py-3 px-4">
                                                            <div className="font-medium text-stone-800">
                                                                {formatCzechDateTime(item.rescheduledAt)}
                                                            </div>
                                                            <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded mt-0.5 ${
                                                                item.rescheduledBy === 'practitioner' 
                                                                    ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                                                    : 'bg-sky-100 text-sky-700 border border-sky-200'
                                                            }`}>
                                                                {item.rescheduledBy === 'practitioner' ? 'Lektorem (1×)' : 'Administrátorem'}
                                                            </span>
                                                        </td>

                                                        <td className="py-3 px-4">
                                                            {item.leadHours === null ? (
                                                                <span className="text-stone-400">—</span>
                                                            ) : item.isRetroactive ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-stone-200 text-stone-700">
                                                                    Zpětně po začátku
                                                                </span>
                                                            ) : item.isLate ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700 border border-red-200">
                                                                    🔴 {Math.round(item.leadHours)} h předem (&lt; 24h)
                                                                </span>
                                                            ) : item.isSixDay ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                                                    🟡 {Math.round(item.leadHours / 24 * 10) / 10} dne předem
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                                    🟢 {Math.round(item.leadHours / 24)} dní předem
                                                                </span>
                                                            )}
                                                        </td>

                                                        <td className="py-3 px-4">
                                                            {item.isCancelled ? (
                                                                <div>
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white shadow-xs">
                                                                        🚨 ZRUŠENO PO PŘESUNU
                                                                    </span>
                                                                    <div className="text-[10px] text-red-600 mt-1 font-medium">
                                                                        Stornováno {formatCzechDateTime(item.cancelledAt)}
                                                                        {item.refundAmount !== undefined && ` · Vráceno ${item.refundAmount} Kč`}
                                                                    </div>
                                                                </div>
                                                            ) : item.status === 'paid' ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                                                    <CheckCircle className="w-3 h-3" /> Zaplaceno / Aktivní
                                                                </span>
                                                            ) : item.status === 'completed' ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-700">
                                                                    Proběhlo
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-sky-800">
                                                                    {item.status}
                                                                </span>
                                                            )}
                                                        </td>

                                                        <td className="py-3 px-4 text-right font-bold text-stone-900">
                                                            {item.price.toLocaleString()} Kč
                                                        </td>

                                                        <td className="py-3 px-4 text-center">
                                                            <button
                                                                onClick={() => toggleRescheduleRow(item.id)}
                                                                className="p-1 rounded hover:bg-stone-200 text-stone-500 hover:text-stone-800 transition-colors"
                                                                title="Rozbalit detail"
                                                            >
                                                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                            </button>
                                                        </td>
                                                    </tr>

                                                    {/* Expanded detail row */}
                                                    {isExpanded && (
                                                        <tr className="bg-stone-50/80">
                                                            <td colSpan={7} className="p-4 border-b border-stone-200 text-xs">
                                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                                    <div className="space-y-1">
                                                                        <div className="font-bold text-stone-700">Informace o rezervaci:</div>
                                                                        <div className="text-stone-600">ID: <code className="text-[11px] bg-white px-1 rounded border border-stone-200">{item.id}</code></div>
                                                                        <div className="text-stone-600">Služba: {item.booking.serviceName || 'Pronájem prostor'}</div>
                                                                        {item.booking.clientName && (
                                                                            <div className="text-stone-600">Klient: <strong>{item.booking.clientName}</strong> ({item.booking.clientEmail || 'bez e-mailu'})</div>
                                                                        )}
                                                                        <div className="text-stone-600">Platební metoda: {item.booking.paymentMethod || 'GoPay online'}</div>
                                                                    </div>

                                                                    <div className="space-y-1">
                                                                        <div className="font-bold text-stone-700">Důvod a poznámky k přesunu:</div>
                                                                        <div className="p-2 bg-white rounded border border-stone-200 text-stone-700 whitespace-pre-wrap text-[11px]">
                                                                            {item.rescheduleReason || item.booking.note || 'Nebyl uveden žádný specifický důvod.'}
                                                                        </div>
                                                                    </div>

                                                                    <div className="space-y-1">
                                                                        <div className="font-bold text-stone-700">Auditní vyhodnocení:</div>
                                                                        {item.isSuspicious ? (
                                                                            <div className="p-2 bg-red-100/70 border border-red-200 rounded text-red-900 text-[11px] leading-relaxed">
                                                                                <strong>🚨 Varování:</strong> Tato rezervace byla po předchozím přesunu stornována.
                                                                                {item.cancellationReason && <div>Důvod storna: {item.cancellationReason}</div>}
                                                                                {item.cancellationFee !== undefined && <div>Uplatněný storno poplatek: {item.cancellationFee} Kč</div>}
                                                                            </div>
                                                                        ) : item.isLate ? (
                                                                            <div className="p-2 bg-amber-50 border border-amber-200 rounded text-amber-900 text-[11px] leading-relaxed">
                                                                                <strong>⚠️ Pozdní přesun:</strong> Termín byl uvolněn méně než 24 h před začátkem. V původním termínu sál zůstal volný na poslední chvíli.
                                                                            </div>
                                                                        ) : (
                                                                            <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 text-[11px] leading-relaxed">
                                                                                <strong>✅ Standardní přesun:</strong> Přeobjednáno s dostatečným předstihem, bez následných storen.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
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
                                                <div className="font-bold text-stone-900">{resolvePractitionerDisplayName(booking, practitioners)}</div>
                                                <div className="text-xs text-indigo-600 font-medium">{booking.serviceName}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold w-fit ${booking.room === 1 ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                                        {booking.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1 text-[11px] text-stone-600 font-medium">
                                                        {booking.equipment === 'futon' ? (
                                                            <><Layers className="w-3 h-3 text-stone-500" /> Futon</>
                                                        ) : booking.equipment === 'none' ? (
                                                            <><X className="w-3 h-3 text-stone-400" /> Bez</>
                                                        ) : (
                                                            <><Bed className="w-3 h-3 text-indigo-500" /> Lehátko</>
                                                        )}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                {!['cancelled', 'refunded'].includes(booking.status) ? (
                                                    <span className="text-green-600 flex items-center gap-1 text-xs font-bold"><CheckCircle className="w-3 h-3" /> Potvrzeno</span>
                                                ) : (
                                                    <span className="text-red-400 flex items-center gap-1 text-xs font-bold"><XCircle className="w-3 h-3" /> Zrušeno</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {!isPast && !isCancelled && (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline" 
                                                            className="text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                                            onClick={() => setReschedulingBooking(booking)}
                                                        >
                                                            <Clock className="w-3 h-3 mr-1" /> Přesunout
                                                        </Button>
                                                        <Button 
                                                            size="sm" 
                                                            variant="outline" 
                                                            className="text-xs border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                                                            onClick={async () => {
                                                                const isSelf = booking.bookedByUserId === 'admin';
                                                                const confirmMsg = isSelf 
                                                                    ? `Opravdu chcete zrušit Vaši rezervaci z ${formatLocalDate(booking.date)} v ${booking.time}?` 
                                                                    : `Opravdu chcete zrušit rezervaci lektora (${resolvePractitionerDisplayName(booking, practitioners)}) z ${formatLocalDate(booking.date)} v ${booking.time}?`;
                                                                if (!window.confirm(confirmMsg)) return;
                                                                try {
                                                                    await onCancel(booking.id);
                                                                    addToast('success', 'Rezervace zrušena', 'Termín byl okamžitě uvolněn.');
                                                                } catch (err: any) {
                                                                    addToast('error', 'Chyba', err.message || 'Nepodařilo se zrušit rezervaci.');
                                                                }
                                                            }}
                                                        >
                                                            <X className="w-3 h-3 mr-1" /> Zrušit
                                                        </Button>
                                                    </div>
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
                                    {p.id !== 'admin' && p.id !== 'guest' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleDeletePractitioner(p)}
                                            className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                        >
                                            <Trash2 className="w-4 h-4 mr-1" /> Smazat
                                        </Button>
                                    )}
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
                        {sortedGroupEvents.map(event => {
                            const registeredCount = eventRegistrations.filter(r => r.eventId === event.id && r.paymentStatus !== 'cancelled').reduce((acc, curr) => acc + (curr.ticketTypeSpots || 1), 0);
                            const isFull = registeredCount >= event.capacity;
                            const practitioner = practitioners.find(p => p.id === event.practitionerId);
                            const practitionerDisplayName = event.practitionerName || (event.practitionerId === 'guest' ? 'Externí lektor' : (practitioner?.name || 'Nezadáno'));
                            const isPreview = isPreviewEnvironment();
                            const eventUrl = isPreview 
                                ? `${window.location.origin}/#/event/${event.id}` 
                                : `${window.location.origin}/event/${event.id}`;

                            return (
                                <div key={event.id} className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                                    <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-lg text-indigo-900">{event.title}</h3>
                                            <p className="text-sm text-indigo-700 font-medium">{practitionerDisplayName}</p>
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
                                            <Button 
                                                variant="outline" 
                                                size="sm" 
                                                className="text-indigo-600 border-indigo-200 hover:bg-indigo-50" 
                                                onClick={() => setSelectedParticipantsEventId(event.id)}
                                                title="Zobrazit přihlášené účastníky"
                                            >
                                                <Users className="w-4 h-4" /> <span className="hidden sm:inline ml-1 text-xs">Účastníci</span>
                                            </Button>
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
                        {sortedGroupEvents.length === 0 && (
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
                    {/* Master kalendář do telefonu (Apple / Google) */}
                    <div className="mb-4 bg-white border border-stone-200 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 text-sm text-stone-600">
                                <Smartphone className="w-4 h-4 text-indigo-600" />
                                <span>Chceš mít <strong>celý kalendář studia</strong> (obě místnosti, všichni lektoři) v telefonu?</span>
                            </div>
                            <button
                                onClick={handleGetMasterCalendarUrl}
                                disabled={masterCalLoading}
                                className="text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 text-sm font-bold border border-indigo-200 disabled:opacity-50"
                            >
                                {masterCalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />} Přidat do telefonu
                            </button>
                        </div>
                        {masterCalUrl && (
                            <div className="mt-3 bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm">
                                <p className="font-bold text-indigo-900 mb-1 flex items-center gap-2"><Calendar className="w-4 h-4" /> Napojení na kalendář (Google / Apple)</p>
                                <p className="text-indigo-800 mb-2 text-xs leading-relaxed">
                                    <strong>iPhone:</strong> klepni na „Přidat do Apple kalendáře" níže → potvrď odběr.<br/>
                                    <strong>Google:</strong> „+" → Přidat kalendář → Z adresy URL → vlož odkaz.<br/>
                                    <strong>Apple (Mac):</strong> Kalendář → Soubor → Nový odběr kalendáře → vlož odkaz.<br/>
                                    Všechny rezervace (M1 i M2) včetně skupinových akcí a workshopů se v kalendáři automaticky synchronizují.
                                </p>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <input
                                        readOnly
                                        value={masterCalUrl}
                                        onClick={(e) => (e.target as HTMLInputElement).select()}
                                        className="flex-1 min-w-[200px] p-2 border border-indigo-200 rounded-lg text-xs bg-white font-mono"
                                    />
                                    <a
                                        href={masterCalUrl.replace(/^https?:\/\//, 'webcal://')}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap"
                                    >
                                        Přidat do Apple kalendáře
                                    </a>
                                </div>
                                <p className="text-[11px] text-indigo-500 mt-2">Odkaz je tajný — kdo ho má, vidí obsazenost studia. Neposílej ho dál.</p>
                            </div>
                        )}
                    </div>
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
                                        onChange={e => {
                                            const val = e.target.value;
                                            const p = practitioners.find(item => item.id === val);
                                            setEventForm({
                                                ...eventForm,
                                                practitionerId: val,
                                                practitionerName: val === 'guest' ? (eventForm.practitionerName || 'Externí lektor') : (p?.name || '')
                                            });
                                        }}
                                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    >
                                        <option value="">Vyberte lektora</option>
                                        <option value="guest">✨ Externí lektor</option>
                                        {practitioners.filter(p => p.isActive && p.id !== 'guest').map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>

                                    {eventForm.practitionerId === 'guest' && (
                                        <div className="mt-3 bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-100 animate-in fade-in slide-in-from-top-1">
                                            <label className="block text-xs font-bold text-indigo-950 mb-1">
                                                Jméno externího lektora (volitelné)
                                            </label>
                                            <input 
                                                type="text" 
                                                placeholder="např. Katka, Jan Novák (pokud necháte prázdné, zobrazí se 'Externí lektor')"
                                                value={eventForm.practitionerName === 'Externí lektor' ? '' : (eventForm.practitionerName || '')}
                                                onChange={e => setEventForm({ ...eventForm, practitionerName: e.target.value })}
                                                className="w-full p-2.5 bg-white border border-indigo-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-stone-800"
                                            />
                                            <p className="text-[11px] text-indigo-700/80 mt-1">
                                                Zadané jméno se zobrazí v přehledu události na webu i v potvrzovacích e-mailech účastníkům.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="md:col-span-2 border-t border-stone-100 pt-6">
                                    <div className="flex justify-between items-center mb-4">
                                        <div>
                                            <h4 className="font-bold text-stone-900 text-sm">Varianty vstupenek (Volitelné)</h4>
                                            <p className="text-xs text-stone-500">Můžete přidat více variant cen a spotřeby míst pro tuto akci (např. Základní: 350 Kč, Rodič + dítě: 500 Kč / 2 místa).</p>
                                        </div>
                                        <Button 
                                            type="button" 
                                            variant="outline" 
                                            size="sm"
                                            className="text-xs"
                                            onClick={() => {
                                                const currentTypes = eventForm.ticketTypes || [];
                                                setEventForm({
                                                    ...eventForm,
                                                    ticketTypes: [
                                                        ...currentTypes,
                                                        { id: crypto.randomUUID(), name: '', price: 0, spots: 1 }
                                                    ]
                                                });
                                            }}
                                        >
                                            + Přidat variantu
                                        </Button>
                                    </div>

                                    {(eventForm.ticketTypes && eventForm.ticketTypes.length > 0) ? (
                                        <div className="space-y-3">
                                            {eventForm.ticketTypes.map((ticket, index) => (
                                                <div key={ticket.id} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
                                                    <div className="flex-grow">
                                                        <label className="block text-[10px] uppercase tracking-wider font-bold text-stone-500 mb-0.5">Název varianty *</label>
                                                        <input 
                                                            type="text"
                                                            required
                                                            placeholder="Např. Rodič + dítě"
                                                            value={ticket.name}
                                                            onChange={e => {
                                                                const copy = [...(eventForm.ticketTypes || [])];
                                                                copy[index].name = e.target.value;
                                                                setEventForm({ ...eventForm, ticketTypes: copy });
                                                            }}
                                                            className="w-full p-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="w-full sm:w-28">
                                                        <label className="block text-[10px] uppercase tracking-wider font-bold text-stone-500 mb-0.5">Cena (Kč) *</label>
                                                        <input 
                                                            type="number"
                                                            required
                                                            min="0"
                                                            placeholder="500"
                                                            value={ticket.price}
                                                            onChange={e => {
                                                                const copy = [...(eventForm.ticketTypes || [])];
                                                                copy[index].price = parseInt(e.target.value) || 0;
                                                                setEventForm({ ...eventForm, ticketTypes: copy });
                                                            }}
                                                            className="w-full p-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="w-full sm:w-28">
                                                        <label className="block text-[10px] uppercase tracking-wider font-bold text-stone-500 mb-0.5">Zabere míst *</label>
                                                        <input 
                                                            type="number"
                                                            required
                                                            min="1"
                                                            placeholder="1"
                                                            value={ticket.spots}
                                                            onChange={e => {
                                                                const copy = [...(eventForm.ticketTypes || [])];
                                                                copy[index].spots = parseInt(e.target.value) || 1;
                                                                setEventForm({ ...eventForm, ticketTypes: copy });
                                                            }}
                                                            className="w-full p-2 bg-white border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                                        />
                                                    </div>
                                                    <div className="flex justify-end">
                                                        <button 
                                                            type="button"
                                                            onClick={() => {
                                                                const copy = (eventForm.ticketTypes || []).filter(t => t.id !== ticket.id);
                                                                setEventForm({ ...eventForm, ticketTypes: copy });
                                                            }}
                                                            className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                            title="Smazat variantu"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center p-4 bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-500 text-xs">
                                            Nejsou definovány žádné specifické varianty. Použije se výchozí základní cena.
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            {/* LIVE COLLISION & WARNING */}
                            {eventCollisionInfo && (() => {
                                if (eventCollisionInfo.hasCollision) {
                                    return (
                                        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 space-y-1">
                                            <div className="font-bold flex items-center gap-1">
                                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                                Nelze uložit — Kolize ve Velké místnosti
                                            </div>
                                            <p>{eventCollisionInfo.reason}</p>
                                        </div>
                                    );
                                }

                                if (eventCollisionInfo.warning) {
                                    return (
                                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-2">
                                            <div className="font-bold flex items-center gap-1 text-amber-900">
                                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                                                Upozornění: Souběžná rezervace lektora
                                            </div>
                                            <p className="leading-normal">{eventCollisionInfo.warning}</p>
                                            <label className="flex items-start gap-2 pt-1 font-semibold cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={confirmEventParallel}
                                                    onChange={e => setConfirmEventParallel(e.target.checked)}
                                                    className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                                />
                                                <span>Beru na vědomí a chci přesto pokračovat</span>
                                            </label>
                                        </div>
                                    );
                                }

                                return null;
                            })()}

                            <div className="pt-6 border-t border-stone-100 flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setIsEventModalOpen(false)}>Zrušit</Button>
                                <Button 
                                    type="submit" 
                                    disabled={!!eventCollisionInfo?.hasCollision || (!!eventCollisionInfo?.warning && !confirmEventParallel)}
                                    className="flex items-center gap-2"
                                >
                                    <Save className="w-4 h-4" /> {editingEventId ? 'Uložit změny' : 'Vytvořit Událost'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Event Participants Modal */}
            {selectedParticipantsEventId && (() => {
                const event = groupEvents.find(e => e.id === selectedParticipantsEventId);
                const regs = eventRegistrations.filter(r => r.eventId === selectedParticipantsEventId);
                
                return (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95">
                            <div className="flex justify-between items-center p-6 border-b border-stone-100 sticky top-0 bg-white z-10">
                                <div>
                                    <h2 className="text-xl font-bold font-heading text-stone-900">Seznam účastníků: {event?.title}</h2>
                                    <p className="text-sm text-stone-500 mt-1">
                                        Termín: {event ? formatLocalDate(event.date) : ''} v {event?.startTime} - {event?.endTime} • Obsazenost: {regs.filter(r => r.paymentStatus !== 'cancelled').reduce((acc, curr) => acc + (curr.ticketTypeSpots || 1), 0)} / {event?.capacity} míst
                                    </p>
                                </div>
                                <button onClick={() => setSelectedParticipantsEventId(null)} className="text-stone-400 hover:text-stone-600 p-2">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="flex-grow overflow-y-auto p-6">
                                {regs.length === 0 ? (
                                    <div className="text-center py-16">
                                        <Users className="w-12 h-12 text-stone-300 mx-auto mb-3" />
                                        <p className="text-stone-500">Zatím se na tuto akci nikdo nepřihlásil.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="border-b border-stone-100 text-stone-400 text-xs uppercase tracking-wider">
                                                    <th className="pb-3 font-semibold">Jméno klienta</th>
                                                    <th className="pb-3 font-semibold">Varianta / Vstupné</th>
                                                    <th className="pb-3 font-semibold">E-mail</th>
                                                    <th className="pb-3 font-semibold">Telefon</th>
                                                    <th className="pb-3 font-semibold">Datum přihlášení</th>
                                                    <th className="pb-3 font-semibold">Stav platby / GoPay ID</th>
                                                    <th className="pb-3 font-semibold text-right">Akce</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-stone-100 text-stone-700 text-sm">
                                                {regs.map(reg => {
                                                    const date = new Date(reg.registeredAt);
                                                    const formattedRegDate = !isNaN(date.getTime()) 
                                                        ? `${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
                                                        : reg.registeredAt;

                                                    return (
                                                        <tr key={reg.id} className="hover:bg-stone-50/50">
                                                            <td className="py-4 font-medium text-stone-900">{reg.clientName}</td>
                                                            <td className="py-4">
                                                                <div className="font-semibold text-stone-800">{reg.ticketTypeName || 'Základní'}</div>
                                                                <div className="text-xs text-stone-500">
                                                                    {reg.ticketTypePrice ?? event?.price} Kč ({reg.ticketTypeSpots || 1} {reg.ticketTypeSpots === 1 ? 'místo' : 'místa'})
                                                                </div>
                                                            </td>
                                                            <td className="py-4">
                                                                <a href={`mailto:${reg.clientEmail}`} className="text-indigo-600 hover:underline">{reg.clientEmail}</a>
                                                            </td>
                                                            <td className="py-4 text-stone-500">{reg.clientPhone || '—'}</td>
                                                            <td className="py-4 text-stone-500">{formattedRegDate}</td>
                                                            <td className="py-4">
                                                                <div className="flex flex-col gap-1 items-start">
                                                                    {reg.paymentStatus === 'paid' && (
                                                                        <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 px-2.5 py-1 rounded-full text-xs font-bold">
                                                                            <CheckCircle className="w-3.5 h-3.5" /> Zaplaceno
                                                                        </span>
                                                                    )}
                                                                    {reg.paymentStatus === 'awaiting_payment' && (
                                                                        <span className="inline-flex items-center gap-1 bg-yellow-50 text-yellow-700 px-2.5 py-1 rounded-full text-xs font-bold">
                                                                            <Clock className="w-3.5 h-3.5" /> Čeká na platbu
                                                                        </span>
                                                                    )}
                                                                    {reg.paymentStatus === 'cancelled' && (
                                                                        <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 px-2.5 py-1 rounded-full text-xs font-bold">
                                                                            <XCircle className="w-3.5 h-3.5" /> Stornováno
                                                                        </span>
                                                                    )}
                                                                    {reg.paymentStatus === 'unpaid' && (
                                                                        <span className="inline-flex items-center gap-1 bg-stone-100 text-stone-700 px-2.5 py-1 rounded-full text-xs font-bold">
                                                                            Nezaplaceno
                                                                        </span>
                                                                    )}
                                                                    
                                                                    {reg.paymentId && (
                                                                        <span className="text-[10px] text-stone-400 font-mono">
                                                                            GoPay ID: {reg.paymentId}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="py-4 text-right">
                                                                <div className="flex gap-2 justify-end">
                                                                    {reg.paymentStatus !== 'paid' && reg.paymentStatus !== 'cancelled' && (
                                                                        <Button 
                                                                            variant="outline" 
                                                                            size="sm" 
                                                                            className="text-green-600 hover:bg-green-50 hover:border-green-200 text-xs font-bold py-1 px-2"
                                                                            disabled={isActionPending}
                                                                            onClick={async () => {
                                                                                if (!confirm(`Opravdu chcete označit registraci pro "${reg.clientName}" za zaplacenou?`)) return;
                                                                                setIsActionPending(true);
                                                                                const success = await useStore.getState().adminMarkRegistrationAsPaid(reg.id);
                                                                                setIsActionPending(false);
                                                                                if (success) {
                                                                                    addToast('success', 'Zaplaceno', 'Registrace byla úspěšně označena jako zaplacená a potvrzovací e-mail byl odeslán.');
                                                                                } else {
                                                                                    addToast('error', 'Chyba', 'Nepodařilo se označit platbu.');
                                                                                }
                                                                            }}
                                                                        >
                                                                            Potvrdit platbu
                                                                        </Button>
                                                                    )}
                                                                    {reg.paymentStatus !== 'cancelled' && (
                                                                        <Button 
                                                                            variant="outline" 
                                                                            size="sm" 
                                                                            className="text-red-600 hover:bg-red-50 hover:border-red-200 text-xs font-bold py-1 px-2"
                                                                            disabled={isActionPending}
                                                                            onClick={async () => {
                                                                                if (!confirm(`Opravdu chcete stornovat registraci pro "${reg.clientName}"? Tímto uvolníte ${reg.ticketTypeSpots || 1} místa v kapacitě.`)) return;
                                                                                setIsActionPending(true);
                                                                                const success = await useStore.getState().adminCancelRegistration(reg.id);
                                                                                setIsActionPending(false);
                                                                                if (success) {
                                                                                    addToast('success', 'Stornováno', 'Registrace byla stornována, kapacita byla uvolněna a klientovi byl odeslán e-mail.');
                                                                                } else {
                                                                                    addToast('error', 'Chyba', 'Nepodařilo se stornovat registraci.');
                                                                                }
                                                                            }}
                                                                        >
                                                                            Storno
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end">
                                <Button onClick={() => setSelectedParticipantsEventId(null)}>
                                    Zavřít
                                </Button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Reschedule Modal */}
            {reschedulingBooking && (
                <RescheduleModal 
                    booking={reschedulingBooking} 
                    allBookings={allBookings}
                    onClose={() => setReschedulingBooking(null)} 
                    onConfirm={async (date, time, reason, newRoom, newEquipment) => {
                        try {
                            await onAdminReschedule(reschedulingBooking.id, date, time, reason, newRoom, newEquipment);
                            setReschedulingBooking(null);
                            const roomName = (newRoom || reschedulingBooking.room) === 1 ? 'Místnost 1 (Malá)' : 'Místnost 2 (Velká)';
                            const eqLabel = newEquipment === 'futon' ? 'Futon' : newEquipment === 'table' ? 'Lehátko' : 'Bez';
                            addToast('success', 'Rezervace upravena', `Rezervace byla úspěšně uložena na ${formatLocalDate(date)} v ${time} v ${roomName} (${eqLabel}).`);
                        } catch (err: any) {
                            addToast('error', 'Chyba přesunu', err.message || 'Nepodařilo se přesunout rezervaci.');
                        }
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
                            <div className="flex items-center gap-4">
                                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-stone-200 bg-stone-100 flex items-center justify-center shrink-0">
                                    {practitionerForm.imageUrl
                                        ? <img src={practitionerForm.imageUrl} alt="Náhled" className="w-full h-full object-cover" />
                                        : <Users className="w-8 h-8 text-stone-300" />}
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-stone-700 mb-1">Fotka lektora</label>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handlePhotoUpload}
                                        className="block w-full text-xs text-stone-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-medium hover:file:bg-indigo-100 cursor-pointer"
                                    />
                                    <p className="text-[10px] text-stone-500 mt-1">Fotka se automaticky zmenší a uloží k profilu. Nepovinné.</p>
                                </div>
                            </div>

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

                            <div>
                                <label className="block text-sm font-bold text-stone-700 mb-1">E-mail lektora</label>
                                <input
                                    type="email"
                                    value={practitionerForm.email}
                                    onChange={e => setPractitionerForm({...practitionerForm, email: e.target.value})}
                                    className="w-full p-2 border border-stone-300 rounded-lg text-sm bg-white"
                                    placeholder="lektor@centrumunity.cz"
                                />
                                <p className="text-[10px] text-stone-500 mt-1">
                                    Sem chodí potvrzení o rezervaci, platbě a storno. Nepovinné.
                                </p>
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