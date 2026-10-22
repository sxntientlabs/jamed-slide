import type { Pool } from "pg";

/**
 * Lightweight Rakazo-compatible runtime boundary for Koasis.
 *
 * The upstream Rakazo distribution is intentionally not bundled into the
 * Firebase frontend. This adapter keeps the useful runtime contracts small:
 * durable run metadata, append-only activity events, and an explicit
 * capability/approval boundary. The provider call and Koasis medical tools
 * remain replaceable behind this boundary when the Dokploy worker is moved
 * to the full Rakazo service.
 */

export const RAKAZO_ADAPTER_NAME = "koasis-rakazo-adapter";
export const RAKAZO_ADAPTER_VERSION = "0.1.0";

export type RakazoRunStatus = "accepted" | "running" | "completed" | "failed" | "cancelled";
export type RakazoApprovalMode = "off" | "ask" | "approved";

export type RakazoRunInput = {
  runId: string;
  userId: string;
  agentId: string;
  modelId?: string;
  reasoningEffort?: string;
  approvalMode: RakazoApprovalMode;
};

export type RakazoRunEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RakazoRunRecord = RakazoRunInput & {
  harness: "rakazo";
  status: RakazoRunStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  events: RakazoRunEvent[];
};

export type RakazoRuntimeDescription = {
  name: typeof RAKAZO_ADAPTER_NAME;
  version: string;
  mode: "embedded" | "remote";
  remoteConfigured: boolean;
  persistenceConfigured: boolean;
  capabilities: readonly string[];
};

export type RakazoAdapter = {
  describe: () => RakazoRuntimeDescription;
  isRemoteConfigured: () => boolean;
  forwardChat: (body: unknown, authorization: string | undefined, signal: AbortSignal) => Promise<Response | null>;
  startRun: (input: RakazoRunInput) => Promise<void>;
  appendEvent: (runId: string, userId: string, type: string, payload?: Record<string, unknown>) => Promise<void>;
  finishRun: (runId: string, userId: string, status: Extract<RakazoRunStatus, "completed" | "failed" | "cancelled">, error?: { code?: string; message?: string }) => Promise<void>;
  getRun: (runId: string, userId: string) => Promise<RakazoRunRecord | null>;
};

const CAPABILITIES = [
  "chat",
  "streaming",
  "specialist-catalog",
  "admin-model-routing",
  "evidence-search",
  "web-search",
  "citations-and-provenance",
  "computer-approval",
  "computer-activity-preview",
  "shared-computer-pool",
  "artifact-workflows",
] as const;

const RUN_STATUS_VALUES = new Set<RakazoRunStatus>(["accepted", "running", "completed", "failed", "cancelled"]);
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9._:-]{0,79}$/;
const DEFAULT_EVENT_LIMIT = 80;

function cleanUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.floor(parsed)) : fallback;
}

function copyPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    // Event payloads are intentionally metadata only. Avoid putting prompts,
    // attachments, screenshots, tokens, or provider responses in the ledger.
    if (/token|secret|password|prompt|attachment|screenshot|content/i.test(key)) continue;
    if (typeof value === "string") output[key] = value.slice(0, 400);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) output[key] = value;
    else if (Array.isArray(value)) output[key] = value.slice(0, 12).map((item) => typeof item === "string" ? item.slice(0, 120) : item);
    else if (value && typeof value === "object") output[key] = "[metadata]";
  }
  return output;
}

function cloneRun(run: RakazoRunRecord): RakazoRunRecord {
  return {
    ...run,
    events: run.events.map((event) => ({ ...event, payload: { ...event.payload } })),
  };
}

function safeErrorMessage(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 240) : undefined;
}

