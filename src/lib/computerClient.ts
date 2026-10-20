import { koasisComputerApiUrl } from "./koasisApi";

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
  shared: boolean;
  provisioningEnabled: boolean;
  machines: ComputerMachine[];
  selectedMachineId: string | null;
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

const COMPUTER_REQUEST_TIMEOUT_MS = 20_000;

function userFacingComputerError(code: string | undefined, status: number): string {
  if (code === "computer_machine_not_found" || code === "computer_machine_selection_invalid") return "Komputer yang dipilih belum tersedia.";
  if (code === "computer_session_expired") return "Sesi desktop sudah berakhir. Buka desktop lagi untuk melanjutkan.";
  if (code === "computer_control_not_allowed") return "Sesi ini hanya bisa dilihat. Buka sesi kendali untuk menjalankan aksi.";
  if (code === "computer_agent_control_disabled") return "Agent belum dapat mengendalikan komputer ini.";
  if (code === "operation_conflict" || code === "machine_not_running") return "Komputer sedang sibuk. Coba lagi sebentar.";
  if (code === "computer_rate_limited") return "Terlalu banyak permintaan. Coba lagi sebentar.";
  if (status === 401 || status === 403) return "Sesi login perlu diperbarui. Silakan masuk lagi.";
  if (status === 404) return "Komputer yang dipilih belum tersedia.";
  return "Komputer belum bisa digunakan saat ini. Coba lagi sebentar.";
}

async function request<T>(path: string, init: RequestInit, options: ComputerClientOptions): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, COMPUTER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(koasisComputerApiUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      try {
        const payload = await response.json() as { error?: string; code?: string };
        throw new ComputerClientError(userFacingComputerError(payload.code, response.status), payload.code);
      } catch (error) {
        if (error instanceof ComputerClientError) throw error;
        throw new ComputerClientError(userFacingComputerError(undefined, response.status));
      }
    }
    return await response.json() as T;
  } catch (error) {
    if (timedOut) throw new ComputerClientError("Komputer belum merespons. Coba lagi sebentar.", "computer_timeout");
    if (controller.signal.aborted && !(error instanceof ComputerClientError)) {
      throw new ComputerClientError("Permintaan Computer dibatalkan.", "computer_cancelled");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function getComputerStatus(options: ComputerClientOptions = {}): Promise<ComputerStatus> {
  return request<ComputerStatus>("/api/computer/status", { method: "GET" }, options);
}

export function selectComputerMachine(machineId: string, options: ComputerClientOptions = {}): Promise<{ machine: ComputerMachine; selectedMachineId: string; machines: ComputerMachine[] }> {
  return request<{ machine: ComputerMachine; selectedMachineId: string; machines: ComputerMachine[] }>("/api/computer/select", { method: "POST", body: JSON.stringify({ machineId }) }, options);
}

export function openComputerSession(viewOnly = true, options: ComputerClientOptions = {}, machineId?: string): Promise<ComputerSession> {
  return request<ComputerSession>("/api/computer/session", { method: "POST", body: JSON.stringify({ viewOnly, ...(machineId ? { machineId } : {}) }) }, options);
}

export function revokeComputerSession(options: ComputerClientOptions = {}, sessionId?: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/computer/revoke", { method: "POST", body: JSON.stringify(sessionId ? { sessionId } : {}) }, options);
}

export function pauseComputer(options: ComputerClientOptions = {}): Promise<{ machine: ComputerMachine }> {
  return request<{ machine: ComputerMachine }>("/api/computer/pause", { method: "POST", body: "{}" }, options);
}
