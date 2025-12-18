// Firebase Config
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

export const firebaseConfig = {
    apiKey: "AIzaSyDCVMVV6c7WQPzNhEW6HVGQZaGCKmAwtxQ",
  authDomain: "newpos-dcd8a.firebaseapp.com",
  projectId: "newpos-dcd8a",
  storageBucket: "newpos-dcd8a.firebasestorage.app",
  messagingSenderId: "767620829912",
  appId: "1:767620829912:web:8e1793ce49c5ef6982fdad",
  measurementId: "G-KDZXH897RC"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