export function createRakazoAdapter(env: Record<string, string>, pool: Pool | null): RakazoAdapter {
  const remoteUrl = cleanUrl(env.KOASIS_RAKAZO_API_URL || env.RAKAZO_API_URL);
  const bridgeSecret = (env.KOASIS_RAKAZO_BRIDGE_SECRET || "").trim();
  const eventLimit = positiveInteger(env.KOASIS_RAKAZO_MAX_RUN_EVENTS, DEFAULT_EVENT_LIMIT, 200);
  const runs = new Map<string, RakazoRunRecord>();
  let schemaPromise: Promise<void> | null = null;
  let persistenceChain = Promise.resolve();

  const ensureSchema = async (): Promise<void> => {
    if (!pool) return;
    if (!schemaPromise) {
      schemaPromise = pool.query(`
        CREATE TABLE IF NOT EXISTS koasis_agent_runs (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          agent_id text NOT NULL,
          model_id text,
          reasoning_effort text,
          approval_mode text NOT NULL DEFAULT 'ask',
          harness text NOT NULL DEFAULT 'rakazo',
          status text NOT NULL DEFAULT 'accepted',
          error_code text,
          error_message text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz
        );
        CREATE INDEX IF NOT EXISTS koasis_agent_runs_user_created_idx
          ON koasis_agent_runs (user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS koasis_agent_run_events (
          id bigserial PRIMARY KEY,
          run_id text NOT NULL REFERENCES koasis_agent_runs(id) ON DELETE CASCADE,
          user_id text NOT NULL,
          event_type text NOT NULL,
          payload jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS koasis_agent_run_events_run_created_idx
          ON koasis_agent_run_events (run_id, created_at ASC);
      `).then(() => undefined).catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    await schemaPromise;
  };

  const persist = (operation: () => Promise<void>): void => {
    // A database outage must never turn a working chat request into a failed
    // request. The in-memory ledger still powers the current run/health API.
    persistenceChain = persistenceChain.then(operation).catch(() => undefined);
  };

  const createRunRow = (input: RakazoRunInput): RakazoRunRecord => {
    const now = new Date().toISOString();
    const run: RakazoRunRecord = {
      ...input,
      harness: "rakazo",
      status: "accepted",
      createdAt: now,
      updatedAt: now,
      events: [],
    };
    runs.set(`${input.userId}:${input.runId}`, run);
    if (runs.size > 500) {
      const oldestKey = runs.keys().next().value;
      if (typeof oldestKey === "string") runs.delete(oldestKey);
    }
    return run;
  };

  const appendMemoryEvent = (run: RakazoRunRecord, type: string, payload: Record<string, unknown>): void => {
    const now = new Date().toISOString();
    run.events.push({ id: `${run.runId}:${run.events.length + 1}`, type, payload, createdAt: now });
    if (run.events.length > eventLimit) run.events.splice(0, run.events.length - eventLimit);
    run.updatedAt = now;
    if (type === "run.preparing" || type === "run.generating" || type === "tool.activity") run.status = "running";
  };

  const startRun = async (input: RakazoRunInput): Promise<void> => {
    const run = createRunRow({
      ...input,
      agentId: input.agentId.slice(0, 64),
      modelId: input.modelId?.slice(0, 180),
      reasoningEffort: input.reasoningEffort?.slice(0, 32),
    });
    appendMemoryEvent(run, "run.accepted", { agentId: run.agentId, approvalMode: run.approvalMode });
    if (!pool) return;
    persist(async () => {
      await ensureSchema();
      await pool.query(
        `INSERT INTO koasis_agent_runs (id, user_id, agent_id, model_id, reasoning_effort, approval_mode, harness, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'rakazo', 'accepted')
         ON CONFLICT (id) DO UPDATE SET updated_at = now(), status = 'accepted'`,
        [run.runId, run.userId, run.agentId, run.modelId || null, run.reasoningEffort || null, run.approvalMode],
      );
      await pool.query(
        "INSERT INTO koasis_agent_run_events (run_id, user_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [run.runId, run.userId, "run.accepted", JSON.stringify(run.events[0]?.payload || {})],
      );
    });
  };

  const appendEvent = async (runId: string, userId: string, type: string, rawPayload: Record<string, unknown> = {}): Promise<void> => {
    if (!EVENT_TYPE_PATTERN.test(type)) return;
    const payload = copyPayload(rawPayload);
    const run = runs.get(`${userId}:${runId}`);
    if (run) appendMemoryEvent(run, type, payload);
    if (!pool) return;
    persist(async () => {
      await ensureSchema();
      await pool.query(
        "INSERT INTO koasis_agent_run_events (run_id, user_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [runId, userId, type, JSON.stringify(payload)],
      );
      const nextStatus = type === "run.preparing" || type === "run.generating" || type === "tool.activity" ? "running" : undefined;
      if (nextStatus) await pool.query("UPDATE koasis_agent_runs SET status = $1, updated_at = now() WHERE id = $2 AND user_id = $3", [nextStatus, runId, userId]);
      else await pool.query("UPDATE koasis_agent_runs SET updated_at = now() WHERE id = $1 AND user_id = $2", [runId, userId]);
    });
  };

  const finishRun = async (runId: string, userId: string, status: Extract<RakazoRunStatus, "completed" | "failed" | "cancelled">, error?: { code?: string; message?: string }): Promise<void> => {
    if (!RUN_STATUS_VALUES.has(status)) return;
    const run = runs.get(`${userId}:${runId}`);
    const now = new Date().toISOString();
    if (run) {
      run.status = status;
      run.updatedAt = now;
      run.completedAt = now;
      run.errorCode = safeErrorMessage(error?.code);
      run.errorMessage = safeErrorMessage(error?.message);
      appendMemoryEvent(run, `run.${status}`, {
        ...(run.errorCode ? { errorCode: run.errorCode } : {}),
      });
    }
    if (!pool) return;
    persist(async () => {
      await ensureSchema();
      const errorCode = safeErrorMessage(error?.code) || null;
      const errorMessage = safeErrorMessage(error?.message) || null;
      await pool.query(
        "UPDATE koasis_agent_runs SET status = $1, error_code = $2, error_message = $3, updated_at = now(), completed_at = now() WHERE id = $4 AND user_id = $5",
        [status, errorCode, errorMessage, runId, userId],
      );
      await pool.query(
        "INSERT INTO koasis_agent_run_events (run_id, user_id, event_type, payload) VALUES ($1, $2, $3, $4::jsonb)",
        [runId, userId, `run.${status}`, JSON.stringify(errorCode ? { errorCode } : {})],
      );
    });
  };

  const getRun = async (runId: string, userId: string): Promise<RakazoRunRecord | null> => {
    const cached = runs.get(`${userId}:${runId}`);
    if (cached) return cloneRun(cached);
    if (!pool) return null;
    try {
      await ensureSchema();
      const result = await pool.query<{
        id: string;
        user_id: string;
        agent_id: string;
        model_id: string | null;
        reasoning_effort: string | null;
        approval_mode: RakazoApprovalMode;
        status: RakazoRunStatus;
        created_at: Date;
        updated_at: Date;
        completed_at: Date | null;
        error_code: string | null;
        error_message: string | null;
      }>("SELECT id, user_id, agent_id, model_id, reasoning_effort, approval_mode, status, created_at, updated_at, completed_at, error_code, error_message FROM koasis_agent_runs WHERE id = $1 AND user_id = $2", [runId, userId]);
      const row = result.rows[0];
      if (!row) return null;
      const events = await pool.query<{ id: string; event_type: string; payload: Record<string, unknown>; created_at: Date }>(
        "SELECT id::text, event_type, payload, created_at FROM koasis_agent_run_events WHERE run_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT $3",
        [runId, userId, eventLimit],
      );
      return {
        runId: row.id,
        userId: row.user_id,
        agentId: row.agent_id,
        modelId: row.model_id || undefined,
        reasoningEffort: row.reasoning_effort || undefined,
        approvalMode: row.approval_mode,
        harness: "rakazo",
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        completedAt: row.completed_at?.toISOString(),
        errorCode: row.error_code || undefined,
        errorMessage: row.error_message || undefined,
        events: events.rows.map((event) => ({ id: event.id, type: event.event_type, payload: event.payload || {}, createdAt: event.created_at.toISOString() })),
      };
    } catch {
      return null;
    }
  };

  return {
    describe: () => ({
      name: RAKAZO_ADAPTER_NAME,
      version: RAKAZO_ADAPTER_VERSION,
      mode: remoteUrl ? "remote" : "embedded",
      remoteConfigured: Boolean(remoteUrl),
      persistenceConfigured: Boolean(pool),
      capabilities: CAPABILITIES,
    }),
    isRemoteConfigured: () => Boolean(remoteUrl),
    forwardChat: async (body, authorization, signal) => {
      if (!remoteUrl) return null;
      return fetch(`${remoteUrl}/api/agent/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Koasis-Rakazo-Forwarded": "1",
          ...(bridgeSecret ? { "X-Koasis-Rakazo-Secret": bridgeSecret } : {}),
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    },
    startRun,
    appendEvent,
    finishRun,
    getRun,
  };
}
