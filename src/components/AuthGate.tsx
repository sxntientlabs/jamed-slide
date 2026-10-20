import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import {
  createEmailAccount,
  firebaseAuth,
  firebaseErrorMessage,
  firebaseReady,
  resetEmailPassword,
  signInWithEmailAccount,
  signInWithGoogleAccount,
  signOutCurrentAccount,
  type FirebaseUser,
} from "../lib/firebase";

interface AuthContextValue {
  user: FirebaseUser;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth harus digunakan di dalam AuthGate.");
  return context;
}

function initials(user: FirebaseUser): string {
  const value = user.displayName?.trim() || user.email?.split("@")[0] || "K";
  return value.slice(0, 1).toUpperCase();
}

function AuthLoadingScreen() {
  return (
    <main className="auth-shell auth-loading-shell">
      <div className="auth-loading-card" role="status" aria-live="polite">
        <img src="/koasis-favicon.png" alt="Koasis" className="auth-loading-mark" />
        <span className="auth-loading-orbit" aria-hidden="true" />
        <p>Menyiapkan workspace Koasis…</p>
      </div>
    </main>
  );
}

function FirebaseSetupScreen() {
  return (
    <main className="auth-shell auth-setup-shell">
      <section className="auth-brand-panel">
        <img src="/koasis-wordmark.png" alt="Koasis — Your Clinical Oasis" className="auth-wordmark" />
        <div className="auth-brand-copy">
          <span className="eyebrow">Workspace belum siap</span>
          <h1>Koasis sedang menyiapkan workspace kamu.</h1>
          <p>Pengaturan aplikasi belum lengkap, jadi workspace belum dapat dibuka. Coba lagi nanti atau hubungi pengelola Koasis.</p>
        </div>
      </section>
      <section className="auth-panel auth-setup-panel">
        <div className="auth-panel-icon"><KeyRound size={20} /></div>
        <span className="eyebrow">Penyiapan workspace</span>
        <h2>Coba lagi nanti</h2>
        <p className="auth-panel-description">Koasis belum dapat membuka layanan akun saat ini. Tidak ada tindakan yang perlu kamu lakukan di halaman ini.</p>
        <div className="auth-setup-note"><ShieldCheck size={15} /> Jika masalah berlanjut, hubungi pengelola Koasis.</div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M21.35 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.42z" />
      <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.5z" />
      <path fill="#FBBC05" d="M6.54 12.61a5.86 5.86 0 0 1 0-3.72V6.36H3.29a9.5 9.5 0 0 0 0 8.78l3.25-2.53z" />
      <path fill="#EA4335" d="M12 4.86c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.83 1.95 14.62 1 12 1a9.74 9.74 0 0 0-8.71 5.36l3.25 2.53C7.31 6.58 9.46 4.86 12 4.86z" />
    </svg>
  );
}

