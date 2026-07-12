import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import * as dotenv from 'dotenv';
dotenv.config();

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

async function check() {
  const snap = await getDoc(doc(db, "practitioners", "alena_b"));
  console.log("alena_b:", snap.data()?.imageUrl);
  const snap2 = await getDoc(doc(db, "practitioners", "b_ra_v"));
  console.log("b_ra_v:", snap2.data()?.imageUrl);
  const snap3 = await getDoc(doc(db, "practitioners", "pavel_m"));
  console.log("pavel_m:", snap3.data()?.imageUrl);
}
check().catch(console.error).then(() => process.exit(0));
