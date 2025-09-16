import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCaWiasGGDI0Ebe16UDlWisih6ZWOuTsGc",
  authDomain: "exam-lock-admin.firebaseapp.com",
  projectId: "exam-lock-admin",
  storageBucket: "exam-lock-admin.firebasestorage.app",
  messagingSenderId: "656389567575",
  appId: "1:656389567575:web:d610dcb5f8703aad34df12",
  measurementId: "G-EZ05T1JD1L"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Google Auth Provider
export const googleProvider = new GoogleAuthProvider();

// Auth function
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Error signing in with Google:", error);
    throw error;
  }
};

// Sign out function
export const signOut = async () => {
  try {
    await auth.signOut();
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};
