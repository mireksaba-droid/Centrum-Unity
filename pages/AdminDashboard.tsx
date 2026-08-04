import React, { useState, useMemo } from 'react';
import { Booking, Practitioner, Service, Role, GroupEvent, EventRegistration } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, Calendar, DollarSign, TrendingUp, Search, MoreHorizontal, Settings, ShieldAlert, Edit, Trash2, CheckCircle, XCircle, Clock, Filter, Eye, EyeOff, Activity, Layers, BoxSelect, AlertTriangle, Trophy, LogOut, Plus, X, Save, Lock, Megaphone, Link, ChevronDown, ChevronRight, Loader2, Smartphone } from 'lucide-react';
import Button from '../components/Button';
import StudioSchedule from './StudioSchedule';
import RescheduleModal from '../components/RescheduleModal';
import { useToast } from '../contexts/ToastContext';
import { checkBookingCollision, timeToMinutes } from '../utils/scheduler';
import { formatLocalDate, parseLocalDate } from '../utils/dateUtils';
import { useStore } from '../store/useStore';
import { isDemoMode } from '../services/firebase';
import { generatePaymentRequestEmail } from '../utils/emailTemplates';

// Testovací / ignorovaná jména – nezobrazují se ve statistikách, aktivitě ani seznamu objednávek.
// Normalizace = malá písmena + odstranění diakritiky + sjednocení mezer, ať to chytne i "MIREK SABA", "Mírek  Sába" apod.
const normalizeName = (s?: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const IGNORED_NAMES = ['Mirek Saba'].map(normalizeName);
const isIgnoredName = (name?: string) => IGNORED_NAMES.includes(normalizeName(name));

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
        if (warning && !window.confirm(warning)) {
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

        // 5. Vývoj tržeb (posledních 6 měsíců) – DVĚ křivky:
        //    'received'  = reálně přijaté peníze podle data platby (paidAt, fallback createdAt) MÍNUS vrácené (dle cancelledAt)
        //    'scheduled' = zaplacené lekce podle data konání lekce (b.date)
        const today = new Date();
        const last6Months = Array.from({ length: 6 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - (5 - i), 1));
        const inMonth = (d: Date | null, m: number, y: number) => !!d && d.getMonth() === m && d.getFullYear() === y;

        const revenueTrendData = last6Months.map((monthDate) => {
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
            const name = b.bookedByName || 'Neznámý';
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
                ['cancelled_by_admin_paid', 'cancelled_by_guest_refunded'].includes(b.cancellationReason || '')
            ));
        const stornoBookings = src.filter(wasPaidThenCancelled);
        const totalCancelled = stornoBookings.length;                       // reálně stornované (zaplacené) rezervace
        const paidEverCount = paidBookings.length + stornoBookings.length;  // vše, co bylo někdy zaplaceno
        const cancellationRate = paidEverCount > 0 ? ((totalCancelled / paidEverCount) * 100).toFixed(1) : "0";

        // Lead time distribuce – jen z reálných storen
        const leadTimes = { critical: 0, warning: 0, safe: 0 };
        stornoBookings.forEach(b => {
            if (!b.cancelledAt) return;
            const bookingDate = parseLocalDate(b.date, b.time);
            const cancelDate = new Date(b.cancelledAt);
            const diffHours = (bookingDate.getTime() - cancelDate.getTime()) / (1000 * 60 * 60);
            if (diffHours < 24) leadTimes.critical++;
            else if (diffHours < 48) leadTimes.warning++;
            else leadTimes.safe++;
        });

        const cancellationLeadTimeData = [
            { name: '< 24h (Krizové)', value: leadTimes.critical, color: '#ef4444' },
            { name: '24-48h (Varovné)', value: leadTimes.warning, color: '#f59e0b' },
            { name: '> 48h (Bezpečné)', value: leadTimes.safe, color: '#10b981' },
        ];

        // 8. NAPLNĚNOST MÍSTNOSTÍ (% využití) po měsících.
        // Jmenovatel = provozní doba (08:00–24:00 = 16 h) × počet dní v měsíci. Čitatel = odrezervované hodiny (aktivní rezervace).
        const OPERATING_HOURS_PER_DAY = 16;
        const daysInMonth = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
        const roomHoursInMonth = (room: 1 | 2, mm: number, yy: number) =>
            confirmedBookings.reduce((sum, b) => {
                if (b.room !== room) return sum;
                return inMonth(parseLocalDate(b.date), mm, yy) ? sum + (b.durationMinutes || 0) / 60 : sum;
            }, 0);
        const occupancyTrend = last6Months.map((monthDate) => {
            const mm = monthDate.getMonth();
            const yy = monthDate.getFullYear();
            const avail = OPERATING_HOURS_PER_DAY * daysInMonth(yy, mm);
            const nm = monthDate.toLocaleDateString('cs-CZ', { month: 'short' });
            return {
                name: nm.charAt(0).toUpperCase() + nm.slice(1),
                M1: avail > 0 ? Math.round((roomHoursInMonth(1, mm, yy) / avail) * 100) : 0,
                M2: avail > 0 ? Math.round((roomHoursInMonth(2, mm, yy) / avail) * 100) : 0,
            };
        });
        const currentOccupancy = occupancyTrend[occupancyTrend.length - 1] || { M1: 0, M2: 0, name: '' };

        // 9. KDO DĚLÁ NEJVÍC STOREN – počet i míra (storna ÷ jeho zaplacené rezervace).
        const perPract: Record<string, { paid: number; storno: number }> = {};
        paidBookings.forEach(b => { const n = b.bookedByName || 'Neznámý'; (perPract[n] ||= { paid: 0, storno: 0 }).paid++; });
        stornoBookings.forEach(b => { const n = b.bookedByName || 'Neznámý'; (perPract[n] ||= { paid: 0, storno: 0 }).storno++; });
        const cancellationsByPractitioner = Object.entries(perPract)
            .map(([name, v]) => ({ name, storno: v.storno, total: v.paid + v.storno, rate: (v.paid + v.storno) > 0 ? Math.round((v.storno / (v.paid + v.storno)) * 100) : 0 }))
            .filter(x => x.storno > 0)
            .sort((a, b) => (b.storno - a.storno) || (b.rate - a.rate));

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
            cancellationRate,
            totalCancelled,
            paidEverCount,
            occupancyTrend,
            currentOccupancy,
            cancellationsByPractitioner
        };
    }, [allBookings]);

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
            const key = b.bookedByUserId || b.bookedByName || 'unknown';
            if (!groups[key]) groups[key] = { name: b.bookedByName || 'Neznámý lektor', bookings: [], lastAt: 0 };
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
    }, [allBookings]);

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
        if (!window.confirm(`Opravdu smazat lektora ${p.name}? Tuto akci nelze vzít zpět.`)) return;
        try {
            await useStore.getState().deletePractitioner(p.id);
            addToast('success', 'Smazáno', `Lektor ${p.name} byl odstraněn.`);
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
        const pName = b.bookedByName || '';
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

                            {/* SECTION 1: FINANCIAL PERFORMANCE */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Revenue Trend */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-1 flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-indigo-600" /> Vývoj tržeb (Posledních 6 měsíců)
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-6">Přijaté peníze (dle data platby, mínus vrácené) vs. naplánované zaplacené lekce (dle data konání).</p>
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

                            {/* SECTION 2.5: NAPLNĚNOST MÍSTNOSTÍ + STORNA LEKTORŮ */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Naplněnost místností */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-1 flex items-center gap-2">
                                        <BoxSelect className="w-5 h-5 text-indigo-600" /> Naplněnost místností
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-2">% využití z provozní doby (08–24, 16 h/den × dny v měsíci).</p>
                                    <div className="flex gap-4 mb-4">
                                        <div className="flex-1 bg-amber-50 border border-amber-100 rounded-lg p-3 text-center">
                                            <div className="text-2xl font-bold text-stone-900">{stats.currentOccupancy.M1}%</div>
                                            <div className="text-xs text-stone-500">M1 (Malá) — {stats.currentOccupancy.name}</div>
                                        </div>
                                        <div className="flex-1 bg-stone-100 border border-stone-200 rounded-lg p-3 text-center">
                                            <div className="text-2xl font-bold text-stone-900">{stats.currentOccupancy.M2}%</div>
                                            <div className="text-xs text-stone-500">M2 (Velká) — {stats.currentOccupancy.name}</div>
                                        </div>
                                    </div>
                                    <div className="h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats.occupancyTrend}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                                                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12}} unit="%" domain={[0, 100]} />
                                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} formatter={(v: any, n: any) => [`${v} %`, n]} />
                                                <Legend />
                                                <Bar dataKey="M1" fill="#ba8a5b" radius={[4, 4, 0, 0]} />
                                                <Bar dataKey="M2" fill="#7a573d" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                {/* Kdo dělá nejvíc storen */}
                                <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm">
                                    <h3 className="text-lg font-bold text-stone-900 mb-1 flex items-center gap-2">
                                        <AlertTriangle className="w-5 h-5 text-red-500" /> Kdo dělá nejvíc storen
                                    </h3>
                                    <p className="text-xs text-stone-500 mb-4">Zrušené zaplacené rezervace a míra vůči objemu daného lektora.</p>
                                    {stats.cancellationsByPractitioner.length === 0 ? (
                                        <p className="text-sm text-stone-500">Zatím žádná storna zaplacených rezervací. 🎉</p>
                                    ) : (
                                        <div className="overflow-hidden">
                                            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[11px] font-bold text-stone-400 uppercase tracking-wide pb-2 border-b border-stone-100">
                                                <span>Lektor</span><span className="text-right">Storna</span><span className="text-right">Míra</span>
                                            </div>
                                            <div className="divide-y divide-stone-100">
                                                {stats.cancellationsByPractitioner.map((p) => (
                                                    <div key={p.name} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-2.5">
                                                        <span className="text-sm font-semibold text-stone-800 truncate">{p.name}</span>
                                                        <span className="text-sm text-stone-700 text-right">{p.storno} <span className="text-stone-400">/ {p.total}</span></span>
                                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full justify-self-end ${p.rate >= 30 ? 'bg-red-100 text-red-700' : p.rate >= 15 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>{p.rate}%</span>
                                                    </div>
                                                ))}
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
                                                <div className="font-bold text-stone-900">{booking.bookedByName}</div>
                                                <div className="text-xs text-indigo-600 font-medium">{booking.serviceName}</div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${booking.room === 1 ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                                                    {booking.room === 1 ? 'Malá (R1)' : 'Velká (R2)'}
                                                </span>
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
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleDeletePractitioner(p)}
                                        className="hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                    >
                                        <Trash2 className="w-4 h-4 mr-1" /> Smazat
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
                                    Rezervace se aktualizují samy (kalendáře je obnovují po několika hodinách).
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