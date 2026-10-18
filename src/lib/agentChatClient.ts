import type { AgentId, AgentSourcePolicy } from "./agentCatalog";
import type { KoasisModelId, KoasisReasoningLevel } from "./koasisModels";

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
  sessionTitle?: string;
  modelId?: KoasisModelId;
  reasoningEffort?: KoasisReasoningLevel;
};

interface AgentChatResponse {
  content?: string;
  model?: string;
  error?: string;
  code?: string;
}

type AgentChatStreamEvent = {
  type?: "meta" | "status" | "delta" | "done" | "error";
  content?: string;
  model?: string;
  error?: string;
  code?: string;
  requestId?: string;
  agentId?: AgentId;
  phase?: AgentRunPhase;
  message?: string;
  durationMs?: number;
  sourcePolicy?: AgentSourcePolicy;
  reviewRequired?: boolean;
};

export type AgentRunPhase = "accepted" | "preparing" | "generating" | "finalizing";

export type AgentRunStatus = {
  phase: AgentRunPhase;
  message: string;
  requestId?: string;
};

export type AgentChatResult = {
  content: string;
  model?: string;
  requestId: string;
  agentId: AgentId;
  durationMs?: number;
  sourcePolicy?: AgentSourcePolicy;
  reviewRequired: boolean;
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
};

async function readError(response: Response): Promise<AgentChatError> {
  try {
    const payload = await response.json() as AgentChatResponse;
    return new AgentChatError(payload.error || `Agent backend gagal (HTTP ${response.status}).`, payload.code);
  } catch {
    return new AgentChatError(`Agent backend gagal (HTTP ${response.status}).`);
  }
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `koasis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendAgentChat(
  messages: AgentChatMessage[],
  agentId: AgentId = "koasis",
  options: AgentChatOptions = {},
): Promise<AgentChatResult> {
  const requestId = createRequestId();
  options.onStatus?.({ phase: "accepted", message: "Permintaan diterima", requestId });
  const response = await fetch("/api/agent/chat", {
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
      throw new AgentChatError(`Agent backend mengembalikan response yang tidak valid (HTTP ${response.status}).`);
    }
    if (!payload.content?.trim()) throw new AgentChatError(payload.error || "Agent backend tidak mengirim isi jawaban.", payload.code);
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

  const consumeLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;
    let event: AgentChatStreamEvent;
    try {
      event = JSON.parse(line) as AgentChatStreamEvent;
    } catch {
      throw new AgentChatError("Agent backend mengirim potongan stream yang tidak valid.");
    }
    if (event.type === "meta") {
      if (event.model) model = event.model;
      if (event.requestId) resolvedRequestId = event.requestId;
      if (event.agentId) resolvedAgentId = event.agentId;
      if (event.sourcePolicy) sourcePolicy = event.sourcePolicy;
      if (typeof event.reviewRequired === "boolean") reviewRequired = event.reviewRequired;
    }
    if (event.type === "status" && event.phase) {
      options.onStatus?.({ phase: event.phase, message: event.message || "Agent sedang bekerja", requestId: resolvedRequestId });
    }
    if (event.type === "delta" && typeof event.content === "string") {
      content += event.content;
      options.onDelta?.(content, event.content);
    }
    if (event.type === "done" && typeof event.durationMs === "number") durationMs = event.durationMs;
    if (event.type === "error") throw new AgentChatError(event.error || "Streaming agent terputus.", event.code);
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
  if (!content.trim()) throw new AgentChatError("Agent backend tidak mengirim isi jawaban.");
  return { content: content.trim(), model, requestId: resolvedRequestId, agentId: resolvedAgentId, durationMs, sourcePolicy, reviewRequired };
}
