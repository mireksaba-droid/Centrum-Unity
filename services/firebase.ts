import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, deleteDoc, runTransaction, initializeFirestore, setDoc, memoryLocalCache } from 'firebase/firestore';
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
  db = initializeFirestore(app, { 
    experimentalForceLongPolling: true,
    localCache: memoryLocalCache()
  }, (firebaseConfig as any).firestoreDatabaseId);
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
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write:", booking);
        return true;
    }
    try {
        const bookingRef = doc(db, 'bookings', booking.id);
        await runTransaction(db, async (transaction) => {
            const bookingDoc = await transaction.get(bookingRef);
            if (bookingDoc.exists()) {
                const existing = bookingDoc.data() as any;
                // Zrušené / refundované rezervace nblokují termín - povolíme je přepsat.
                // Blokujeme jen aktivní rezervace.
                if (!['cancelled', 'refunded'].includes(existing?.status)) {
                    throw new Error("Tento termín je již rezervován. Prosím, obnovte stránku a vyberte jiný čas.");
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

export const loadPractitioners = async (): Promise<Practitioner[]> => {
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
export const saveGroupEventToFirestore = async (event: any) => {
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

export const updateGroupEventInFirestore = async (event: any) => {
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

export const deleteGroupEventFromFirestore = async (eventId: string) => {
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

export const registerForGroupEvent = async (registration: any) => {
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write (EventRegistration):", registration);
        return true;
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
        return true;
    } catch (error) {
        console.error("Error registering for event:", error);
        return false;
    }
};