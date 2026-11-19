import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyChV_bSy5dlrkt0iTiE8g4_6W2ccePXXmc",
  authDomain: "gameplay-5ac93.firebaseapp.com",
  projectId: "gameplay-5ac93",
  storageBucket: "gameplay-5ac93.firebasestorage.app",
  messagingSenderId: "847147184244",
  appId: "1:847147184244:web:54c896facb3d5b1dec2121",
  measurementId: "G-B11FJ2R39J"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
