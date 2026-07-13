import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Practitioner, Booking, GroupEvent, EventRegistration, Role } from '../types';
import { generateConfirmationEmail, generateCancellationEmail } from "../utils/emailTemplates";
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
  sendTransactionalEmail
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
  attachPaymentId: (bookingId: string, paymentId: string) => void;
  removeBooking: (bookingId: string) => Promise<void>;
  cancelBooking: (bookingId: string) => Promise<void>;
  adminRescheduleBooking: (bookingId: string, newDate: string, newTime: string, reason?: string) => Promise<void>;
  
  // Practitioners
  updatePractitioner: (updatedP: Practitioner) => void;
  addPractitioner: (newPractitioner: Practitioner) => void;
  deletePractitioner: (id: string) => Promise<void>;
  
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
              // Vynutíme si aktuální URL obrázků z konstant (PRACTITIONERS)
              const mapped = practitioners.map(p => {
                  const staticDef = PRACTITIONERS.find(s => s.id === p.id);
                  // Použijeme data z databáze. Pokud v databázi chybí obrázek, použijeme fallback z konstant.
                  if (staticDef && (!p.imageUrl || p.imageUrl.includes('unsplash.com'))) {
                      return { ...p, imageUrl: staticDef.imageUrl };
                  }
                  return p;
              });
              
              // Přidáme i ty, co v DB vůbec nejsou, ale v konstantách ano (fallback)
              for (const staticDef of PRACTITIONERS) {
                  if (!mapped.find(p => p.id === staticDef.id)) {
                      mapped.push(staticDef);
                  }
              }

              set({ practitionersList: sortPractitioners(mapped) });
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
        // Nahradíme případnou starou (zrušenou) rezervaci se stejným ID, ať tam není duplikát
        set((state) => ({ bookings: [...state.bookings.filter(b => b.id !== newBooking.id), newBooking] }));
        // Odeslání potvrzovacího e-mailu pro ne-online platby - klientovi i lektorovi
        if (newBooking.paymentMethod !== "online" || newBooking.price === 0) {
            const practitioner = get().practitionersList.find(p => p.id === newBooking.bookedByUserId);
            const recipients = [newBooking.clientEmail, practitioner?.email]
                .map(x => (x || '').trim())
                .filter(Boolean)
                .join(', ');
            if (recipients) {
                try {
                    const html = generateConfirmationEmail(newBooking, newBooking.status === "paid" || newBooking.price === 0);
                    sendTransactionalEmail({
                        to: recipients,
                        subject: "Potvrzení rezervace - Centrum Unity",
                        text: "Potvrzení rezervace pro: " + newBooking.date + " v " + newBooking.time,
                        html: html
                    }).catch(e => console.error("Nepodařilo se odeslat potvrzovací e-mail:", e.message));
                    console.log("Pokus o odeslání potvrzovacího e-mailu na:", recipients);
                } catch (e: any) {
                    console.error("Chyba při přípravě e-mailu:", e.message);
                }
            }
        }
      },

      updateBookingStatus: async (bookingId: string, status: any) => {
          // Při odeslání výzvy k platbě označíme čas, od kterého běží 15min okno na platbu
          const extra = status === 'awaiting_payment' ? { paymentRequestedAt: new Date().toISOString() } : {};
          const data = { status, ...extra };
          await updateBookingInFirestore(bookingId, data);
          set((state) => ({
             bookings: state.bookings.map(b =>
                b.id === bookingId ? { ...b, ...data } : b
             )
          }));
      },

      attachPaymentId: (bookingId, paymentId) => {
          // paymentId zapsal server přímo do Firestore; sem ho jen promítneme do lokálního stavu
          set((state) => ({
             bookings: state.bookings.map(b =>
                b.id === bookingId ? { ...b, paymentId } : b
             )
          }));
      },

      removeBooking: async (bookingId) => {
          // Tiché odstranění rezervace (bez storno e-mailu) - používá se k rollbacku,
          // když se nepodaří inicializovat platbu, aby se slot hned uvolnil.
          try {
             await deleteBookingFromFirestore(bookingId);
          } catch (e) {
             console.error("Nepodařilo se odstranit rezervaci (rollback):", e);
          }
          set((state) => ({
             bookings: state.bookings.filter(b => b.id !== bookingId)
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

        // Odeslání storno e-mailu klientovi i lektorovi (pokud mají vyplněný e-mail).
        // Důvod rozlišíme podle toho, kdo rezervaci ruší.
        const practitioner = state.practitionersList.find(p => p.id === booking.bookedByUserId);
        const recipientList = [booking.clientEmail, practitioner?.email]
            .map(x => (x || '').trim())
            .filter(Boolean)
            .join(', ');

        if (recipientList) {
            const reason = isAdmin
                ? "Rezervace byla zrušena administrátorem studia."
                : isGuestBooking
                    ? "Rezervace byla zrušena na Vaši žádost."
                    : "Rezervace byla zrušena ze strany studia (lektorem).";
            try {
                if (state.token) {
                    // Přihlášený uživatel (lektor/admin) → přes chráněný endpoint s naší šablonou
                    const html = generateCancellationEmail(
                        { ...booking, status: 'cancelled', cancelledAt },
                        reason
                    );
                    sendTransactionalEmail({
                        to: recipientList,
                        subject: "Zrušení rezervace - Centrum Unity",
                        text: "Zrušení rezervace pro: " + booking.date + " v " + booking.time,
                        html: html
                    }).catch(e => console.error("Nepodařilo se odeslat storno e-mail:", e.message));
                } else {
                    // Host bez tokenu → veřejný serverový endpoint, který e-mail sestaví sám z DB
                    fetch('/api/public-cancellation-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ bookingId })
                    }).catch(e => console.error("Nepodařilo se odeslat storno e-mail (host):", e.message));
                }
            } catch (e: any) {
                console.error("Chyba při přípravě storno e-mailu:", e.message);
            }
        }

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

      deletePractitioner: async (id) => {
        const state = get();
        const res = await fetch(`/api/practitioners/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Smazání lektora se nezdařilo.');
        }
        set((s) => ({ practitionersList: s.practitionersList.filter(p => p.id !== id) }));
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
      version: 2,
      migrate: (persistedState: any, version: number) => {
        const state = persistedState;
        if (version < 2) {
          const currentList = state.practitionersList || [];
          const newList = [...currentList];
          
          // Přidání všech nových lektorů a synchronizace obrázků z konstant
          for (const practitioner of PRACTITIONERS) {
             const existingIdx = newList.findIndex((existing: any) => existing.id === practitioner.id);
             if (existingIdx === -1) {
                 newList.push(practitioner);
             } else {
                 // Force update image URLs to the latest mapped versions
                 newList[existingIdx].imageUrl = practitioner.imageUrl;
             }
          }
          
          state.practitionersList = sortPractitioners(newList);
        }
        return state;
      }
    }
  )
);
