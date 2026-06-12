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
  updatePractitionerInFirestore,
  deleteAllBookingsFromFirestore,
  deleteAllGroupEventsFromFirestore,
  deleteAllEventRegistrationsFromFirestore
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
        const newBooking: Booking = {
          id: crypto.randomUUID(),
          bookedByUserId: bookingData.bookedByUserId!,
          bookedByName: bookingData.bookedByName!,
          date: bookingData.date!,
          time: bookingData.time!,
          durationMinutes: bookingData.durationMinutes!,
          room: bookingData.room!,
          price: bookingData.price!,
          status: 'confirmed',
          paymentStatus: bookingData.paymentStatus || 'unpaid',
          paymentMethod: bookingData.paymentMethod || 'invoice',
          createdAt: new Date().toISOString()
        };

        if (bookingData.clientName) newBooking.clientName = bookingData.clientName;
        if (bookingData.clientEmail) newBooking.clientEmail = bookingData.clientEmail;
        if (bookingData.clientPhone) newBooking.clientPhone = bookingData.clientPhone;
        if (bookingData.equipment) newBooking.equipment = bookingData.equipment;
        if (bookingData.stripePaymentIntentId) newBooking.stripePaymentIntentId = bookingData.stripePaymentIntentId;

        await saveBookingToFirestore(newBooking);
        set((state) => ({ bookings: [...state.bookings, newBooking] }));

        // Odeslání potvrzovacího emailu (pokud klient zadal email)
        if (newBooking.clientEmail) {
            const dateParts = newBooking.date.split('-');
            const formattedDate = `${dateParts[2]}. ${dateParts[1]}. ${dateParts[0]}`;
            const emailHtml = `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <h2 style="color: #4f46e5;">Vaše rezervace je potvrzena</h2>
                    <p>Dobrý den,</p>
                    <p>veškeré podrobnosti o rezervaci naleznete níže:</p>
                    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Služba:</strong> ${bookingData.serviceName || `Pronájem místnosti č. ${newBooking.room}`}</p>
                        <p><strong>Datum:</strong> ${formattedDate}</p>
                        <p><strong>Čas:</strong> ${newBooking.time}</p>
                        <p><strong>Doba trvání:</strong> ${newBooking.durationMinutes} min</p>
                        <p><strong>Cena:</strong> ${newBooking.price.toLocaleString('cs-CZ')} Kč</p>
                    </div>
                    <p><strong>Místo konání:</strong> Na Moráni 5, Nové Město, Praha</p>
                    <div style="background: #fffbeb; padding: 15px; border-left: 4px solid #f59e0b; margin: 20px 0;">
                        <p style="margin: 0;"><strong>Storno podmínky:</strong><br>Vezměte prosím na vědomí, že rezervace lze zrušit maximálně 24 hodin před termínem. Pokud ji zrušíte včas, bude vám zaplacená částka vrácena.</p>
                    </div>
                    <p>Těšíme se na Vás,<br>Sólás Holistic Studio & Centrum Unity</p>
                </div>
            `;

            fetch('/api/send-email', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${get().token}`
                },
                body: JSON.stringify({
                    to: newBooking.clientEmail,
                    subject: 'Potvrzení rezervace - Centrum Unity',
                    html: emailHtml
                })
            }).catch(console.error);
        }
      },

      cancelBooking: async (bookingId) => {
        const state = get();
        const booking = state.bookings.find(b => b.id === bookingId);
        if (!booking) return;
        
        if (state.currentUser?.id !== booking.bookedByUserId && state.currentUser?.role !== Role.ADMIN) {
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
        const r1 = await deleteAllBookingsFromFirestore();
        const r2 = await deleteAllGroupEventsFromFirestore();
        const r3 = await deleteAllEventRegistrationsFromFirestore();
        
        if (!r1 || !r2 || !r3) {
            console.error("Failed to delete all data from Firebase (maybe offline). Continuing local wipe anyway.");
        }
        
        // Use Zustand persist API to clear storage completely
        useStore.persist.clearStorage();
        
        set({
          bookings: [],
          groupEvents: [],
          eventRegistrations: []
        });
        
        setTimeout(() => window.location.reload(), 100);
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
