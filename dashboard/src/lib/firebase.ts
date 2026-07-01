import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCztIY9eLPlUZ9c0YOlnd3vGEayMASBfT8",
  authDomain: "cluster300809.firebaseapp.com",
  projectId: "cluster300809",
  storageBucket: "cluster300809.firebasestorage.app",
  messagingSenderId: "20913972540",
  appId: "1:20913972540:web:06e9b37080dcfa5ca0aa39",
  measurementId: "G-6T4C9XDM10",
  databaseURL: "https://cluster300809-default-rtdb.firebaseio.com"
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export default app;
