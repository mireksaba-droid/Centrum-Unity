import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Practitioner, Booking, GroupEvent, EventRegistration, Role } from '../types';
import { PRACTITIONERS, sortPractitioners } from '../constants';
import { 
  saveBookingToFirestore, 
  saveGroupEventToFirestore, 
  updateGroupEventInFirestore, 
  deleteGroupEventFromFirestore, 
  registerForGroupEvent, 
  updateBookingInFirestore, 
  deleteBookingFromFirestore, 
  loadBookings, 
  loadPractitioners, 
  savePractitionerToFirestore, 
  updatePractitionerInFirestore
} from '../services/firebase';

interface AppState {
  currentUser: Practitioner | null;
  token: string | null;
  bookings: Booking[];
  practitionersList: Practitioner[];
  groupEvents: GroupEvent[];
  eventRegistrations: EventRegistration[];
  
  // Actions
  setCurrentUser: (user: Practitioner | null, token?: string | null) => void;
  initializeBookings: () => Promise<void>;
  
  // Bookings
  addBooking: (bookingData: Partial<Booking>) => Promise<void>;
  updateBookingStatus: (bookingId: string, status: string) => Promise<void>;
  cancelBooking: (bookingId: string) => Promise<void>;
  adminRescheduleBooking: (bookingId: string, newDate: string, newTime: string, reason?: string) => Promise<void>;
  
  // Practitioners
  updatePractitioner: (updatedP: Practitioner) => void;
  addPractitioner: (newPractitioner: Practitioner) => void;
  
  // Group Events
  createGroupEvent: (event: GroupEvent) => Promise<void>;
  updateGroupEvent: (updatedEvent: GroupEvent) => Promise<void>;
  deleteGroupEvent: (eventId: string) => Promise<void>;
  
  // Registrations
  registerForEvent: (registration: Partial<EventRegistration>) => Promise<boolean>;
  resetData: () => Promise<void>;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      token: null,
      bookings: [], // Always empty initially (data will be loaded or injected)
      practitionersList: PRACTITIONERS,
      groupEvents: [],
      eventRegistrations: [],

      setCurrentUser: (user, token = null) => set({ currentUser: user, token }),

      initializeBookings: async () => {
        try {
          const bookings = await loadBookings();
          if (bookings.length > 0) {
              set({ bookings: bookings }); // Keep just the loaded ones
          }
        } catch (e) {
          console.error("Failed to initialize bookings:", e);
        }
        
        try {
          const practitioners = await loadPractitioners();
          if (practitioners.length > 0) {
              set({ practitionersList: sortPractitioners(practitioners) });
          }
        } catch (e) {
             console.error("Failed to initialize practitioners:", e);
        }
      },

      addBooking: async (bookingData) => {
        const slotId = `${bookingData.room}_${bookingData.date}_${bookingData.time}`;
        const newBooking: Booking = {
          id: slotId,
          bookedByUserId: bookingData.bookedByUserId!,
          bookedByName: bookingData.bookedByName!,
          date: bookingData.date!,
          time: bookingData.time!,
          durationMinutes: bookingData.durationMinutes!,
          room: bookingData.room!,
          price: bookingData.price!,
          status: bookingData.status || 'created',
          paymentMethod: bookingData.paymentMethod || 'invoice',
          createdAt: new Date().toISOString()
        };

        if (bookingData.clientName) newBooking.clientName = bookingData.clientName;
        if (bookingData.clientEmail) newBooking.clientEmail = bookingData.clientEmail;
        if (bookingData.clientPhone) newBooking.clientPhone = bookingData.clientPhone;
        if (bookingData.equipment) newBooking.equipment = bookingData.equipment;
        if (bookingData.paymentId) newBooking.paymentId = bookingData.paymentId;

        await saveBookingToFirestore(newBooking);
        set((state) => ({ bookings: [...state.bookings, newBooking] }));
      },

      updateBookingStatus: async (bookingId: string, status: any) => {
          await updateBookingInFirestore(bookingId, { status });
          set((state) => ({
             bookings: state.bookings.map(b => 
                b.id === bookingId ? { ...b, status } : b
             )
          }));
      },

