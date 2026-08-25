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
  sendTransactionalEmail,
  loadGroupEvents,
  loadEventRegistrations
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
  updateBookingStatus: (bookingId: string, status: string, reason?: string) => Promise<void>;
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
  registerForEvent: (registration: Partial<EventRegistration>) => Promise<{ success: boolean; paymentUrl?: string }>;
  adminMarkRegistrationAsPaid: (regId: string) => Promise<boolean>;
  adminCancelRegistration: (regId: string) => Promise<boolean>;
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

      setCurrentUser: (user, token = null) => {
        set({ currentUser: user, token });
        if (user && user.role === Role.ADMIN) {
          loadEventRegistrations(token).then((regs) => {
            set({ eventRegistrations: regs || [] });
          }).catch(err => {
            console.error("Failed to reload event registrations as admin:", err);
          });
        }
      },

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
          const practitioners = await loadPractitioners(get().token);
          if (practitioners.length > 0) {
              // URL obrázků z konstant použijeme JEN pokud lektor nemá v DB nahranou vlastní fotku (base64).
              // Tím se nepřepíše fotka, kterou admin nahrál v aplikaci (ukládá se jako data:image/...).
              const mapped = practitioners.map(p => {
                  const staticDef = PRACTITIONERS.find(s => s.id === p.id);
                  if (staticDef) {
                      const hasCustomDbImage = p.imageUrl && p.imageUrl.startsWith('data:image/');
                      if (!hasCustomDbImage) {
                          return { ...p, imageUrl: staticDef.imageUrl };
                      }
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

        try {
          const groupEvents = await loadGroupEvents();
          set({ groupEvents: groupEvents || [] });
        } catch (e) {
          console.error("Failed to initialize group events:", e);
        }

        try {
          const eventRegistrations = await loadEventRegistrations(get().token);
          set({ eventRegistrations: eventRegistrations || [] });
        } catch (e) {
          console.error("Failed to initialize event registrations:", e);
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
        if (newBooking.status === 'paid') newBooking.paidAt = new Date().toISOString();

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

      updateBookingStatus: async (bookingId: string, status: any, reason?: string) => {
          // Při odeslání výzvy k platbě označíme čas, od kterého běží 15min okno na platbu
          const extra = status === 'awaiting_payment' ? { paymentRequestedAt: new Date().toISOString() } : {};
          // Čas zaplacení pro finanční přehled (shoda s GoPay)
          const paidExtra = status === 'paid' ? { paidAt: new Date().toISOString() } : {};
          // Důvod zrušení (např. 'payment_failed' z návratu z brány) uložíme, aby admin poznal, proč termín padl
          const cancelExtra = status === 'cancelled' && reason ? { cancellationReason: reason } : {};
          const data = { status, ...extra, ...paidExtra, ...cancelExtra };
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
        // Kdo ruší → důvod, aby to admin v přehledu poznal
        const cancellationReason = isAdmin
            ? (booking.status === 'paid' ? 'cancelled_by_admin_paid' : 'cancelled_by_admin')
            : isGuestBooking
                ? 'cancelled_by_guest'
                : 'cancelled_by_practitioner';
        await updateBookingInFirestore(bookingId, { status: 'cancelled', cancelledAt, cancellationReason });

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
            b.id === bookingId ? { ...b, status: 'cancelled', cancelledAt, cancellationReason } : b
          )
        }));
      },

      adminRescheduleBooking: async (bookingId, newDate, newTime, reason) => {
        const state = get();
        const b = state.bookings.find(b => b.id === bookingId);
        if (!b) return;

        // Validace kolizí: přednost má vždy existující rezervace
        const { checkBookingCollision } = await import('../utils/scheduler');
        const collision = checkBookingCollision({
          newDate,
          newTime,
          durationMinutes: b.durationMinutes,
          room: b.room,
          userId: b.bookedByUserId,
          allBookings: state.bookings,
          excludeBookingId: bookingId
        });

        if (collision.hasCollision) {
          throw new Error(collision.reason || "Dochází ke kolizi s jinou rezervací. První vytvořená rezervace má přednost.");
        }

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
        const token = get().token;
        await saveGroupEventToFirestore(event, token);
        set((state) => ({ groupEvents: [...state.groupEvents, event] }));
      },

      updateGroupEvent: async (updatedEvent) => {
        const token = get().token;
        await updateGroupEventInFirestore(updatedEvent, token);
        set((state) => ({
          groupEvents: state.groupEvents.map(e => e.id === updatedEvent.id ? updatedEvent : e)
        }));
      },

      deleteGroupEvent: async (eventId) => {
        const token = get().token;
        await deleteGroupEventFromFirestore(eventId, token);
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
          paymentStatus: (registration.paymentStatus as any) || 'unpaid',
          registeredAt: registration.registeredAt!
        };
        const result = await registerForGroupEvent(newRegistration);
        if (result.success) {
          set((state) => ({ 
            eventRegistrations: [
              ...state.eventRegistrations, 
              { 
                ...newRegistration, 
                paymentStatus: result.paymentUrl ? 'awaiting_payment' : 'paid',
                paymentUrl: result.paymentUrl 
              }
            ] 
          }));
          return result;
        }
        return { success: false };
      },

      adminMarkRegistrationAsPaid: async (regId) => {
        try {
          const state = get();
          const response = await fetch(`/api/admin/eventRegistrations/${regId}/paid`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${state.token}`
            }
          });
          if (response.status === 401) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth-unauthorized'));
            }
            return false;
          }
          if (response.ok) {
            set((state) => ({
              eventRegistrations: state.eventRegistrations.map((r) => 
                r.id === regId ? { ...r, paymentStatus: 'paid' } : r
              )
            }));
            return true;
          }
          return false;
        } catch (e) {
          console.error("Error marking registration as paid:", e);
          return false;
        }
      },

      adminCancelRegistration: async (regId) => {
        try {
          const state = get();
          const response = await fetch(`/api/admin/eventRegistrations/${regId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${state.token}`
            }
          });
          if (response.status === 401) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth-unauthorized'));
            }
            return false;
          }
          if (response.ok) {
            set((state) => {
              const cancelledReg = state.eventRegistrations.find(r => r.id === regId);
              let updatedEvents = state.groupEvents;
              if (cancelledReg) {
                updatedEvents = state.groupEvents.map(ev => 
                  ev.id === cancelledReg.eventId 
                    ? { ...ev, currentRegistrations: Math.max(0, (ev.currentRegistrations || 0) - 1) }
                    : ev
                );
              }
              return {
                groupEvents: updatedEvents,
                eventRegistrations: state.eventRegistrations.map((r) => 
                  r.id === regId ? { ...r, paymentStatus: 'cancelled' } : r
                )
              };
            });
            return true;
          }
          return false;
        } catch (e) {
          console.error("Error cancelling registration:", e);
          return false;
        }
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
                 // Fotku z konstant aplikujeme jen pokud lektor nemá nahranou vlastní (base64),
                 // ať se admin-nahraná fotka nepřepíše.
                 const currentImageUrl = newList[existingIdx].imageUrl;
                 if (!currentImageUrl || !currentImageUrl.startsWith('data:image/')) {
                     newList[existingIdx].imageUrl = practitioner.imageUrl;
                 }
             }
          }
          
          state.practitionersList = sortPractitioners(newList);
        }
        return state;
      }
    }
  )
);
