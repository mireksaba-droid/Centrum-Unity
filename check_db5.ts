import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

async function run() {
    const snap = await getDoc(doc(db, "practitioners", "alena_b"));
    console.log("Alena B in Firestore:", snap.data()?.imageUrl);
}
run().then(() => process.exit(0));
