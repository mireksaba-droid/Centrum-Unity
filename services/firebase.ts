import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, deleteDoc, runTransaction, initializeFirestore, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Booking, Practitioner } from '../types';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
let db: any;
let functions: any;
let isFirebaseReady = false;

let authInitPromise: Promise<void> | null = null;

try {
  const app = initializeApp(firebaseConfig);
  // @ts-ignore
  db = initializeFirestore(app, { experimentalForceLongPolling: true }, (firebaseConfig as any).firestoreDatabaseId);
  functions = getFunctions(app, 'europe-west1');
  
  // Firebase Auth is not used; we rely on JWT and public Firestore reads.
  
  isFirebaseReady = true;
} catch (e) {
  console.warn("Firebase failed to initialize. Running in Demo Mode.", e);
}

// True = data se NEUKLÁDAJÍ do databáze (běží demo/mock režim). Slouží k varování v adminu.
export const isDemoMode = (): boolean => !isFirebaseReady;

// Pomocná funkce pro čekání na dokončení Firebase Auth
export const waitForAuth = async (): Promise<void> => {
  // We cannot use anonymous auth because it's not enabled by default.
  // The app currently relies on locally checked PINs.
};

// --- PUBLIC SERVICES ---

/**
 * Legacy wrapper to keep existing code working, but now using our new 'resend' object.
 */
export const sendTransactionalEmail = async (payload: { to: string, subject: string, text: string, html?: string }) => {
    console.log("🚀 Odesílám email přes backend API...");
    
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;

        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
                to: payload.to,
                subject: payload.subject,
                html: payload.html || `<p>${payload.text}</p>`,
                text: payload.text
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            throw new Error(errorData?.error || response.statusText);
        }

        const data = await response.json();
        console.log("✅ Email úspěšně odeslán:", data);
        return { success: true, id: data?.data?.id };
    } catch (error) {
        console.error("Chyba při odesílání přes backend:", error);
        throw error;
    }
};

export const saveBookingToFirestore = async (booking: Booking) => {
    // Try server-side API first if we have an admin JWT token
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;
        if (token) {
            const response = await fetch('/api/bookings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(booking)
            });
            if (response.ok) {
                const resData = await response.json();
                if (resData.success) return true;
                if (resData.error) throw new Error(resData.error);
            } else {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error || `Chyba při ukládání rezervace (${response.status})`);
            }
        }
    } catch (error: any) {
        console.warn("Server-side saveBooking error:", error);
        // Pokud jde o kolizi nebo obsazený slot, okamžitě vyhodíme chybu – první rezervace má přednost!
        if (error.message && (error.message.includes("koliz") || error.message.includes("rezervován") || error.message.includes("přednost") || error.message.includes("obsazen"))) {
            throw error;
        }
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write:", booking);
        return true;
    }
    try {
        const { checkBookingCollision } = await import('../utils/scheduler');
        // Validace kolizí přímo proti Firestore
        const q = query(collection(db, 'bookings'), where('date', '==', booking.date));
        const snapshot = await getDocs(q);
        const existingBookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Booking[];

        const collision = checkBookingCollision({
            newDate: booking.date,
            newTime: booking.time,
            durationMinutes: Number(booking.durationMinutes) || 60,
            room: Number(booking.room) as 1 | 2,
            userId: booking.bookedByUserId,
            allBookings: existingBookings,
            excludeBookingId: booking.id
        });

        if (collision.hasCollision) {
            const conflictName = collision.conflictingBooking?.bookedByName || 'jiným lektorem';
            const conflictTime = collision.conflictingBooking ? `${collision.conflictingBooking.time} (${collision.conflictingBooking.durationMinutes} min)` : '';
            throw new Error(`Termín nelze zarezervovat: dochází ke kolizi s dříve vytvořenou rezervací (${conflictName}${conflictTime ? ` v ${conflictTime}` : ''}). První vytvořená rezervace má přednostní právo.`);
        }

        const bookingRef = doc(db, 'bookings', booking.id);
        await runTransaction(db, async (transaction) => {
            const bookingDoc = await transaction.get(bookingRef);
            if (bookingDoc.exists()) {
                const existing = bookingDoc.data() as any;
                // Zrušené / refundované rezervace neblokují termín - povolíme je přepsat.
                // Blokujeme jen aktivní rezervace.
                if (!['cancelled', 'refunded'].includes(existing?.status)) {
                    throw new Error("Tento termín je již rezervován dřívější rezervací. První vytvořená rezervace má přednost.");
                }
            }
            transaction.set(bookingRef, booking as any);
        });
        return true;
    } catch (error) {
        console.error("Error saving booking:", error);
        throw error;
    }
};

