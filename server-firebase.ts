import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch, runTransaction, getDoc, deleteField, DocumentReference, setLogLevel } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

// Nastavíme log level na 'error', aby Firestore v Node.js nepotlačoval běžný běh
// a nezapisoval přechodná odpojení nečinných gRPC spojení (Code: 14 UNAVAILABLE: Connection dropped)
// do stderr, jelikož Firestore tato spojení automaticky a bezpečně obnovuje.
setLogLevel("error");

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export { collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch, runTransaction, getDoc, deleteField, setLogLevel, type DocumentReference };

