const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getDatabase, ref, get } = require('firebase/database');

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
const database = getDatabase(app);

async function main() {
  await signInWithEmailAndPassword(auth, "testuser@gmail.com", "password123");
  const deviceId = "PC-4DF300";

  const outputRef = ref(database, `devices/${deviceId}/jobOutput`);
  const snap = await get(outputRef);
  if (snap.exists()) {
    const jobs = snap.val();
    
    // Sort keys based on line timestamp if present
    const sortedKeys = Object.keys(jobs).sort((a, b) => {
      const maxTsA = Math.max(...Object.values(jobs[a]).map(line => line.ts || 0));
      const maxTsB = Math.max(...Object.values(jobs[b]).map(line => line.ts || 0));
      return maxTsA - maxTsB;
    });

    // Find the latest job that has an error/failed traceback
    let latestFailedKey = null;
    for (let i = sortedKeys.length - 1; i >= 0; i--) {
      const jobLines = Object.values(jobs[sortedKeys[i]]).map(l => l.text);
      if (jobLines.some(l => l.includes("Traceback") || l.includes("ERROR:"))) {
        latestFailedKey = sortedKeys[i];
        break;
      }
    }

    if (latestFailedKey) {
      console.log(`Latest Failed Job ID: ${latestFailedKey}`);
      const lines = Object.entries(jobs[latestFailedKey])
        .map(([k, v]) => ({ idx: parseInt(k), text: v.text }))
        .sort((a, b) => a.idx - b.idx);
      
      console.log("=== Job Output (Full Traceback) ===");
      lines.forEach(l => console.log(l.text));
      console.log("===================================");
    } else {
      console.log("No failed jobs found with traceback.");
    }
  } else {
    console.log("No job outputs found.");
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
