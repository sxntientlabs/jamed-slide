import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import type { Plugin } from "vite";
import { authenticateAgentRequest } from "./aiAgent";
import { COMPUTER_AGENT_INTERNAL_TOKEN } from "./computerAgent";
import { createInstaboxSettings, InstaboxService, type InstaboxAction, type InstaboxMachineSummary } from "./instabox";

type Next = (error?: unknown) => void;

const MAX_EVENT_BODY_BYTES = 128 * 1024;
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const COMPUTER_RATE_WINDOW_MS = 60_000;
const computerRateBuckets = new Map<string, { count: number; resetAt: number }>();

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

type ComputerMachineRow = {
  user_id: string;
  instabox_machine_id: string;
  machine_name: string;
};

type ComputerSessionRow = {
  id: string;
  view_only: boolean;
  expires_at: Date;
  status: "active" | "revoked";
};

function opaqueUserLabel(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

function machineNameForUser(userId: string): string {
  return `koasis-${opaqueUserLabel(userId).slice(0, 12)}`;
}

function computerError(error: unknown): { status: number; code: string; message: string } {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : "instabox_unavailable";
  const status = typeof candidate.status === "number" ? candidate.status : 0;
  if (code === "quota_exceeded") return { status: 429, code, message: "Batas akun Instabox sudah tercapai." };
  if (code === "insufficient_scope" || code === "unauthenticated" || code === "api_key_expired" || code === "api_key_revoked") {
    return { status: 503, code: "instabox_credentials", message: "Kredensial Instabox belum memiliki akses yang diperlukan." };
  }
  if (code === "not_found") return { status: 404, code: "computer_machine_not_found", message: "Machine Computer tidak ditemukan." };
  if (code === "computer_machine_not_found") return { status: 404, code, message: "Machine Computer belum tersedia." };
  if (code === "computer_session_expired") return { status: 409, code, message: "Session Computer sudah berakhir." };
  if (code === "computer_control_not_allowed") return { status: 409, code, message: "Session Computer ini view-only. Buka session kontrol untuk menjalankan aksi." };
  if (code === "computer_agent_control_disabled") return { status: 409, code, message: "Kontrol Computer oleh agent belum diaktifkan di server." };
  if (code === "computer_provisioning_disabled") return { status: 409, code, message: "Provisioning machine belum diaktifkan." };
  if (code === "operation_conflict" || code === "machine_not_running") return { status: 409, code, message: "Machine sedang menjalankan operasi lain. Coba lagi sebentar." };
  if (status === 400) return { status: 400, code: "instabox_bad_request", message: "Permintaan ke Instabox tidak valid." };
  return { status: 502, code, message: "Layanan Computer sementara tidak tersedia." };
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
  let schemaPromise: Promise<void> | null = null;

  const ensureSchema = async (): Promise<Pool> => {
    if (!pool) throw new Error("PostgreSQL belum dikonfigurasi di server.");
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
      sendJson(response, 503, { error: "PostgreSQL belum dikonfigurasi di server.", code: "database_configuration" });
      return;
    }
    if (!settings.firebaseProjectId) {
      sendJson(response, 503, { error: "Konfigurasi Firebase server belum lengkap.", code: "auth_configuration" });
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

  const handleComputerStatus = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Gunakan GET /api/computer/status." });
      return;
    }
    const userId = await requireUser(request, response, settings.firebaseProjectId);
    if (!userId) return;
    if (!instabox.configured) {
      sendJson(response, 200, { configured: false, provisioningEnabled: settings.instabox.allowProvisioning, machine: null, activeSession: null });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "PostgreSQL belum dikonfigurasi di server.", code: "database_configuration" });
      return;
    }
    try {
      const activePool = await ensureSchema();
      const mapping = await activePool.query<ComputerMachineRow>(
        "SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1",
        [userId],
      );
      const row = mapping.rows[0];
      if (!row) {
        sendJson(response, 200, { configured: true, provisioningEnabled: settings.instabox.allowProvisioning, machine: null, activeSession: null });
        return;
      }
      const machine = await instabox.getMachine(row.instabox_machine_id);
      const session = await activePool.query<ComputerSessionRow>(
        "SELECT id, view_only, expires_at, status FROM koasis_computer_sessions WHERE user_id = $1 AND source = 'user' AND status = 'active' AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        [userId],
      );
      const activeSession = session.rows[0] ? {
        id: session.rows[0].id,
        viewOnly: session.rows[0].view_only,
        expiresAt: session.rows[0].expires_at.toISOString(),
        status: session.rows[0].status,
      } : null;
      await activePool.query("UPDATE koasis_computer_machines SET last_seen_at = now(), updated_at = now() WHERE user_id = $1", [userId]);
      sendJson(response, 200, { configured: true, provisioningEnabled: settings.instabox.allowProvisioning, machine, activeSession });
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
      sendJson(response, 429, { error: "Terlalu banyak pembukaan session Computer. Coba lagi sebentar.", code: "computer_rate_limited" });
      return;
    }
    if (!instabox.configured) {
      sendJson(response, 503, { error: "Instabox belum dikonfigurasi di server.", code: "instabox_configuration" });
      return;
    }
    if (!pool) {
      sendJson(response, 503, { error: "PostgreSQL belum dikonfigurasi di server.", code: "database_configuration" });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const agentSession = hasInternalAgentCapability(request) && body.agent === true;
      if (agentSession && !settings.instabox.allowAgentControl) {
        sendJson(response, 409, { error: "Kontrol Computer oleh agent belum diaktifkan di server.", code: "computer_agent_control_disabled" });
        return;
      }
      const viewOnly = agentSession ? false : body.viewOnly !== false;
      const includeStream = agentSession ? false : body.includeStream !== false;
      const activePool = await ensureSchema();
      const result = await withComputerUserLock(activePool, userId, async (client) => {
        let mapping = (await client.query<ComputerMachineRow>(
          "SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1",
          [userId],
        )).rows[0];

        if (!mapping) {
          let machine: InstaboxMachineSummary;
          if (settings.instabox.defaultMachineName && settings.instabox.defaultOwnerUid === userId) {
            machine = await instabox.getMachine(settings.instabox.defaultMachineName);
          } else {
            if (!settings.instabox.allowProvisioning) {
              throw Object.assign(new Error("Provisioning machine belum diaktifkan."), { code: "computer_provisioning_disabled", status: 409 });
            }
            machine = await instabox.provisionMachine(machineNameForUser(userId), {
              app: "koasis",
              owner: opaqueUserLabel(userId),
            });
          }
          await client.query(
            "INSERT INTO koasis_computer_machines (user_id, instabox_machine_id, machine_name, last_seen_at) VALUES ($1, $2, $3, now())",
            [userId, machine.id, machine.name],
          );
          mapping = { user_id: userId, instabox_machine_id: machine.id, machine_name: machine.name };
        }

        const machine = await instabox.ensureRunning(mapping.instabox_machine_id);
        await instabox.startDesktop(mapping.instabox_machine_id);
        if (includeStream) await instabox.revokeStreams(mapping.instabox_machine_id);
        const stream = includeStream ? await instabox.createStream(mapping.instabox_machine_id, viewOnly, 600) : null;
        const expiresAt = stream?.expiresAt || new Date(Date.now() + 10 * 60_000).toISOString();
        const sessionId = randomUUID();
        if (!agentSession) {
          await client.query(
            "UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND status = 'active'",
            [userId],
          );
        }
        await client.query(
          "INSERT INTO koasis_computer_sessions (id, user_id, instabox_machine_id, view_only, source, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'active')",
          [sessionId, userId, mapping.instabox_machine_id, viewOnly, agentSession ? "agent" : "user", expiresAt],
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
      if (error && typeof error === "object" && (error as { code?: unknown }).code === "computer_provisioning_disabled") {
        sendJson(response, 409, { error: "Belum ada machine untuk user ini dan provisioning belum diaktifkan.", code: "computer_provisioning_disabled" });
        return;
      }
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
        const mapping = (await client.query<ComputerMachineRow>("SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1", [userId])).rows[0];
        if (sessionId) {
          const target = await client.query<{ instabox_machine_id: string; source: string }>(
            "SELECT instabox_machine_id, source FROM koasis_computer_sessions WHERE id = $1 AND user_id = $2 AND status = 'active'",
            [sessionId, userId],
          );
          if (target.rows[0]?.source === "user") await instabox.revokeStreams(target.rows[0].instabox_machine_id);
          await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1 AND user_id = $2 AND status = 'active'", [sessionId, userId]);
          return;
        }
        if (mapping) await instabox.revokeStreams(mapping.instabox_machine_id);
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
    try {
      const activePool = await ensureSchema();
      const result = await withComputerUserLock(activePool, userId, async (client) => {
        const mapping = (await client.query<ComputerMachineRow>("SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1", [userId])).rows[0];
        if (!mapping) throw Object.assign(new Error("Machine belum tersedia."), { code: "computer_machine_not_found", status: 404 });
        const machine = await instabox.pause(mapping.instabox_machine_id);
        await client.query("UPDATE koasis_computer_sessions SET status = 'revoked', revoked_at = now() WHERE user_id = $1 AND status = 'active'", [userId]);
        await client.query("UPDATE koasis_computer_machines SET last_seen_at = now(), updated_at = now() WHERE user_id = $1", [userId]);
        return machine;
      });
      sendJson(response, 200, { machine: result });
    } catch (error) {
      const mapped = computerError(error);
      sendJson(response, mapped.status, { error: mapped.message, code: mapped.code });
    }
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
        const mapping = (await client.query<ComputerMachineRow>("SELECT user_id, instabox_machine_id, machine_name FROM koasis_computer_machines WHERE user_id = $1", [userId])).rows[0];
        if (!mapping) throw Object.assign(new Error("Machine belum tersedia."), { code: "computer_machine_not_found", status: 404 });
        const activeSession = await client.query<{ id: string; view_only: boolean }>(
          "SELECT id, view_only FROM koasis_computer_sessions WHERE user_id = $1 AND status = 'active' AND expires_at > now() AND ($2::uuid IS NOT NULL AND id = $2::uuid OR $2::uuid IS NULL AND source = 'user') ORDER BY created_at DESC LIMIT 1",
          [userId, sessionId ?? null],
        );
        if (!activeSession.rows.length) throw Object.assign(new Error("Session Computer sudah berakhir."), { code: "computer_session_expired", status: 409 });
        if (activeSession.rows[0].view_only) throw Object.assign(new Error("Session Computer ini view-only."), { code: "computer_control_not_allowed", status: 409 });
        return instabox.action(mapping.instabox_machine_id, action);
      });
      sendJson(response, 200, result);
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: unknown }).code === "computer_session_expired") {
        sendJson(response, 409, { error: "Session Computer sudah berakhir.", code: "computer_session_expired" });
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

  return {
    name: "koasis-postgres-backend",
    configureServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
      server.middlewares.use("/api/computer/status", computerStatusMiddleware);
      server.middlewares.use("/api/computer/session", computerSessionMiddleware);
      server.middlewares.use("/api/computer/revoke", computerRevokeMiddleware);
      server.middlewares.use("/api/computer/pause", computerPauseMiddleware);
      server.middlewares.use("/api/computer/action", computerActionMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
      server.middlewares.use("/api/computer/status", computerStatusMiddleware);
      server.middlewares.use("/api/computer/session", computerSessionMiddleware);
      server.middlewares.use("/api/computer/revoke", computerRevokeMiddleware);
      server.middlewares.use("/api/computer/pause", computerPauseMiddleware);
      server.middlewares.use("/api/computer/action", computerActionMiddleware);
    },
  };
}
