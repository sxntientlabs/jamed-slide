import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim() || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim() || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim() || "",
};

export const firebaseConfigKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

const configKeyByEnvName: Record<(typeof firebaseConfigKeys)[number], keyof typeof firebaseConfig> = {
  VITE_FIREBASE_API_KEY: "apiKey",
  VITE_FIREBASE_AUTH_DOMAIN: "authDomain",
  VITE_FIREBASE_PROJECT_ID: "projectId",
  VITE_FIREBASE_STORAGE_BUCKET: "storageBucket",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "messagingSenderId",
  VITE_FIREBASE_APP_ID: "appId",
};

export const missingFirebaseConfig = firebaseConfigKeys.filter((key) => {
  return !firebaseConfig[configKeyByEnvName[key]];
});

let firebaseApp: FirebaseApp | null = null;
let firebaseInitError = "";

if (!missingFirebaseConfig.length) {
  try {
    firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  } catch (error) {
    firebaseInitError = error instanceof Error ? error.message : "Firebase gagal diinisialisasi.";
  }
}

export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const firestore: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;
export const firebaseReady = Boolean(firebaseApp && firebaseAuth && firestore);

export function getFirebaseSetupError(): string {
  if (firebaseInitError) return `Firebase tidak bisa diinisialisasi: ${firebaseInitError}`;
  if (missingFirebaseConfig.length) return "Konfigurasi Firebase untuk browser belum lengkap.";
  return "";
}

export async function signInWithGoogleAccount() {
  if (!firebaseAuth) throw new Error(getFirebaseSetupError());
  return signInWithPopup(firebaseAuth, new GoogleAuthProvider());
}

export async function signInWithEmailAccount(email: string, password: string) {
  if (!firebaseAuth) throw new Error(getFirebaseSetupError());
  return signInWithEmailAndPassword(firebaseAuth, email, password);
}

export async function createEmailAccount(email: string, password: string, displayName: string) {
  if (!firebaseAuth) throw new Error(getFirebaseSetupError());
  const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  if (displayName.trim()) await updateProfile(credential.user, { displayName: displayName.trim() });
  return credential;
}

export async function resetEmailPassword(email: string) {
  if (!firebaseAuth) throw new Error(getFirebaseSetupError());
  return sendPasswordResetEmail(firebaseAuth, email);
}

export async function signOutCurrentAccount() {
  if (!firebaseAuth) return;
  return signOut(firebaseAuth);
}

export function firebaseErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const messages: Record<string, string> = {
    "auth/invalid-credential": "Email atau password tidak benar.",
    "auth/invalid-login-credentials": "Email atau password tidak benar.",
    "auth/user-not-found": "Akun dengan email tersebut belum ditemukan.",
    "auth/wrong-password": "Email atau password tidak benar.",
    "auth/email-already-in-use": "Email ini sudah terdaftar. Silakan masuk.",
    "auth/weak-password": "Password terlalu lemah. Gunakan minimal 6 karakter.",
    "auth/invalid-email": "Format email belum valid.",
    "auth/popup-closed-by-user": "Jendela login Google ditutup sebelum selesai.",
    "auth/popup-blocked": "Popup login diblokir browser. Izinkan popup lalu coba lagi.",
    "auth/unauthorized-domain": "Domain aplikasi ini belum ditambahkan ke Authorized domains Firebase.",
    "auth/operation-not-allowed": "Provider login ini belum diaktifkan di Firebase Console.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
    "auth/network-request-failed": "Koneksi ke Firebase gagal. Periksa jaringan lalu coba lagi.",
  };
  if (messages[code]) return messages[code];
  if (error instanceof Error && error.message) return error.message;
  return "Login belum berhasil. Coba lagi.";
}

export interface WorkspaceMetadata {
  schemaVersion: 1;
  shift: {
    title: string;
    date: string;
    department: string;
    hospital: string;
    team: string;
    facilitator: string;
    dpjp: string;
  };
  template: {
    id: string;
    name: string;
    fileName: string;
    profileId: string;
    slideCount: number;
    analysisStatus: string;
  };
}

function workspaceDocument(userId: string) {
  if (!firestore) throw new Error(getFirebaseSetupError());
  return doc(firestore, "users", userId, "workspaces", "default");
}

export async function loadWorkspaceMetadata(userId: string): Promise<WorkspaceMetadata | null> {
  const snapshot = await getDoc(workspaceDocument(userId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (!data || data.schemaVersion !== 1 || !data.shift || !data.template) return null;
  return data as WorkspaceMetadata;
}

export async function saveWorkspaceMetadata(userId: string, metadata: WorkspaceMetadata): Promise<void> {
  await setDoc(workspaceDocument(userId), {
    ...metadata,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export type FirebaseUser = User;
