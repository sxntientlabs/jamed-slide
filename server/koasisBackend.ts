import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Plugin } from "vite";
import { authenticateAgentRequest } from "./aiAgent";
import { createAdminConfigStore } from "./adminConfig";
import { COMPUTER_AGENT_INTERNAL_TOKEN } from "./computerAgent";
import { createInstaboxSettings, InstaboxService, type InstaboxAction, type InstaboxMachineSummary } from "./instabox";

type Next = (error?: unknown) => void;

const MAX_EVENT_BODY_BYTES = 128 * 1024;
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const COMPUTER_RATE_WINDOW_MS = 60_000;
const computerRateBuckets = new Map<string, { count: number; resetAt: number }>();
const ADMIN_LOGIN_RATE_WINDOW_MS = 60_000;
const ADMIN_LOGIN_RATE_LIMIT = 8;
const adminLoginBuckets = new Map<string, { count: number; resetAt: number }>();

type BackendSettings = {
  databaseUrl: string;
  firebaseProjectId: string;
  ssl: boolean;
  maxConnections: number;
  instabox: ReturnType<typeof createInstaboxSettings>;
};

type JsonObject = Record<string, unknown>;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_EVENT_BODY_BYTES) {
        reject(new Error("Event payload terlalu besar."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("Body event harus berupa object JSON."));
          return;
        }
        resolve(parsed as JsonObject);
      } catch {
        reject(new Error("Body event bukan JSON yang valid."));
      }
    });
    request.on("error", reject);
  });
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function createPool(settings: BackendSettings): Pool | null {
  if (!settings.databaseUrl) return null;
  const config: PoolConfig = {
    connectionString: settings.databaseUrl,
    max: settings.maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  };
  if (settings.ssl) config.ssl = { rejectUnauthorized: false };
  return new Pool(config);
}

