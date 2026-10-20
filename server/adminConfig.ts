import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool, type PoolConfig } from "pg";
import { createDefaultAdminConfig, sanitizeAdminConfig, toPublicAdminCatalog, type AdminConfig, type PublicAdminCatalog } from "../src/lib/adminConfig";

const ADMIN_CONFIG_ROW_ID = "default";
const ADMIN_COOKIE = "koasis_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type AdminConfigStore = {
  configured: boolean;
  passwordConfigured: boolean;
  load: () => Promise<AdminConfig>;
  save: (value: unknown) => Promise<AdminConfig>;
  publicCatalog: () => Promise<PublicAdminCatalog>;
  authenticatePassword: (value: unknown) => boolean;
  isAuthenticated: (request: IncomingMessage) => boolean;
  setSession: (request: IncomingMessage, response: ServerResponse) => void;
  clearSession: (response: ServerResponse) => void;
};

export function createAdminConfigPool(databaseUrl: string, ssl = true, maxConnections = 5): Pool | null {
  if (!databaseUrl.trim()) return null;
  const config: PoolConfig = {
    connectionString: databaseUrl.trim(),
    max: Math.min(20, Math.max(1, maxConnections)),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  };
  if (ssl) config.ssl = { rejectUnauthorized: false };
  return new Pool(config);
}

type AdminConfigStoreOptions = {
  pool: Pool | null;
  providerModelIds?: Partial<Record<"cito" | "elective" | "executive", string>>;
  password?: string;
  sessionSecret?: string;
};

function readCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part.trim(), ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => Boolean(key)));
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    timingSafeEqual(leftBuffer, Buffer.alloc(leftBuffer.length));
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSessionToken(secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const nonce = randomBytes(18).toString("base64url");
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${sessionSignature(payload, secret)}`;
}

function isValidSessionToken(token: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || Math.floor(Date.now() / 1_000) - issuedAt > ADMIN_SESSION_TTL_SECONDS || issuedAt > Math.floor(Date.now() / 1_000) + 30) return false;
  const expected = sessionSignature(`${parts[0]}.${parts[1]}`, secret);
  return safeEqualText(expected, parts[2]);
}

function secureCookie(request: IncomingMessage): boolean {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  return forwardedProtocol === "https" || (Array.isArray(forwardedProtocol) && forwardedProtocol.includes("https"));
}

export function createAdminConfigStore(options: AdminConfigStoreOptions): AdminConfigStore {
  const { pool } = options;
  const password = (options.password || "").trim();
  const secret = (options.sessionSecret || password || randomBytes(32).toString("hex")).trim();
  const fallback = createDefaultAdminConfig(options.providerModelIds);
  let schemaPromise: Promise<void> | null = null;
  let cache: { config: AdminConfig; expiresAt: number } | null = null;

  const ensureSchema = async (): Promise<void> => {
    if (!pool) throw new Error("PostgreSQL belum dikonfigurasi di server.");
    if (!schemaPromise) {
      schemaPromise = pool.query(`
        CREATE TABLE IF NOT EXISTS koasis_admin_config (
          id text PRIMARY KEY,
          config jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now(),
          updated_by text
        );
      `).then(() => undefined).catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
  };

  const load = async (): Promise<AdminConfig> => {
    if (!pool) return fallback;
    if (cache && cache.expiresAt > Date.now()) return cache.config;
    await ensureSchema();
    const result = await pool.query<{ config: unknown; updated_at: Date }>("SELECT config, updated_at FROM koasis_admin_config WHERE id = $1", [ADMIN_CONFIG_ROW_ID]);
    if (!result.rows[0]) {
      const initial = sanitizeAdminConfig(fallback, fallback);
      await pool.query("INSERT INTO koasis_admin_config (id, config, updated_at, updated_by) VALUES ($1, $2::jsonb, now(), $3) ON CONFLICT (id) DO NOTHING", [ADMIN_CONFIG_ROW_ID, JSON.stringify(initial), "system"]);
      cache = { config: initial, expiresAt: Date.now() + 2_000 };
      return initial;
    }
    const config = sanitizeAdminConfig(result.rows[0].config, fallback);
    config.updatedAt = result.rows[0].updated_at?.toISOString();
    cache = { config, expiresAt: Date.now() + 2_000 };
    return config;
  };

  const save = async (value: unknown): Promise<AdminConfig> => {
    if (!pool) throw new Error("PostgreSQL belum dikonfigurasi di server.");
    await ensureSchema();
    const current = await load();
    const config = sanitizeAdminConfig(value, current);
    config.updatedAt = new Date().toISOString();
    await pool.query(
      "INSERT INTO koasis_admin_config (id, config, updated_at, updated_by) VALUES ($1, $2::jsonb, now(), $3) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by",
      [ADMIN_CONFIG_ROW_ID, JSON.stringify(config), "admin"],
    );
    cache = { config, expiresAt: Date.now() + 2_000 };
    return config;
  };

  return {
    configured: Boolean(pool),
    passwordConfigured: Boolean(password),
    load,
    save,
    publicCatalog: async () => {
      try {
        return toPublicAdminCatalog(await load());
      } catch {
        return toPublicAdminCatalog(fallback);
      }
    },
    authenticatePassword: (value) => typeof value === "string" && Boolean(password) && safeEqualText(value, password),
    isAuthenticated: (request) => {
      if (!password) return false;
      const token = readCookies(request)[ADMIN_COOKIE];
      return Boolean(token && isValidSessionToken(token, secret));
    },
    setSession: (request, response) => {
      const token = createSessionToken(secret);
      const secure = secureCookie(request) ? "; Secure" : "";
      // The admin UI lives at /admin while its API lives at /api/admin, so the
      // session must cover both paths. It remains HttpOnly and same-site.
      response.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${ADMIN_SESSION_TTL_SECONDS}${secure}`);
    },
    clearSession: (response) => {
      response.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    },
  };
}