export const loadBookings = async () => {
    // Try server-side public API first (extremely robust and bypasses CORS/client policy blocks)
    try {
        const res = await fetch('/api/public-bookings');
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.warn("Public API for bookings failed, falling back to direct Firestore:", e);
    }

    if (!isFirebaseReady) return [];
    await waitForAuth();
    try {
        const q = query(collection(db, 'bookings'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Booking));
    } catch (error) {
        console.error("Error loading bookings:", error);
        
        // Log additional info for debugging
        const errInfo = {
            message: error instanceof Error ? error.message : String(error),
            operation: 'GET',
            path: 'bookings',
        };
        console.error('Firestore Debug:', JSON.stringify(errInfo));
        
        throw error;
    }
};

export const updateBookingInFirestore = async (bookingId: string, data: Partial<Booking>) => {
    // Try server-side API first if we have an admin JWT token
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;
        if (token) {
            const response = await fetch(`/api/bookings/${bookingId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(data)
            });
            if (response.ok) {
                const resData = await response.json();
                if (resData.success) return true;
            }
        }
    } catch (error) {
        console.warn("Server-side updateBooking failed, falling back to direct Firestore:", error);
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Update (Booking):", bookingId, data);
        return true;
    }
    try {
        const bookingRef = doc(db, 'bookings', bookingId);
        await updateDoc(bookingRef, data as any);
        return true;
    } catch (error) {
        console.error("Error updating booking:", error);
        return false;
    }
};

export const deleteBookingFromFirestore = async (bookingId: string) => {
    // Try server-side API first if we have an admin JWT token
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;
        if (token) {
            const response = await fetch(`/api/bookings/${bookingId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const resData = await response.json();
                if (resData.success) return true;
            }
        }
    } catch (error) {
        console.warn("Server-side deleteBooking failed, falling back to direct Firestore:", error);
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Delete (Booking):", bookingId);
        return true;
    }
    try {
        const bookingRef = doc(db, 'bookings', bookingId);
        await deleteDoc(bookingRef);
        return true;
    } catch (error) {
        console.error("Error deleting booking:", error);
        return false;
    }
};


// --- PRACTITIONER SERVICES ---

export const loadPractitioners = async (token?: string | null): Promise<Practitioner[]> => {
    // Try server-side public API first (extremely robust and bypasses CORS/client policy blocks)
    try {
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch('/api/practitioners', { headers });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.warn("Public API for practitioners failed, falling back to direct Firestore:", e);
    }

    if (!isFirebaseReady) return [];
    await waitForAuth();
    try {
        const q = query(collection(db, 'practitioners'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Practitioner));
    } catch (error) {
        console.error("Error loading practitioners:", error);
        return [];
    }
};

export const savePractitionerToFirestore = async (practitioner: Practitioner) => {
    // Try server-side API first if we have an admin JWT token
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;
        if (token) {
            const response = await fetch('/api/practitioners', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(practitioner)
            });
            if (response.ok) {
                const resData = await response.json();
                if (resData.success) return true;
            }
        }
    } catch (error) {
        console.warn("Server-side savePractitioner failed, falling back to direct Firestore:", error);
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write (Practitioner):", practitioner);
        return true;
    }
    try {
        const docRef = doc(db, 'practitioners', practitioner.id);
        await setDoc(docRef, practitioner as any);
        return true;
    } catch (error) {
        console.error("Error saving practitioner:", error);
        return false;
    }
};

export const updatePractitionerInFirestore = async (practitioner: Practitioner) => {
    // Try server-side API first if we have an admin JWT token
    try {
        const { useStore } = await import('../store/useStore');
        const token = useStore.getState().token;
        if (token) {
            const response = await fetch('/api/practitioners', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(practitioner)
            });
            if (response.ok) {
                const resData = await response.json();
                if (resData.success) return true;
            }
        }
    } catch (error) {
        console.warn("Server-side updatePractitioner failed, falling back to direct Firestore:", error);
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Update (Practitioner):", practitioner);
        return true;
    }
    try {
        const practitionerRef = doc(db, 'practitioners', practitioner.id);
        await updateDoc(practitionerRef, practitioner as any);
        return true;
    } catch (error) {
        console.error("Error updating practitioner:", error);
        return false;
    }
};

// --- GROUP EVENTS SERVICES ---
export const saveGroupEventToFirestore = async (event: any, token?: string | null) => {
    // Try server-side API first if we have an admin JWT token
    if (token) {
        try {
            const response = await fetch('/api/groupEvents', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(event)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success) return true;
            }
        } catch (error) {
            console.warn("Server-side saveGroupEvent failed, falling back to direct Firestore:", error);
        }
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write (GroupEvent):", event);
        return true;
    }
    try {
        await setDoc(doc(db, 'groupEvents', event.id), event);
        return true;
    } catch (error) {
        console.error("Error saving group event:", error);
        return false;
    }
};

