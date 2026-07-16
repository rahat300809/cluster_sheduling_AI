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
  console.log("Logged in!");

  const uid = auth.currentUser.uid;
  const jobsRef = collection(db, "jobs");
  const q = query(jobsRef, where("ownerId", "==", uid));
  const snap = await getDocs(q);
  
  const jobs = [];
  snap.forEach(doc => {
    jobs.push({ id: doc.id, ...doc.data() });
  });

  // Sort by createdAt descending
  jobs.sort((a, b) => b.createdAt - a.createdAt);

  console.log("=== Latest 5 Jobs ===");
  jobs.slice(0, 5).forEach(data => {
    console.log(`- Job ID: ${data.id}`);
    console.log(`  Name: ${data.name}`);
    console.log(`  Status: ${data.status}`);
    console.log(`  Created: ${new Date(data.createdAt).toISOString()}`);
    console.log(`  Error: ${data.errorMessage || "none"}`);
  });
  console.log("=====================");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
