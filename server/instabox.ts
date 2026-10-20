import { InstaboxError, Sandbox, type Machine, type MachineState, type SandboxInfo } from "@insforge/instabox-sdk";

export type InstaboxSettings = {
  apiKey: string;
  apiUrl: string;
  template: string;
  allowProvisioning: boolean;
  allowAgentControl: boolean;
  sharedMachineIds: string[];
  defaultMachineName: string;
  defaultOwnerUid: string;
  machineTimeoutMs: number;
  autoSuspendMs: number;
};

/**
 * The current Instabox plan is intentionally treated as a fixed shared pool.
 * These are names as shown in the Instabox dashboard; the SDK lookup accepts
 * either a sandbox id or a machine name, so production can override them with
 * opaque ids through INSTABOX_SHARED_MACHINE_IDS when needed.
 */
export const DEFAULT_SHARED_MACHINE_IDENTIFIERS = [
  "koasis-alpha",
  "koasis-beta",
  "koasis-delta",
  "koasis-sigma",
  "koasis-omega",
] as const;

export type InstaboxMachineSummary = {
  id: string;
  name: string;
  state: MachineState;
  desiredState: MachineState;
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

export type InstaboxStream = {
  url: string;
  expiresAt: string;
};

export type InstaboxAction =
  | { type: "screenshot" }
  | { type: "open"; url: string }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string; delayMs?: number }
  | { type: "press"; keys: string | string[] }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number };

export type InstaboxActionResult = {
  type: InstaboxAction["type"];
  screenshotBase64?: string;
  cursor?: { x: number; y: number };
};

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TYPED_TEXT_CHARS = 4_000;
const MAX_URL_CHARS = 2_000;
const MAX_SCREEN_COORDINATE = 4_096;

function toPositiveInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && value.length <= MAX_URL_CHARS;
  } catch {
    return false;
  }
}