async function installSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS koasis_events (
      id uuid PRIMARY KEY,
      user_id text NOT NULL,
      event_type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS koasis_events_user_created_idx
      ON koasis_events (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS koasis_computer_machines (
      user_id text PRIMARY KEY,
      instabox_machine_id text NOT NULL UNIQUE,
      machine_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz
    );
    -- The table now stores a user's selected shared machine. Multiple users
    -- must be allowed to point at the same Instabox machine.
    ALTER TABLE koasis_computer_machines
      DROP CONSTRAINT IF EXISTS koasis_computer_machines_instabox_machine_id_key;
    CREATE TABLE IF NOT EXISTS koasis_computer_sessions (
      id uuid PRIMARY KEY,
      user_id text NOT NULL REFERENCES koasis_computer_machines(user_id) ON DELETE CASCADE,
      instabox_machine_id text NOT NULL,
      view_only boolean NOT NULL DEFAULT true,
      source text NOT NULL DEFAULT 'user',
      expires_at timestamptz NOT NULL,
      status text NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    ALTER TABLE koasis_computer_sessions
      ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';
    CREATE INDEX IF NOT EXISTS koasis_computer_sessions_user_idx
      ON koasis_computer_sessions (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS koasis_admin_config (
      id text PRIMARY KEY,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text
    );
  `);
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function consumeComputerRate(userId: string, namespace: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = `${namespace}:${userId}`;
  const current = computerRateBuckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + COMPUTER_RATE_WINDOW_MS } : current;
  bucket.count += 1;
  computerRateBuckets.set(key, bucket);
  if (computerRateBuckets.size > 500) {
    for (const [storedKey, stored] of computerRateBuckets) if (stored.resetAt <= now) computerRateBuckets.delete(storedKey);
  }
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
}

function consumeAdminLoginRate(request: IncomingMessage): { allowed: boolean; retryAfterSeconds: number } {
  const address = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = adminLoginBuckets.get(address);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + ADMIN_LOGIN_RATE_WINDOW_MS } : current;
  bucket.count += 1;
  adminLoginBuckets.set(address, bucket);
  if (adminLoginBuckets.size > 500) {
    for (const [key, stored] of adminLoginBuckets) if (stored.resetAt <= now) adminLoginBuckets.delete(key);
  }
  return { allowed: bucket.count <= ADMIN_LOGIN_RATE_LIMIT, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)) };
}

type ComputerMachineRow = {
  user_id: string;
  instabox_machine_id: string;
  machine_name: string;
};

type ComputerSessionRow = {
  id: string;
  instabox_machine_id: string;
  view_only: boolean;
  expires_at: Date;
  status: "active" | "revoked";
};

function computerError(error: unknown): { status: number; code: string; message: string } {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "instabox_unavailable";
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  if (code === "quota_exceeded") return { status: 429, code, message: "Komputer sedang penuh. Coba lagi nanti." };
  if (code === "insufficient_scope" || code === "unauthenticated" || code === "api_key_expired" || code === "api_key_revoked") {
    return { status: 503, code: "instabox_credentials", message: "Komputer belum siap digunakan." };
  }
  if (code === "not_found") return { status: 404, code: "computer_machine_not_found", message: "Komputer tidak ditemukan." };
  if (code === "computer_machine_not_found") return { status: 404, code, message: "Belum ada komputer yang tersedia." };
  if (code === "computer_machine_selection_invalid") return { status: 404, code, message: "Komputer yang dipilih tidak tersedia." };
  if (code === "computer_session_expired") return { status: 409, code, message: "Sesi desktop sudah berakhir." };
  if (code === "computer_control_not_allowed") return { status: 409, code, message: "Sesi ini hanya bisa dilihat. Buka sesi kendali untuk menjalankan aksi." };
  if (code === "computer_agent_control_disabled") return { status: 409, code, message: "Agent belum dapat mengendalikan komputer ini." };
  if (code === "computer_shared_machine_no_pause") return { status: 409, code, message: "Komputer bersama tidak dapat dijeda dari sini." };
  if (code === "computer_provisioning_disabled") return { status: 409, code, message: "Komputer baru belum tersedia." };
  if (code === "operation_conflict" || code === "machine_not_running") return { status: 409, code, message: "Komputer sedang sibuk. Coba lagi sebentar." };
  if (status === 400) return { status: 400, code: "computer_bad_request", message: "Permintaan komputer tidak valid." };
  return { status: 502, code, message: "Komputer sementara tidak tersedia." };
}

function isTransientComputerLifecycleError(error: unknown): boolean {
  const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
  return code === "operation_conflict" || code === "machine_not_running";
}

async function retryComputerLifecycle<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientComputerLifecycleError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 450 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function withComputerUserLock<T>(pool: Pool, userId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const lockKey = `koasis:computer:${userId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    return await callback(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
    client.release();
  }
}

async function withComputerMachineLock<T>(client: PoolClient, machineId: string, callback: () => Promise<T>): Promise<T> {
  const lockKey = `koasis:computer-machine:${machineId}`;
  await client.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
  try {
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
  }
}

function machineMatchesIdentifier(machine: InstaboxMachineSummary, identifier: string): boolean {
  return machine.id === identifier || machine.name === identifier;
}

function requestedMachineId(body: JsonObject): string | undefined | null {
  if (body.machineId === undefined) return undefined;
  if (typeof body.machineId !== "string") return null;
  const value = body.machineId.trim();
  return value && value.length <= 240 ? value : null;
}

async function requireUser(request: IncomingMessage, response: ServerResponse, projectId: string): Promise<string | null> {
  if (!projectId) {
    sendJson(response, 503, { error: "Konfigurasi autentikasi server belum lengkap.", code: "auth_configuration" });
    return null;
  }
  try {
    const identity = await authenticateAgentRequest(request, projectId);
    if (!identity) {
      response.setHeader("WWW-Authenticate", "Bearer");
      sendJson(response, 401, { error: "Sesi login tidak valid atau sudah berakhir.", code: "unauthorized" });
      return null;
    }
    return identity.userId;
  } catch {
    sendJson(response, 503, { error: "Verifikasi sesi sementara tidak tersedia.", code: "auth_unavailable" });
    return null;
  }
}

function hasInternalAgentCapability(request: IncomingMessage): boolean {
  const header = request.headers["x-koasis-agent-tool"];
  return typeof header === "string" && header === COMPUTER_AGENT_INTERNAL_TOKEN;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toComputerAction(value: unknown): InstaboxAction | null {
  if (!isPlainObject(value) || typeof value.type !== "string") return null;
  if (value.type === "screenshot") return { type: "screenshot" };
  if (value.type === "open" && typeof value.url === "string") return { type: "open", url: value.url };
  if (value.type === "click" && typeof value.x === "number" && typeof value.y === "number") {
    const button = value.button === "right" || value.button === "middle" ? value.button : "left";
    return { type: "click", x: value.x, y: value.y, button, double: value.double === true };
  }
  if (value.type === "type" && typeof value.text === "string") {
    return { type: "type", text: value.text, delayMs: typeof value.delayMs === "number" ? value.delayMs : undefined };
  }
  if (value.type === "press" && (typeof value.keys === "string" || Array.isArray(value.keys) && value.keys.every((key) => typeof key === "string"))) {
    return { type: "press", keys: value.keys as string | string[] };
  }
  if (value.type === "scroll" && (value.direction === "up" || value.direction === "down" || value.direction === "left" || value.direction === "right")) {
    return { type: "scroll", direction: value.direction, amount: typeof value.amount === "number" ? value.amount : undefined };
  }
  return null;
}

export function createKoasisBackendPlugin(env: Record<string, string>): Plugin {
  const settings: BackendSettings = {
    databaseUrl: (env.KOASIS_POSTGRES_URL || env.DATABASE_URL || "").trim(),
    firebaseProjectId: (env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || "").trim(),
    ssl: parseBoolean(env.KOASIS_POSTGRES_SSL, true),
    maxConnections: Math.min(20, Math.max(1, Number(env.KOASIS_POSTGRES_MAX_CONNECTIONS || 5) || 5)),
    instabox: createInstaboxSettings(env),
  };
  const pool = createPool(settings);
  const instabox = new InstaboxService(settings.instabox);
  const adminConfig = createAdminConfigStore({
    pool,
    password: env.KOASIS_ADMIN_PASSWORD || env.ADMIN_PASSWORD,
    sessionSecret: env.KOASIS_ADMIN_SESSION_SECRET,
    providerModelIds: {
      cito: env.JAMED_AI_MODEL_CITO || "cx/gpt-5.6-luna",
      elective: env.JAMED_AI_MODEL_ELECTIVE || "cx/gpt-5.6-terra",
      executive: env.JAMED_AI_MODEL_EXECUTIVE || "cx/gpt-5.6-sol",
    },
  });
  let schemaPromise: Promise<void> | null = null;

  const ensureSchema = async (): Promise<Pool> => {
    if (!pool) throw new Error("Layanan penyimpanan belum siap.");
    if (!schemaPromise) {
      schemaPromise = installSchema(pool).catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
    return pool;
  };

  const handleHealth = async (_request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!pool) {
      sendJson(response, 200, { ok: true, database: { configured: false, reachable: false } });
      return;
    }
    try {
      await ensureSchema();
      await pool.query("SELECT 1");
      sendJson(response, 200, { ok: true, database: { configured: true, reachable: true } });
    } catch {
      sendJson(response, 503, { ok: false, database: { configured: true, reachable: false } });
    }
  };

  const handleEvent = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/backend/events." });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "Layanan penyimpanan belum siap. Coba lagi nanti.", code: "database_configuration" });
      return;
    }
    if (!settings.firebaseProjectId) {
      sendJson(response, 503, { error: "Layanan akun belum siap. Coba lagi nanti.", code: "auth_configuration" });
      return;
    }
    let identity: { userId: string } | null = null;
    try {
      identity = await authenticateAgentRequest(request, settings.firebaseProjectId);
    } catch {
      sendJson(response, 503, { error: "Verifikasi sesi sementara tidak tersedia.", code: "auth_unavailable" });
      return;
    }
    if (!identity) {
      response.setHeader("WWW-Authenticate", "Bearer");
      sendJson(response, 401, { error: "Sesi login tidak valid atau sudah berakhir.", code: "unauthorized" });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
      const payload = body.payload === undefined ? {} : body.payload;
      if (!EVENT_TYPE_PATTERN.test(eventType)) {
        sendJson(response, 400, { error: "eventType tidak valid.", code: "invalid_event_type" });
        return;
      }
      if (!isPlainObject(payload)) {
        sendJson(response, 400, { error: "payload harus berupa object JSON.", code: "invalid_payload" });
        return;
      }
      const activePool = await ensureSchema();
      const result = await activePool.query(
        "INSERT INTO koasis_events (id, user_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, created_at",
        [randomUUID(), identity.userId, eventType, JSON.stringify(payload)],
      );
      const row = result.rows[0] as { id: string; created_at: Date };
      sendJson(response, 201, { id: row.id, createdAt: row.created_at });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event belum bisa disimpan.";
      sendJson(response, message === "Event payload terlalu besar." ? 413 : 502, { error: message.slice(0, 240), code: "database_write_failed" });
    }
  };

  const requireAdmin = (request: IncomingMessage, response: ServerResponse): boolean => {
    if (adminConfig.isAuthenticated(request)) return true;
    response.setHeader("WWW-Authenticate", "Cookie");
    sendJson(response, 401, { error: "Sesi admin belum terautentikasi.", code: "admin_unauthorized" });
    return false;
  };

  const handleAdminSession = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Gunakan GET /api/admin/session." });
      return;
    }
    sendJson(response, 200, {
      authenticated: adminConfig.isAuthenticated(request),
      configured: adminConfig.passwordConfigured,
      persistenceConfigured: adminConfig.configured,
    });
  };

  const handleAdminLogin = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/admin/login." });
      return;
    }
    if (!adminConfig.passwordConfigured) {
      sendJson(response, 503, { error: "Password admin belum dikonfigurasi di server.", code: "admin_configuration" });
      return;
    }
    const rate = consumeAdminLoginRate(request);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds));
      sendJson(response, 429, { error: "Terlalu banyak percobaan login admin. Coba lagi sebentar.", code: "admin_rate_limited" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (!adminConfig.authenticatePassword(body.password)) {
        sendJson(response, 401, { error: "Password admin salah.", code: "admin_invalid_password" });
        return;
      }
      adminConfig.setSession(request, response);
      sendJson(response, 200, { authenticated: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login admin gagal.";
      sendJson(response, 400, { error: message.slice(0, 200), code: "admin_invalid_request" });
    }
  };

  const handleAdminLogout = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/admin/logout." });
      return;
    }
    adminConfig.clearSession(response);
    sendJson(response, 200, { authenticated: false });
  };

  const handleAdminConfig = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("Cache-Control", "no-store");
    if (!requireAdmin(request, response)) return;
    try {
      if (request.method === "GET") {
        const config = await adminConfig.load();
        sendJson(response, 200, { config, persistenceConfigured: adminConfig.configured });
        return;
      }
      if (request.method === "PUT") {
        const body = await readJsonBody(request);
        const value = body.config && typeof body.config === "object" ? body.config : body;
        const config = await adminConfig.save(value);
        sendJson(response, 200, { config, persistenceConfigured: adminConfig.configured });
        return;
      }
      sendJson(response, 405, { error: "Gunakan GET atau PUT /api/admin/config." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Konfigurasi admin belum bisa diproses.";
      sendJson(response, adminConfig.configured ? 502 : 503, { error: message.slice(0, 240), code: adminConfig.configured ? "admin_config_failed" : "database_configuration" });
    }
  };

  const handlePublicCatalog = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Gunakan GET /api/catalog." });
      return;
    }
    try {
      sendJson(response, 200, { catalog: await adminConfig.publicCatalog() });
    } catch {
      sendJson(response, 200, { catalog: await adminConfig.publicCatalog() });
    }
  };

  const handleComputerStatus = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Gunakan GET /api/computer/status." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    if (!instabox.configured) {
      sendJson(response, 200, { configured: false, shared: true, provisioningEnabled: false, machines: [], selectedMachineId: null, machine: null, activeSession: null });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "Layanan penyimpanan belum siap. Coba lagi nanti.", code: "database_configuration" });
      return;
    }
    try {
      const activePool = await ensureSchema();
      const mapping = await activePool.query<ComputerMachineRow>(
        "SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1",
        [userId],
      );
      const row = mapping.rows[0];
      const machines = await instabox.listSharedMachines();
      const machine = row ? machines.find((candidate) => machineMatchesIdentifier(candidate, row.instabox_machine_id)) || null : null;
      const selectedMachine = machine || machines[0] || null;
      const session = await activePool.query<ComputerSessionRow>(
        "SELECT id, instabox_machine_id, view_only, expires_at, status FROM koasis_computer_sessions WHERE user_id = $1 AND source = 'user' AND status = 'active' AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [userId],
      );
      const activeSession = session.rows[0] ? {
        id: session.rows[0].id,
        viewOnly: session.rows[0].view_only,
        expiresAt: session.rows[0].expires_at.toISOString(),
        status: session.rows[0].status,
      } : null;
      if (row) await activePool.query("UPDATE koasis_computer_machines SET last_seen_at = now(), updated_at = now() WHERE user_id = $1", [userId]);
      sendJson(response, 200, {
        configured: true,
        shared: true,
        provisioningEnabled: false,
        machines,
        selectedMachineId: selectedMachine?.id || null,
        machine: selectedMachine,
        activeSession,
      });
    } catch (error) {
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
  };

  const handleComputerSelect = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/computer/select." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    if (!instabox.configured) {
      sendJson(response, 503, { error: "Komputer belum siap digunakan. Coba lagi nanti.", code: "instabox_configuration" });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "Layanan penyimpanan belum siap. Coba lagi nanti.", code: "database_configuration" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const selectedIdentifier = requestedMachineId(body);
      if (!selectedIdentifier) {
        sendJson(response, 400, { error: "Pilih komputer terlebih dahulu.", code: "invalid_computer_machine" });
        return;
      }
      const machines = await instabox.listSharedMachines();
      const selectedMachine = machines.find((machine) => machineMatchesIdentifier(machine, selectedIdentifier));
      if (!selectedMachine) {
        sendJson(response, 404, { error: "Komputer yang dipilih tidak tersedia.", code: "computer_machine_selection_invalid" });
        return;
      }
      const activePool = await ensureSchema();
      await withComputerUserLock(activePool, userId, async (client) => {
        await client.query(
          `INSERT INTO koasis_computer_machines (user_id, instabox_machine_id, machine_name, last_seen_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (user_id) DO UPDATE SET instabox_machine_id = EXCLUDED.instabox_machine_id, machine_name = EXCLUDED.machine_name, updated_at = now(), last_seen_at = now()`,
          [userId, selectedMachine.id, selectedMachine.name],
        );
        // Revoking a user's own session does not revoke the Instabox stream
        // globally: other users may be using the same shared machine.
        await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND source = 'user' AND status = 'active'", [userId]);
      });
      sendJson(response, 200, { machine: selectedMachine, selectedMachineId: selectedMachine.id, machines });
    } catch (error) {
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
  };

  const handleComputerSession = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/computer/session." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    const rate = consumeComputerRate(userId, "session", 6);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds));
      sendJson(response, 429, { error: "Terlalu banyak permintaan. Coba lagi sebentar.", code: "computer_rate_limited" });
      return;
    }
    if (!instabox.configured) {
      sendJson(response, 503, { error: "Komputer belum siap digunakan. Coba lagi nanti.", code: "instabox_configuration" });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "Layanan penyimpanan belum siap. Coba lagi nanti.", code: "database_configuration" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const selectedIdentifier = requestedMachineId(body);
      if (selectedIdentifier === null) {
        sendJson(response, 400, { error: "Pilihan komputer tidak valid.", code: "invalid_computer_machine" });
        return;
      }
      const agentSession = hasInternalAgentCapability(request) && body.agent === true;
      if (agentSession && !settings.instabox.allowAgentControl) {
        sendJson(response, 409, { error: "Kontrol Computer oleh agent belum diaktifkan di server.", code: "computer_agent_control_disabled" });
        return;
      }
      const viewOnly = agentSession ? false : body.viewOnly !== false;
      const includeStream = agentSession ? false : body.includeStream !== false;
      const sharedMachines = await instabox.listSharedMachines();
      if (!sharedMachines.length) {
        throw Object.assign(new Error("Belum ada komputer yang tersedia."), { code: "computer_machine_not_found", status: 404 });
      }
      const requestedMachine = selectedIdentifier
        ? sharedMachines.find((machine) => machineMatchesIdentifier(machine, selectedIdentifier))
        : undefined;
      if (selectedIdentifier && !requestedMachine) {
        throw Object.assign(new Error("Komputer yang dipilih tidak tersedia."), { code: "computer_machine_selection_invalid", status: 404 });
      }
      const activePool = await ensureSchema();
      const result = await withComputerUserLock(activePool, userId, async (client) => {
        let mapping = (await client.query<ComputerMachineRow>(
          "SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1",
          [userId],
        )).rows[0];

        const mappedMachine = mapping
          ? sharedMachines.find((machine) => machineMatchesIdentifier(machine, mapping?.instabox_machine_id || ""))
          : undefined;
        const selectedMachine = requestedMachine || mappedMachine || sharedMachines[0];
        if (!selectedMachine) {
          throw Object.assign(new Error("Belum ada komputer yang tersedia."), { code: "computer_machine_not_found", status: 404 });
        }
        if (!mapping || mapping.instabox_machine_id !== selectedMachine.id || mapping.machine_name !== selectedMachine.name) {
          await client.query(
            `INSERT INTO koasis_computer_machines (user_id, instabox_machine_id, machine_name, last_seen_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (user_id) DO UPDATE SET instabox_machine_id = EXCLUDED.instabox_machine_id, machine_name = EXCLUDED.machine_name, updated_at = now(), last_seen_at = now()`,
            [userId, selectedMachine.id, selectedMachine.name],
          );
          mapping = { user_id: userId, instabox_machine_id: selectedMachine.id, machine_name: selectedMachine.name };
          await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND source = 'user' AND status = 'active'", [userId]);
        }

        const { machine, stream } = await withComputerMachineLock(client, selectedMachine.id, async () => retryComputerLifecycle(async () => {
          const readyMachine = await instabox.ensureRunning(selectedMachine.id);
          await instabox.startDesktop(selectedMachine.id);
          // Stream URLs are scoped to the shared machine. Do not revoke all
          // URLs when one user opens or closes their own session.
          const readyStream = includeStream ? await instabox.createStream(selectedMachine.id, viewOnly, 600) : null;
          return { machine: readyMachine, stream: readyStream };
        }));
        const expiresAt = stream?.expiresAt || new Date(Date.now() + 10 * 60_000).toISOString();
        const sessionId = randomUUID();
        if (!agentSession) {
          await client.query(
            "UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND source = 'user' AND status = 'active'",
            [userId],
          );
        }
        await client.query(
          "INSERT INTO koasis_computer_sessions (id, user_id, instabox_machine_id, view_only, source, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'active')",
          [sessionId, userId, selectedMachine.id, viewOnly, agentSession ? "agent" : "user", expiresAt],
        );
        await client.query("UPDATE koasis_computer_machines SET last_seen_at = now(), updated_at = now() WHERE user_id = $1", [userId]);
        return { sessionId, machine, stream, expiresAt };
      });
      sendJson(response, 200, {
        sessionId: result.sessionId,
        machine: result.machine,
        ...(result.stream ? { streamUrl: result.stream.url } : {}),
        expiresAt: result.expiresAt,
        viewOnly,
      });
    } catch (error) {
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
  };

  const handleComputerRevoke = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/computer/revoke." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    if (!instabox.configured || !pool) {
      sendJson(response, 200, { ok: true });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const sessionId = body.sessionId === undefined ? undefined : isUuid(body.sessionId) ? body.sessionId : null;
      if (sessionId === null) {
        sendJson(response, 400, { error: "sessionId tidak valid.", code: "invalid_computer_session" });
        return;
      }
      const activePool = await ensureSchema();
      await withComputerUserLock(activePool, userId, async (client) => {
        if (sessionId) {
          // Stream revocation is machine-wide in Instabox. Never revoke it
          // for a single user because the machine is shared by the pool.
          await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1 AND user_id = $2 AND status = 'active'", [sessionId, userId]);
          return;
        }
        await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND source = 'user' AND status = 'active'", [userId]);
      });
      sendJson(response, 200, { ok: true });
    } catch (error) {
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
  };

  const handleComputerPause = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/computer/pause." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    if (!instabox.configured || !pool) {
      sendJson(response, 503, { error: "Computer belum dikonfigurasi.", code: "computer_configuration" });
      return;
    }
    sendJson(response, 409, {
      error: "Komputer bersama tidak dapat dijeda dari sini.",
      code: "computer_shared_machine_no_pause",
    });
  };

  const handleComputerAction = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Gunakan POST /api/computer/action." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    const rate = consumeComputerRate(userId, "action", 120);
    if (!rate.allowed) {
      response.setHeader("Retry-After", String(rate.retryAfterSeconds));
      sendJson(response, 429, { error: "Terlalu banyak aksi Computer. Coba lagi sebentar.", code: "computer_rate_limited" });
      return;
    }
    if (!instabox.configured || !pool) {
      sendJson(response, 503, { error: "Computer belum dikonfigurasi.", code: "computer_configuration" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const action = toComputerAction(body.action);
      if (!action) {
        sendJson(response, 400, { error: "Aksi Computer tidak valid.", code: "invalid_computer_action" });
        return;
      }
      const sessionId = body.sessionId === undefined ? undefined : isUuid(body.sessionId) ? body.sessionId : null;
      if (sessionId === null) {
        sendJson(response, 400, { error: "sessionId tidak valid.", code: "invalid_computer_session" });
        return;
      }
      const activePool = await ensureSchema();
      const result = await withComputerUserLock(activePool, userId, async (client) => {
        const activeSession = await client.query<{ id: string; instabox_machine_id: string; view_only: boolean }>(
          "SELECT id, instabox_machine_id, view_only FROM koasis_computer_sessions WHERE user_id = $1 AND status = 'active' AND expires_at > now() AND ($2::uuid IS NOT NULL AND id = $2::uuid OR $2::uuid IS NULL AND source = 'user') ORDER BY created_at DESC LIMIT 1",
          [userId, sessionId ?? null],
        );
        if (!activeSession.rows.length) throw Object.assign(new Error("Sesi desktop sudah berakhir."), { code: "computer_session_expired", status: 409 });
        if (activeSession.rows[0].view_only) throw Object.assign(new Error("Sesi ini hanya bisa dilihat."), { code: "computer_control_not_allowed", status: 409 });
        return withComputerMachineLock(client, activeSession.rows[0].instabox_machine_id, () => instabox.action(activeSession.rows[0].instabox_machine_id, action));
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: unknown }).code === "computer_session_expired") {
        sendJson(response, 409, { error: "Sesi desktop sudah berakhir.", code: "computer_session_expired" });
        return;
      }
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
  };

  const healthMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleHealth(request, response);
  };
  const eventMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleEvent(request, response);
  };
  const computerStatusMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerStatus(request, response);
  };
  const computerSelectMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerSelect(request, response);
  };
  const computerSessionMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerSession(request, response);
  };
  const computerRevokeMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerRevoke(request, response);
  };
  const computerPauseMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerPause(request, response);
  };
  const computerActionMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleComputerAction(request, response);
  };
  const adminSessionMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleAdminSession(request, response);
  };
  const adminLoginMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleAdminLogin(request, response);
  };
  const adminLogoutMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleAdminLogout(request, response);
  };
  const adminConfigMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleAdminConfig(request, response);
  };
  const publicCatalogMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handlePublicCatalog(request, response);
  };

  return {
    name: "koasis-postgres-backend",
    configureServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
      server.middlewares.use("/api/computer/status", computerStatusMiddleware);
      server.middlewares.use("/api/computer/select", computerSelectMiddleware);
      server.middlewares.use("/api/computer/session", computerSessionMiddleware);
      server.middlewares.use("/api/computer/revoke", computerRevokeMiddleware);
      server.middlewares.use("/api/computer/pause", computerPauseMiddleware);
      server.middlewares.use("/api/computer/action", computerActionMiddleware);
      server.middlewares.use("/api/admin/session", adminSessionMiddleware);
      server.middlewares.use("/api/admin/login", adminLoginMiddleware);
      server.middlewares.use("/api/admin/logout", adminLogoutMiddleware);
      server.middlewares.use("/api/admin/config", adminConfigMiddleware);
      server.middlewares.use("/api/catalog", publicCatalogMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
      server.middlewares.use("/api/computer/status", computerStatusMiddleware);
      server.middlewares.use("/api/computer/select", computerSelectMiddleware);
      server.middlewares.use("/api/computer/session", computerSessionMiddleware);
      server.middlewares.use("/api/computer/revoke", computerRevokeMiddleware);
      server.middlewares.use("/api/computer/pause", computerPauseMiddleware);
      server.middlewares.use("/api/computer/action", computerActionMiddleware);
      server.middlewares.use("/api/admin/session", adminSessionMiddleware);
      server.middlewares.use("/api/admin/login", adminLoginMiddleware);
      server.middlewares.use("/api/admin/logout", adminLogoutMiddleware);
      server.middlewares.use("/api/admin/config", adminConfigMiddleware);
      server.middlewares.use("/api/catalog", publicCatalogMiddleware);
    },
  };
}
