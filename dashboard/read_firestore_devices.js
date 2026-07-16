const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  await signInWithEmailAndPassword(auth, "testuser@gmail.com", "password123");
  const uid = auth.currentUser.uid;

  const devicesRef = collection(db, "devices");
  const q = query(devicesRef, where("ownerId", "==", uid));
  const snap = await getDocs(q);
  
  console.log("=== Firestore Registered Devices ===");
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`- Device Document ID: ${doc.id}`);
    console.log(`  DeviceID field: ${data.deviceId}`);
    console.log(`  Name: ${data.name}`);
    console.log(`  Role: ${data.role}`);
  });
  console.log("=====================================");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
