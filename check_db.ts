import "dotenv/config";
import { getDoc, doc, db } from "./server-firebase";

async function check() {
  const snap = await getDoc(doc(db, "practitioners", "alena_b"));
  console.log(snap.data());
}
check();
