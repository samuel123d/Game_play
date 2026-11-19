import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyChV_bSy5dlrkt0iTiE8g4_6W2ccePXXmc",
  authDomain: "gameplay-5ac93.firebaseapp.com",
  projectId: "gameplay-5ac93",
  storageBucket: "gameplay-5ac93.firebasestorage.app",
  messagingSenderId: "847147184244",
  appId: "1:847147184244:web:54c896facb3d5b1dec2121",
  measurementId: "G-B11FJ2R39J"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

isSupported().then((supported) => {
  if (supported) {
    getAnalytics(app);
  }
}).catch(() => {});

// Sessao anonima automatica: o jogador nunca ve tela de login
export function ensureAnonymousSession() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        unsubscribe();
        resolve(user);
        return;
      }
      try {
        const cred = await signInAnonymously(auth);
        unsubscribe();
        resolve(cred.user);
      } catch (err) {
        unsubscribe();
        reject(err);
      }
    });
  });
}