export const updateGroupEventInFirestore = async (event: any, token?: string | null) => {
    // Try server-side API first if we have an admin JWT token
    if (token) {
        try {
            const response = await fetch(`/api/groupEvents/${event.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(event)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success) return true;
            }
        } catch (error) {
            console.warn("Server-side updateGroupEvent failed, falling back to direct Firestore:", error);
        }
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Update (GroupEvent):", event);
        return true;
    }
    try {
        const eventRef = doc(db, 'groupEvents', event.id);
        await updateDoc(eventRef, event);
        return true;
    } catch (error) {
        console.error("Error updating group event:", error);
        return false;
    }
};

export const deleteGroupEventFromFirestore = async (eventId: string, token?: string | null) => {
    // Try server-side API first if we have an admin JWT token
    if (token) {
        try {
            const response = await fetch(`/api/groupEvents/${eventId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                if (data.success) return true;
            }
        } catch (error) {
            console.warn("Server-side deleteGroupEvent failed, falling back to direct Firestore:", error);
        }
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Delete (GroupEvent):", eventId);
        return true;
    }
    try {
        const eventRef = doc(db, 'groupEvents', eventId);
        await deleteDoc(eventRef);
        return true;
    } catch (error) {
        console.error("Error deleting group event:", error);
        return false;
    }
};

export const registerForGroupEvent = async (registration: any): Promise<{ success: boolean; paymentUrl?: string }> => {
    // Try server-side public API first (extremely robust and bypasses CORS/client policy blocks)
    try {
        const response = await fetch('/api/eventRegistrations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(registration)
        });
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                return { success: true, paymentUrl: data.paymentUrl };
            }
        }
    } catch (e) {
        console.warn("Server-side registration failed, falling back to client-side transaction:", e);
    }

    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write (EventRegistration):", registration);
        return { success: true };
    }
    try {
        await runTransaction(db, async (transaction) => {
            const eventRef = doc(db, 'groupEvents', registration.eventId);
            const eventDoc = await transaction.get(eventRef);

            if (!eventDoc.exists()) {
                throw new Error("Event does not exist!");
            }

            const currentRegistrations = eventDoc.data().currentRegistrations || 0;
            const capacity = eventDoc.data().capacity || 0;

            if (currentRegistrations >= capacity) {
                throw new Error("Capacity full");
            }

            // Create or get a reference for the registration
            const newRegistrationRef = registration.id 
                ? doc(db, 'eventRegistrations', registration.id) 
                : doc(collection(db, 'eventRegistrations'));
            
            // Add the registration document
            transaction.set(newRegistrationRef, {
                ...registration,
                id: newRegistrationRef.id
            });

            // Increment the currentRegistrations count
            transaction.update(eventRef, {
                currentRegistrations: currentRegistrations + 1
            });
        });
        return { success: true };
    } catch (error) {
        console.error("Error registering for event:", error);
        return { success: false };
    }
};

export const loadGroupEvents = async (): Promise<any[]> => {
    // Try server-side public API first (extremely resilient)
    try {
        const res = await fetch('/api/public-group-events');
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.warn("Public API for group events failed, falling back to direct Firestore:", e);
    }

    if (!isFirebaseReady) return [];
    await waitForAuth();
    try {
        const q = query(collection(db, 'groupEvents'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error loading group events via direct Firestore:", error);
        return [];
    }
};

export const loadEventRegistrations = async (token?: string | null): Promise<any[]> => {
    // Try authenticated admin API first if token is available
    if (token) {
        try {
            const res = await fetch('/api/admin/eventRegistrations', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                return await res.json();
            }
            if (res.status === 401) {
                console.warn("Admin API for event registrations unauthorized - token may be expired.");
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('auth-unauthorized'));
                }
                return [];
            }
        } catch (e) {
            console.warn("Admin API for event registrations failed:", e);
        }
        return []; // Do not fall back to public anonymized endpoint if we are supposed to be an authenticated admin
    }

    // Otherwise try server-side public API (returns anonymized data for capacity calculations)
    try {
        const res = await fetch('/api/public-event-registrations');
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.warn("Public API for event registrations failed, falling back to direct Firestore:", e);
    }

    if (!isFirebaseReady) return [];
    await waitForAuth();
    try {
        const q = query(collection(db, 'eventRegistrations'));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error loading event registrations via direct Firestore:", error);
        return [];
    }
};