import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, type PoolConfig } from "pg";
import type { Plugin } from "vite";
import { authenticateAgentRequest } from "./aiAgent";

type Next = (error?: unknown) => void;

const MAX_EVENT_BODY_BYTES = 128 * 1024;
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;

type BackendSettings = {
  databaseUrl: string;
  firebaseProjectId: string;
  ssl: boolean;
  maxConnections: number;
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
  `);
}

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createKoasisBackendPlugin(env: Record<string, string>): Plugin {
  const settings: BackendSettings = {
    databaseUrl: (env.KOASIS_POSTGRES_URL || env.DATABASE_URL || "").trim(),
    firebaseProjectId: (env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || "").trim(),
    ssl: parseBoolean(env.KOASIS_POSTGRES_SSL, true),
    maxConnections: Math.min(20, Math.max(1, Number(env.KOASIS_POSTGRES_MAX_CONNECTIONS || 5) || 5)),
  };
  const pool = createPool(settings);
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

  const healthMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleHealth(request, response);
  };
  const eventMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleEvent(request, response);
  };

  return {
    name: "koasis-postgres-backend",
    configureServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/backend/health", healthMiddleware);
      server.middlewares.use("/api/backend/events", eventMiddleware);
    },
  };
}