      cancelBooking: async (bookingId) => {
        const state = get();
        const booking = state.bookings.find(b => b.id === bookingId);
        if (!booking) return;
        
        const isOwner = state.currentUser?.id === booking.bookedByUserId;
        const isAdmin = state.currentUser?.role === Role.ADMIN;
        const isGuestBooking = !state.currentUser && booking.bookedByUserId === 'guest';
        
        if (!isOwner && !isAdmin && !isGuestBooking) {
          console.error("Unauthorized to cancel this booking");
          return;
        }

        const cancelledAt = new Date().toISOString();
        await updateBookingInFirestore(bookingId, { status: 'cancelled', cancelledAt });

        set((state) => ({
          bookings: state.bookings.map(b => 
            b.id === bookingId ? { ...b, status: 'cancelled', cancelledAt } : b
          )
        }));
      },

      adminRescheduleBooking: async (bookingId, newDate, newTime, reason) => {
        const state = get();
        const b = state.bookings.find(b => b.id === bookingId);
        if (!b) return;

        const newNote = reason ? (b.note ? `${b.note}\nADMIN RESCHEDULE: ${reason}` : `ADMIN RESCHEDULE: ${reason}`) : b.note;
        
        await updateBookingInFirestore(bookingId, { date: newDate, time: newTime, note: newNote });

        set((state) => ({
          bookings: state.bookings.map(b => {
            if (b.id !== bookingId) return b;
            return {
              ...b,
              date: newDate,
              time: newTime,
              note: newNote
            };
          })
        }));
      },

      updatePractitioner: async (updatedP) => {
        await updatePractitionerInFirestore(updatedP);
        set((state) => ({
          practitionersList: sortPractitioners(state.practitionersList.map(p => p.id === updatedP.id ? updatedP : p))
        }));
      },

      addPractitioner: async (newPractitioner) => {
        await savePractitionerToFirestore(newPractitioner);
        set((state) => ({
          practitionersList: sortPractitioners([...state.practitionersList, newPractitioner])
        }));
      },

      createGroupEvent: async (event) => {
        await saveGroupEventToFirestore(event);
        set((state) => ({ groupEvents: [...state.groupEvents, event] }));
      },

      updateGroupEvent: async (updatedEvent) => {
        await updateGroupEventInFirestore(updatedEvent);
        set((state) => ({
          groupEvents: state.groupEvents.map(e => e.id === updatedEvent.id ? updatedEvent : e)
        }));
      },

      deleteGroupEvent: async (eventId) => {
        await deleteGroupEventFromFirestore(eventId);
        set((state) => ({
          groupEvents: state.groupEvents.filter(e => e.id !== eventId)
        }));
      },

      registerForEvent: async (registration) => {
        const newRegistration: EventRegistration = {
          id: crypto.randomUUID(),
          eventId: registration.eventId!,
          clientName: registration.clientName!,
          clientEmail: registration.clientEmail!,
          clientPhone: registration.clientPhone,
          paymentStatus: registration.paymentStatus || 'unpaid',
          registeredAt: registration.registeredAt!
        };
        const success = await registerForGroupEvent(newRegistration);
        if (success) {
          set((state) => ({ eventRegistrations: [...state.eventRegistrations, newRegistration] }));
          return true;
        }
        return false;
      },
      
      resetData: async () => {
        try {
          const state = get();
          const response = await fetch('/api/admin/reset-data', {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${state.token}`
            }
          });
          
          if (!response.ok) {
            throw new Error("Nepodařilo se smazat data na serveru");
          }
          
          // Use Zustand persist API to clear storage completely
          useStore.persist.clearStorage();
          
          set({
            bookings: [],
            groupEvents: [],
            eventRegistrations: []
          });
          
          setTimeout(() => window.location.reload(), 100);
        } catch (error) {
          console.error("Chyba při resetování dat:", error);
          alert("Nastala chyba. Zkontrolujte, že jste přihlášeni jako administrátor.");
        }
      }
    }),
    {
      name: 'centrum-unity-storage', // name of the item in the storage (must be unique)
      version: 1,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          const state = persistedState;
          const currentList = state.practitionersList || [];
          const newList = [...currentList];
          
          // Přidání všech nových lektorů z konstant, kteří ještě chybí v lokálním storu
          for (const practitioner of PRACTITIONERS) {
             if (!newList.find((existing: any) => existing.id === practitioner.id)) {
                 newList.push(practitioner);
             }
          }
          
          state.practitionersList = sortPractitioners(newList);
          return state;
        }
        return persistedState as any;
      }
    }
  )
);