function LoginScreen() {
  const isLegacyRoute = (window.location.pathname.replace(/\/+$/, "") || "/") === "/lapjag";
  const headline = "Assitant Koas-mu";
  const loginDescription = isLegacyRoute ? "Masuk untuk melanjutkan laporan jaga kamu." : "Masuk untuk memulai workspace agentic kamu.";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [typedHeadline, setTypedHeadline] = useState("");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTypedHeadline(headline);
      return undefined;
    }
    let index = 0;
    let timer = 0;
    const typeNext = () => {
      index += 1;
      setTypedHeadline(headline.slice(0, index));
      if (index < headline.length) timer = window.setTimeout(typeNext, 82);
    };
    timer = window.setTimeout(typeNext, 260);
    return () => window.clearTimeout(timer);
  }, []);

  const submitLabel = mode === "signin" ? "Masuk ke workspace" : "Buat akun Koasis";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError("Email dan password wajib diisi.");
      return;
    }
    if (mode === "signup" && password !== passwordConfirmation) {
      setError("Konfirmasi password belum sama.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") await signInWithEmailAccount(normalizedEmail, password);
      else await createEmailAccount(normalizedEmail, password, displayName);
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setNotice("");
    setGoogleBusy(true);
    try {
      await signInWithGoogleAccount();
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleReset = async () => {
    setError("");
    setNotice("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Isi email terlebih dahulu untuk menerima link reset password.");
      return;
    }
    setBusy(true);
    try {
      await resetEmailPassword(normalizedEmail);
      setNotice("Link reset password sudah dikirim. Periksa inbox email kamu.");
    } catch (authError) {
      setError(firebaseErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <img src="/koasis-wordmark.png" alt="Koasis — Your Clinical Oasis" className="auth-wordmark" />
        <div className="auth-brand-copy">
          <span className="eyebrow">Your clinical oasis</span>
          <div className="auth-typing-title">
            <h1 aria-label={headline}><span>{typedHeadline}</span><span className="auth-typing-cursor" aria-hidden="true" /></h1>
            <svg className="auth-medical-trace" viewBox="0 0 360 40" preserveAspectRatio="none" aria-hidden="true">
              <path className="auth-medical-trace-base" pathLength="1" d="M2 20H72L80 20L89 7L98 33L108 20H146C152 20 155 14 160 14C165 14 168 26 174 26C180 26 183 20 190 20H358" />
              <path className="auth-medical-trace-scan" pathLength="1" d="M2 20H72L80 20L89 7L98 33L108 20H146C152 20 155 14 160 14C165 14 168 26 174 26C180 26 183 20 190 20H358" />
              <circle className="auth-medical-trace-beacon" cx="89" cy="7" r="3" />
            </svg>
          </div>
        </div>
        <div className="auth-trust-list">
          <div><Check size={14} /><span>Workspace privat per akun</span></div>
          <div><Check size={14} /><span>Referensi relevan dan evidence-based</span></div>
          <div><Check size={14} /><span>Agent spesialis siap konsul</span></div>
        </div>
      </section>

      <section className="auth-panel">
        <span className="eyebrow">Workspace privat</span>
        <h2>{mode === "signin" ? "Selamat datang kembali." : "Mulai workspace Koasis."}</h2>
        <p className="auth-panel-description">{loginDescription}</p>

        <button className="auth-google-button" type="button" onClick={handleGoogle} disabled={busy || googleBusy}>
          <GoogleMark />
          {googleBusy ? "Membuka login Google…" : "Lanjutkan dengan Google"}
        </button>
        <div className="auth-divider"><span>atau dengan email</span></div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && <label className="auth-field"><span>Nama tampilan</span><div className="auth-input-wrap"><UserRound size={15} /><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Nama kamu" autoComplete="name" /></div></label>}
          <label className="auth-field"><span>Email</span><div className="auth-input-wrap"><Mail size={15} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nama@email.com" autoComplete="email" /></div></label>
          <label className="auth-field"><span>Password</span><div className="auth-input-wrap"><KeyRound size={15} /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Minimal 6 karakter" autoComplete={mode === "signin" ? "current-password" : "new-password"} /><button className="auth-password-toggle" type="button" aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></label>
          {mode === "signup" && <label className="auth-field"><span>Konfirmasi password</span><div className="auth-input-wrap"><KeyRound size={15} /><input type={showPassword ? "text" : "password"} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Ulangi password" autoComplete="new-password" /></div></label>}
          {mode === "signin" && <button className="auth-reset-button" type="button" onClick={handleReset} disabled={busy || googleBusy}>Lupa password?</button>}
          {error && <div className="auth-message error" role="alert">{error}</div>}
          {notice && <div className="auth-message success" role="status">{notice}</div>}
          <button className="button button-dark auth-submit" type="submit" disabled={busy || googleBusy}>{busy ? "Memproses…" : submitLabel}<ArrowRight size={16} /></button>
        </form>

        <div className="auth-mode-switch"><span>{mode === "signin" ? "Belum punya akun?" : "Sudah punya akun?"}</span><button type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{mode === "signin" ? "Buat akun" : "Masuk"}</button></div>
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseAuth || !firebaseReady) {
      setLoading(false);
      return undefined;
    }
    return firebaseAuth.onAuthStateChanged((nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const contextValue = useMemo<AuthContextValue | null>(() => user ? { user, signOut: signOutCurrentAccount } : null, [user]);

  if (!firebaseReady) return <FirebaseSetupScreen />;
  if (loading) return <AuthLoadingScreen />;
  if (!user) return <LoginScreen />;
  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function userInitial(user: FirebaseUser): string {
  return initials(user);
}
