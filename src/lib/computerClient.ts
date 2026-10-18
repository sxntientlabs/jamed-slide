import { koasisApiUrl } from "./koasisApi";

export type ComputerMachineState = "creating" | "starting" | "running" | "stopping" | "stopped" | "suspending" | "suspended" | "resuming" | "deleting" | "deleted" | "error";

export type ComputerMachine = {
  id: string;
  name: string;
  state: ComputerMachineState;
  desiredState: ComputerMachineState;
  ready: boolean;
  templateId: string;
  vcpus: number;
  memoryMiB: number;
  storageGiB: number;
  timeoutAt?: string | null;
  autoSuspendAfterSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ComputerStatus = {
  configured: boolean;
  provisioningEnabled: boolean;
  machine: ComputerMachine | null;
  activeSession?: {
    id: string;
    viewOnly: boolean;
    expiresAt: string;
    status: "active" | "revoked";
  } | null;
};

export type ComputerSession = {
  sessionId: string;
  machine: ComputerMachine;
  streamUrl: string;
  expiresAt: string;
  viewOnly: boolean;
};

export class ComputerClientError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ComputerClientError";
    this.code = code;
  }
}

type ComputerClientOptions = {
  authToken?: string;
  signal?: AbortSignal;
};

async function request<T>(path: string, init: RequestInit, options: ComputerClientOptions): Promise<T> {
  const response = await fetch(koasisApiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
      ...(init.headers || {}),
    },
    signal: options.signal,
  });
  if (!response.ok) {
    try {
      const payload = await response.json() as { error?: string; code?: string };
      throw new ComputerClientError(payload.error || `Computer backend gagal (HTTP ${response.status}).`, payload.code);
    } catch (error) {
      if (error instanceof ComputerClientError) throw error;
      throw new ComputerClientError(`Computer backend gagal (HTTP ${response.status}).`);
    }
  }
  return await response.json() as T;
}

export function getComputerStatus(options: ComputerClientOptions = {}): Promise<ComputerStatus> {
  return request<ComputerStatus>("/api/computer/status", { method: "GET" }, options);
}

export function openComputerSession(viewOnly = true, options: ComputerClientOptions = {}): Promise<ComputerSession> {
  return request<ComputerSession>("/api/computer/session", { method: "POST", body: JSON.stringify({ viewOnly }) }, options);
}

export function revokeComputerSession(options: ComputerClientOptions = {}): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/computer/revoke", { method: "POST", body: "{}" }, options);
}

export function pauseComputer(options: ComputerClientOptions = {}): Promise<{ machine: ComputerMachine }> {
  return request<{ machine: ComputerMachine }>("/api/computer/pause", { method: "POST", body: "{}" }, options);
}
