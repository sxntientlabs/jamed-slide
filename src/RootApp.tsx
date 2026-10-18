import { lazy, Suspense } from "react";
import { AgenticChat } from "./components/AgenticChat";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";

const LegacyLaporanJaga = lazy(() => import("./App"));

function RouteLoading() {
  return <main className="auth-shell auth-loading-shell"><div className="auth-loading-card" role="status" aria-live="polite"><img src="/koasis-favicon.png" alt="Koasis" className="auth-loading-mark" /><span className="auth-loading-orbit" aria-hidden="true" /><p>Menyiapkan workspace…</p></div></main>;
}

export default function RootApp() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/lapjag") return <Suspense fallback={<RouteLoading />}><LegacyLaporanJaga /></Suspense>;
  return <AuthGate><AgenticChat /></AuthGate>;
}