function toMachineSummary(info: SandboxInfo): InstaboxMachineSummary {
  const machine = info.machine;
  return {
    id: info.sandboxId,
    name: info.name,
    state: info.state,
    desiredState: machine.desiredState,
    ready: Boolean(machine.runtime.ready),
    templateId: info.templateId,
    vcpus: machine.spec.vcpus,
    memoryMiB: machine.spec.memMiB,
    storageGiB: machine.storage.sizeGiB,
    timeoutAt: machine.timeoutAt,
    autoSuspendAfterSeconds: machine.autoSuspendAfterSeconds,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

export function createInstaboxSettings(env: Record<string, string>): InstaboxSettings {
  const configuredSharedMachines = (env.INSTABOX_SHARED_MACHINE_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
  return {
    apiKey: (env.INSTABOX_API_KEY || "").trim(),
    apiUrl: (env.INSTABOX_API_URL || "https://api.instabox.sh").trim().replace(/\/+$/, ""),
    template: (env.INSTABOX_TEMPLATE || "agent-browser").trim() || "agent-browser",
    allowProvisioning: /^(1|true|yes|on)$/i.test((env.INSTABOX_ALLOW_PROVISIONING || "").trim()),
    allowAgentControl: /^(1|true|yes|on)$/i.test((env.INSTABOX_ALLOW_AGENT_CONTROL || "").trim()),
    sharedMachineIds: configuredSharedMachines.length ? configuredSharedMachines : [...DEFAULT_SHARED_MACHINE_IDENTIFIERS],
    defaultMachineName: (env.INSTABOX_DEFAULT_MACHINE_NAME || "").trim(),
    defaultOwnerUid: (env.INSTABOX_DEFAULT_OWNER_UID || "").trim(),
    machineTimeoutMs: toPositiveInteger(env.INSTABOX_MACHINE_TIMEOUT_MS, 4 * 60 * 60_000, 60_000, 24 * 60 * 60_000),
    autoSuspendMs: toPositiveInteger(env.INSTABOX_AUTO_SUSPEND_MS, 30 * 60_000, 120_000, 24 * 60 * 60_000),
  };
}

export class InstaboxService {
  readonly configured: boolean;
  private readonly settings: InstaboxSettings;

  constructor(settings: InstaboxSettings) {
    this.settings = settings;
    this.configured = Boolean(settings.apiKey);
  }

  private options() {
    return {
      apiKey: this.settings.apiKey,
      apiUrl: this.settings.apiUrl,
      requestTimeoutMs: 30_000,
      operationTimeoutMs: 10 * 60_000,
    };
  }

  private connect(machineId: string, resume = false): Promise<Sandbox> {
    return Sandbox.connect(machineId, { ...this.options(), resume });
  }

  async getMachine(machineIdOrName: string): Promise<InstaboxMachineSummary> {
    // Sandbox.connect() settles an active lifecycle operation before it
    // returns. That is useful before control actions, but it can make the
    // read-only status endpoint wait for several minutes while a machine is
    // creating, resuming, or suspending. Listing returns the current state
    // immediately and also accepts either an ID or a configured name.
    const machines = await Sandbox.list(this.options());
    const machine = machines.find((candidate) => candidate.sandboxId === machineIdOrName || candidate.name === machineIdOrName);
    if (!machine) {
      throw new InstaboxError(`machine not found: ${machineIdOrName}`, { status: 404, code: "not_found" });
    }
    return toMachineSummary(machine);
  }

  async listSharedMachines(): Promise<InstaboxMachineSummary[]> {
    const machines = await Sandbox.list(this.options());
    return this.settings.sharedMachineIds
      .map((identifier) => machines.find((candidate) => candidate.sandboxId === identifier || candidate.name === identifier))
      .filter((machine): machine is SandboxInfo => Boolean(machine))
      .map(toMachineSummary);
  }

  async provisionMachine(name: string, metadata: Record<string, string>): Promise<InstaboxMachineSummary> {
    const sandbox = await Sandbox.create(this.settings.template, {
      ...this.options(),
      name,
      metadata,
      vault: false,
      timeoutMs: this.settings.machineTimeoutMs,
      autoSuspendMs: this.settings.autoSuspendMs,
      onTimeout: "pause",
    });
    return toMachineSummary(await sandbox.getInfo());
  }

  async ensureRunning(machineId: string): Promise<InstaboxMachineSummary> {
    const sandbox = await this.connect(machineId, false);
    let info = await sandbox.getInfo();
    if (info.state === "suspended" || info.state === "stopped") {
      await sandbox.resume();
      info = await sandbox.getInfo();
    }
    if (info.state !== "running") {
      throw new Error(`Machine belum siap; state saat ini ${info.state}.`);
    }
    return toMachineSummary(info);
  }

  async startDesktop(machineId: string): Promise<void> {
    const sandbox = await this.connect(machineId, false);
    await sandbox.desktop.start({ width: 1280, height: 800 });
  }

  async createStream(machineId: string, viewOnly: boolean, ttlSeconds = 600): Promise<InstaboxStream> {
    const sandbox = await this.connect(machineId, false);
    const stream = await sandbox.desktop.streamUrl({ viewOnly, ttlSeconds });
    return { url: stream.url, expiresAt: stream.expiresAt.toISOString() };
  }

  async revokeStreams(machineId: string): Promise<void> {
    const sandbox = await this.connect(machineId, false);
    await sandbox.desktop.revokeStreamUrls();
  }

  async pause(machineId: string): Promise<InstaboxMachineSummary> {
    const sandbox = await this.connect(machineId, false);
    const info = await sandbox.getInfo();
    if (info.state === "running") await sandbox.pause();
    return toMachineSummary(await sandbox.getInfo());
  }

  async action(machineId: string, action: InstaboxAction): Promise<InstaboxActionResult> {
    const sandbox = await this.connect(machineId, false);
    const info = await sandbox.getInfo();
    if (info.state !== "running") throw new Error("Machine belum berjalan.");

    if (action.type === "screenshot") {
      const screenshot = await sandbox.desktop.screenshot();
      if (screenshot.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Screenshot terlalu besar.");
      return { type: action.type, screenshotBase64: Buffer.from(screenshot).toString("base64") };
    }
    if (action.type === "open") {
      if (!isHttpUrl(action.url)) throw new Error("URL hanya boleh menggunakan http atau https.");
      await sandbox.desktop.open(action.url);
      return { type: action.type };
    }
    if (action.type === "click") {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || action.x < 0 || action.y < 0 || action.x > MAX_SCREEN_COORDINATE || action.y > MAX_SCREEN_COORDINATE) {
        throw new Error("Koordinat klik tidak valid.");
      }
      await sandbox.desktop.click(action.x, action.y, { button: action.button, double: action.double });
      return { type: action.type };
    }
    if (action.type === "type") {
      if (!action.text || action.text.length > MAX_TYPED_TEXT_CHARS) throw new Error("Teks input tidak valid atau terlalu panjang.");
      await sandbox.desktop.type(action.text, { delayMs: Math.min(250, Math.max(0, Math.round(action.delayMs || 0))) });
      return { type: action.type };
    }
    if (action.type === "press") {
      const keys = Array.isArray(action.keys) ? action.keys : action.keys.trim();
      if ((Array.isArray(keys) && !keys.length) || (!Array.isArray(keys) && !keys)) throw new Error("Tombol keyboard belum dipilih.");
      await sandbox.desktop.press(keys);
      return { type: action.type };
    }
    await sandbox.desktop.scroll({ direction: action.direction, amount: Math.min(20, Math.max(1, Math.round(action.amount || 3))) });
    return { type: action.type };
  }
}
