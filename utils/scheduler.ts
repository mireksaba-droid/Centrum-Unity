import { Booking } from '../types';
import { BUFFER_SAME_USER, BUFFER_DIFF_USER, RENTAL_PRICING } from '../constants';

// Helper: Convert time "14:30" -> minutes 870
export const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

// Helper: Convert minutes -> time string "14:30"
export const minutesToTime = (minutes: number): string => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

interface CollisionCheckParams {
    newDate: string;
    newTime: string;
    durationMinutes: number;
    room: 1 | 2;
    userId: string;
    allBookings: Booking[];
    excludeBookingId?: string; // For rescheduling
}

export const checkBookingCollision = ({
    newDate,
    newTime,
    durationMinutes,
    room,
    userId,
    allBookings,
    excludeBookingId
}: CollisionCheckParams): { hasCollision: boolean; reason?: string; warning?: string; conflictingBooking?: Booking } => {

    const newStart = timeToMinutes(newTime);
    const newEnd = newStart + durationMinutes;
    const ACTIVE = ['awaiting_payment', 'deferred_payment', 'paid', 'completed'];

    // 1. TVRDÁ zábrana: kolize ve STEJNÉ místnosti (překryv + povinná pauza na úklid)
    const roomCollision = allBookings.find(b => {
        if (b.id === excludeBookingId) return false;
        if (b.date !== newDate || !ACTIVE.includes(b.status) || b.room !== room) return false;

        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + b.durationMinutes;

        // A) Přímý překryv
        if (newStart < bEnd && newEnd > bStart) return true;
        // B) Pauza po existující rezervaci (blokuje mě)
        const bufferAfterThem = (b.bookedByUserId === userId) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
        if (newStart < bEnd + bufferAfterThem && newStart >= bEnd) return true;
        // C) Pauza po mé nové rezervaci (blokuji ostatní)
        const bufferAfterMe = (b.bookedByUserId === userId) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
        if (newEnd <= bStart && newEnd + bufferAfterMe > bStart) return true;

        return false;
    });

    if (roomCollision) {
        return { hasCollision: true, reason: `Kolize s rezervací (${roomCollision.bookedByName}) nebo povinnou pauzou na úklid.`, conflictingBooking: roomCollision };
    }

    // 2. MĚKKÉ varování: lektor už má ve stejný čas rezervaci v DRUHÉ místnosti.
    //    Povoleno (např. párová terapie), ale upozorníme a necháme potvrdit.
    //    Hosté (ID 'guest') jsou z kontroly vyňati – sdílí jedno ID.
    if (userId !== 'guest') {
        const parallelBooking = allBookings.find(b => {
            if (b.id === excludeBookingId) return false;
            if (b.bookedByUserId !== userId) return false;
            if (b.room === room) return false; // stejnou místnost řeší tvrdá kolize výše
            if (b.date !== newDate || !ACTIVE.includes(b.status)) return false;
            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + b.durationMinutes;
            return (newStart < bEnd && newEnd > bStart);
        });
        if (parallelBooking) {
            return {
                hasCollision: false,
                warning: `V tomto čase už máte zarezervovanou místnost ${parallelBooking.room === 1 ? 'M1 (Malá)' : 'M2 (Velká)'}. Chcete opravdu vytvořit i tuto rezervaci?`,
                conflictingBooking: parallelBooking
            };
        }
    }

    return { hasCollision: false };
};

export const calculateRentalPrice = (userId: string, minutes: number, room: 1 | 2): number => {
    if (userId === 'admin') return 0;
    if (minutes >= 720) return 1700;
    const rate = room === 1 ? RENTAL_PRICING.room1 : RENTAL_PRICING.room2;
    return (minutes / 60) * rate;
};