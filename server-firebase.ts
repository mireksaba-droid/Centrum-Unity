import { initializeApp } from "firebase/app";
import { getFirestore, collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch, runTransaction, getDoc, DocumentReference } from "firebase/firestore";
import firebaseConfig from "./firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export { collection, doc, updateDoc, deleteDoc, getDocs, query, where, setDoc, writeBatch, runTransaction, getDoc, type DocumentReference };
