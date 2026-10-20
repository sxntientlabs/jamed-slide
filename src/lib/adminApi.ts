import { koasisApiUrl } from "./koasisApi";
import type { AdminConfig, PublicAdminCatalog } from "./adminConfig";

export type AdminSession = {
  authenticated: boolean;
  configured: boolean;
  persistenceConfigured: boolean;
};

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(koasisApiUrl(path), {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  let payload: unknown = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : `Admin backend gagal (HTTP ${response.status}).`;
    throw new Error(error);
  }
  return payload as T;
}

export function loadAdminSession(): Promise<AdminSession> {
  return requestJson<AdminSession>("/api/admin/session", { method: "GET" });
}

export function loginAdmin(password: string): Promise<AdminSession> {
  return requestJson<AdminSession>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function logoutAdmin(): Promise<AdminSession> {
  return requestJson<AdminSession>("/api/admin/logout", { method: "POST", body: "{}" });
}

export async function loadAdminConfig(): Promise<{ config: AdminConfig; persistenceConfigured: boolean }> {
  return requestJson<{ config: AdminConfig; persistenceConfigured: boolean }>("/api/admin/config", { method: "GET" });
}

export async function saveAdminConfig(config: AdminConfig): Promise<{ config: AdminConfig; persistenceConfigured: boolean }> {
  return requestJson<{ config: AdminConfig; persistenceConfigured: boolean }>("/api/admin/config", { method: "PUT", body: JSON.stringify({ config }) });
}

export async function loadPublicAdminCatalog(): Promise<PublicAdminCatalog> {
  const payload = await requestJson<{ catalog: PublicAdminCatalog }>("/api/catalog", { method: "GET" });
  return payload.catalog;
}

