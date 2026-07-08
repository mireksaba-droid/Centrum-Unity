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
}: CollisionCheckParams): { hasCollision: boolean; reason?: string; conflictingBooking?: Booking } => {
    
    const newStart = timeToMinutes(newTime);
    const newEnd = newStart + durationMinutes;

    // 1. Check if USER is already booked somewhere else at this time (Double Booking)
    // Note: Guests (ID 'guest') are exempted from this check as they are multiple people sharing one ID
    if (userId !== 'guest') {
        const doubleBooking = allBookings.find(b => {
            if (b.id === excludeBookingId) return false;
            if (b.bookedByUserId !== userId) return false;
            if (b.date !== newDate || !['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status)) return false;

            const bStart = timeToMinutes(b.time);
            const bEnd = bStart + b.durationMinutes;

            return (newStart < bEnd && newEnd > bStart);
        });

        if (doubleBooking) {
            return { hasCollision: true, reason: "V tomto čase již máte jinou rezervaci.", conflictingBooking: doubleBooking };
        }
    }

    // 2. Check ROOM collision (including Buffers)
    const roomCollision = allBookings.find(b => {
        if (b.id === excludeBookingId) return false;
        if (b.date !== newDate || !['awaiting_payment', 'deferred_payment', 'paid', 'completed'].includes(b.status) || b.room !== room) return false;

        const bStart = timeToMinutes(b.time);
        const bEnd = bStart + b.durationMinutes;

        // A) Direct Overlap
        if (newStart < bEnd && newEnd > bStart) return true;

        // B) Buffer AFTER existing booking (They block me)
        const bufferAfterThem = (b.bookedByUserId === userId) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
        const bBufferEnd = bEnd + bufferAfterThem;
        if (newStart < bBufferEnd && newStart >= bEnd) return true;

        // C) Buffer AFTER my new booking (I block them)
        const bufferAfterMe = (b.bookedByUserId === userId) ? BUFFER_SAME_USER : BUFFER_DIFF_USER;
        const myBufferEnd = newEnd + bufferAfterMe;
        if (newEnd <= bStart && myBufferEnd > bStart) return true;

        return false;
    });

    if (roomCollision) {
        return { hasCollision: true, reason: `Kolize s rezervací (${roomCollision.bookedByName}) nebo povinnou pauzou na úklid.`, conflictingBooking: roomCollision };
    }

    return { hasCollision: false };
};

export const calculateRentalPrice = (userId: string, minutes: number, room: 1 | 2): number => {
    if (userId === 'admin') return 0;
    if (minutes >= 720) return 1700;
    const rate = room === 1 ? RENTAL_PRICING.room1 : RENTAL_PRICING.room2;
    return (minutes / 60) * rate;
};