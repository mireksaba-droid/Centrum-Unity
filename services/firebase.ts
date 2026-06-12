import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, doc, updateDoc, deleteDoc, runTransaction, initializeFirestore, setDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Booking, Practitioner } from '../types';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
let db: any;
let functions: any;
let isFirebaseReady = false;

try {
  const app = initializeApp(firebaseConfig);
  // @ts-ignore - experimentalForceLongPolling is sometimes typed differently but works in v9/v10
  db = initializeFirestore(app, { experimentalForceLongPolling: true }, (firebaseConfig as any).firestoreDatabaseId);
  functions = getFunctions(app, 'europe-west1');
  isFirebaseReady = true;
} catch (e) {
  console.warn("Firebase failed to initialize. Running in Demo Mode.", e);
}

// --- RESEND BROWSER SDK WRAPPER ---
// Toto nám umožní používat kód z vašeho screenshotu (Node.js styl) přímo v prohlížeči.
// Simulujeme strukturu oficiálního SDK, ale používáme 'fetch' api prohlížeče.

export class ResendBrowserClient {
    private apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    get emails() {
        return {
            send: async (payload: { from: string, to: string | string[], subject: string, html: string, text?: string }) => {
                if (!this.apiKey) {
                    console.warn("⚠️ Resend API Key is missing.");
                    return { success: false, error: "Missing API Key" };
                }

                try {
                    const response = await fetch('https://api.resend.com/emails', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`
                        },
                        body: JSON.stringify({
                            from: payload.from,
                            to: Array.isArray(payload.to) ? payload.to : [payload.to],
                            subject: payload.subject,
                            html: payload.html,
                            text: payload.text
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.message || response.statusText);
                    }

                    const data = await response.json();
                    return { data, error: null };
                } catch (error) {
                    console.error("Resend Send Error:", error);
                    return { data: null, error };
                }
            }
        }
    }
}

// Inicializace klienta (stejně jako na screenshotu)
// @ts-ignore
const apiKey = typeof window !== 'undefined' ? window.process?.env?.RESEND_API_KEY || '' : '';
export const resend = new ResendBrowserClient(apiKey);


// --- PUBLIC SERVICES ---

/**
 * Creates a Stripe Payment Intent via Firebase Cloud Functions.
 */
export const createStripePaymentIntent = async (amount: number, currency: string = 'czk'): Promise<{ clientSecret: string }> => {
  if (!isFirebaseReady) {
    console.log("Mocking Cloud Function: createStripePaymentIntent");
    return new Promise<{ clientSecret: string }>((resolve) => setTimeout(() => resolve({ clientSecret: 'mock_secret_123' }), 1000));
  }

  const createPayment = httpsCallable(functions, 'createPaymentIntent');
  try {
    const result = await createPayment({ amount, currency });
    return result.data as { clientSecret: string };
  } catch (error) {
    console.error("Error creating payment intent:", error);
    throw error;
  }
};

/**
 * Legacy wrapper to keep existing code working, but now using our new 'resend' object.
 */
export const sendTransactionalEmail = async (payload: { to: string, subject: string, text: string, html?: string }) => {
    console.log("🚀 Odesílám email přes Resend (Browser Wrapper)...");
    
    // Zde používáme přesně tu syntaxi, kterou jste viděl v dokumentaci/screenshotu
    const { data, error } = await resend.emails.send({
        from: 'Centrum Unity <onboarding@resend.dev>', // Pro free tier musíme použít tuto doménu
        to: payload.to,
        subject: payload.subject,
        html: payload.html || `<p>${payload.text}</p>`,
        text: payload.text
    });

    if (error) {
        throw error;
    }

    console.log("✅ Email úspěšně odeslán:", data);
    return { success: true, id: data?.id };
};

export const saveBookingToFirestore = async (booking: Booking) => {
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Write:", booking);
        return true;
    }
    try {
        await setDoc(doc(db, 'bookings', booking.id), booking);
        return true;
    } catch (error) {
        console.error("Error saving booking:", error);
        return false;
    }
};

export const deleteAllBookingsFromFirestore = async () => {
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Clear (Bookings)");
        return true;
    }
    try {
        const querySnapshot = await getDocs(collection(db, 'bookings'));
        console.log(`Found ${querySnapshot.docs.length} bookings to delete.`);
        for (const doc of querySnapshot.docs) {
            console.log(`Deleting doc: ${doc.id}`);
            await deleteDoc(doc.ref);
        }
        console.log("Successfully cleared bookings.");
        return true;
    } catch (error) {
        console.error("Error clearing bookings:", error);
        return false;
    }
};

export const deleteAllGroupEventsFromFirestore = async () => {
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Clear (GroupEvents)");
        return true;
    }
    try {
        const querySnapshot = await getDocs(collection(db, 'groupEvents'));
        await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref)));
        return true;
    } catch (error) {
        console.error("Error clearing groupEvents:", error);
        return false;
    }
};

export const deleteAllEventRegistrationsFromFirestore = async () => {
    if (!isFirebaseReady) {
        console.log("Mocking Firestore Clear (EventRegistrations)");
        return true;
    }
    try {
        const querySnapshot = await getDocs(collection(db, 'eventRegistrations'));
        await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref)));
        return true;
    } catch (error) {
        console.error("Error clearing eventRegistrations:", error);
        return false;
    }
};

export const loadBookings = async () => {
    if (!isFirebaseReady) return [];
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
        await updateDoc(bookingRef, data);
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