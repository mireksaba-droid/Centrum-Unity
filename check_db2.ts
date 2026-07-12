import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from './firebase-applet-config.json';
import * as dotenv from 'dotenv';
dotenv.config();

const app = initializeApp({
  credential: cert(serviceAccount)
});
const db = getFirestore(app);

async function check() {
  const snap = await db.collection("practitioners").doc("alena_b").get();
  console.log("alena_b:", snap.data());
  const snap2 = await db.collection("practitioners").doc("b_ra_v").get();
  console.log("b_ra_v:", snap2.data());
  const snap3 = await db.collection("practitioners").doc("pavel_m").get();
  console.log("pavel_m:", snap3.data());
}
check().catch(console.error);
