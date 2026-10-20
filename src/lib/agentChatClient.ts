import type { AgentSourcePolicy } from "./agentCatalog";
import type { EvidenceSource } from "./evidenceSearchClient";
import type { KoasisReasoningLevel } from "./koasisModels";
import { koasisApiUrl } from "./koasisApi";

export type AgentChatAttachment = {
  name: string;
  mimeType: string;
  kind: "image" | "pdf" | "audio";
  dataUrl?: string;
  storagePath?: string;
};

export type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: AgentChatAttachment[];
};

export type AgentWorkspaceContext = {
  rotation?: string;
  unit?: string;
  shift?: string;
  goal?: string;
  notes?: string;
  contextFileName?: string;
  contextFileType?: string;
  activeTasks?: string[];
  phase?: "before" | "during" | "after";
  sourceMode?: "workspace" | "attachments" | "sources";
  evidenceSources?: EvidenceSource[];
  sessionTitle?: string;
  modelId?: string;
  reasoningEffort?: KoasisReasoningLevel;
  /** Explicit user consent for a Computer action in this request. */
  computerApproved?: boolean;
};

interface AgentChatResponse {
  content?: string;
  model?: string;
  error?: string;
  code?: string;
}

export type AgentComputerActivityKind = "starting" | "action" | "screenshot" | "finished" | "error";

export type AgentComputerActivity = {
  kind: AgentComputerActivityKind;
  message: string;
  action?: string;
  screenshotDataUrl?: string;
  requestId?: string;
};

type AgentChatStreamEvent = {
  type?: "meta" | "status" | "computer_activity" | "delta" | "done" | "error";
  content?: string;
  model?: string;
  error?: string;
  code?: string;
  requestId?: string;
  agentId?: string;
  phase?: AgentRunPhase;
  message?: string;
  activity?: AgentComputerActivityKind;
  action?: string;
  screenshotDataUrl?: string;
  durationMs?: number;
  sourcePolicy?: AgentSourcePolicy;
  reviewRequired?: boolean;
  harness?: AgentHarnessDescriptor;
};

export type AgentRunPhase = "accepted" | "preparing" | "generating" | "finalizing";

export type AgentRunStatus = {
  phase: AgentRunPhase;
  message: string;
  requestId?: string;
};

export type AgentHarnessDescriptor = {
  name: string;
  version: string;
  mode: "embedded" | "remote";
  remoteConfigured: boolean;
  persistenceConfigured: boolean;
  capabilities: string[];
};

export type AgentChatResult = {
  content: string;
  model?: string;
  requestId: string;
  agentId: string;
  durationMs?: number;
  sourcePolicy?: AgentSourcePolicy;
  reviewRequired: boolean;
  harness?: AgentHarnessDescriptor;
};

export class AgentChatError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "AgentChatError";
    this.code = code;
  }
}

type AgentChatOptions = {
  signal?: AbortSignal;
  authToken?: string;
  context?: AgentWorkspaceContext;
  onDelta?: (content: string, delta: string) => void;
  onStatus?: (status: AgentRunStatus) => void;
  onComputerActivity?: (activity: AgentComputerActivity) => void;
};

function userFacingAgentError(message: string | undefined, fallback: string): string {
  const value = message?.trim();
  if (!value || /\b(?:agent|ai)\s+backend\b|firebase|postgres|\.env|api\s*key|server-side|instabox/i.test(value)) return fallback;
  return value;
}

async function readError(response: Response): Promise<AgentChatError> {
  try {
    const payload = await response.json() as AgentChatResponse;
    return new AgentChatError(userFacingAgentError(payload.error, "Koasis belum bisa memproses permintaan ini. Coba lagi."), payload.code);
  } catch {
    return new AgentChatError("Koasis belum bisa memproses permintaan ini. Coba lagi.");
  }
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `koasis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendAgentChat(
  messages: AgentChatMessage[],
  agentId: string = "koasis",
  options: AgentChatOptions = {},
): Promise<AgentChatResult> {
  const requestId = createRequestId();
  options.onStatus?.({ phase: "accepted", message: "Permintaan diterima", requestId });
  const response = await fetch(koasisApiUrl("/api/agent/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}) },
    body: JSON.stringify({ messages, agentId, requestId, context: options.context }),
    signal: options.signal,
  });
  if (!response.ok) throw await readError(response);

  const contentType = response.headers.get("content-type") || "";
  if (!/application\/x-ndjson/i.test(contentType) || !response.body) {
    let payload: AgentChatResponse = {};
    try {
      payload = await response.json() as AgentChatResponse;
    } catch {
      throw new AgentChatError("Respons belum lengkap. Coba lagi.");
    }
    if (!payload.content?.trim()) throw new AgentChatError(userFacingAgentError(payload.error, "Koasis belum menerima jawaban. Coba lagi."), payload.code);
    options.onDelta?.(payload.content, payload.content);
    return { content: payload.content.trim(), model: payload.model, requestId, agentId, reviewRequired: true };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model: string | undefined;
  let resolvedRequestId = requestId;
  let resolvedAgentId = agentId;
  let durationMs: number | undefined;
  let sourcePolicy: AgentSourcePolicy | undefined;
  let reviewRequired = true;
  let harness: AgentHarnessDescriptor | undefined;

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;
    let event: AgentChatStreamEvent;
    try {
      event = JSON.parse(line) as AgentChatStreamEvent;
    } catch {
      throw new AgentChatError("Respons belum lengkap. Coba lagi.");
    }
    if (event.type === "meta") {
      if (event.model) model = event.model;
      if (event.requestId) resolvedRequestId = event.requestId;
      if (event.agentId) resolvedAgentId = event.agentId;
      if (event.sourcePolicy) sourcePolicy = event.sourcePolicy;
      if (typeof event.reviewRequired === "boolean") reviewRequired = event.reviewRequired;
      if (event.harness && (event.harness.mode === "embedded" || event.harness.mode === "remote")) harness = event.harness;
    }
    if (event.type === "status" && event.phase) {
      options.onStatus?.({ phase: event.phase, message: event.message || "Agent sedang bekerja", requestId: resolvedRequestId });
    }
    if (event.type === "computer_activity" && event.activity && event.message) {
      const screenshotDataUrl = typeof event.screenshotDataUrl === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(event.screenshotDataUrl)
        ? event.screenshotDataUrl
        : undefined;
      options.onComputerActivity?.({
        kind: event.activity,
        message: event.message,
        ...(event.action ? { action: event.action } : {}),
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
        requestId: resolvedRequestId,
      });
    }
    if (event.type === "delta" && typeof event.content === "string") {
      content += event.content;
      options.onDelta?.(content, event.content);
    }
    if (event.type === "done" && typeof event.durationMs === "number") durationMs = event.durationMs;
    if (event.type === "error") throw new AgentChatError(userFacingAgentError(event.error, "Respons terputus sebelum selesai. Coba lagi."), event.code);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!content.trim()) throw new AgentChatError("Koasis belum menerima jawaban. Coba lagi.");
  return { content: content.trim(), model, requestId: resolvedRequestId, agentId: resolvedAgentId, durationMs, sourcePolicy, reviewRequired, harness };
}
