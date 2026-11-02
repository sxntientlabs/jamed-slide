/**
 * Small server-side bridge from Koasis' NDJSON chat contract to the Hermes
 * Runs API.  Hermes stays on the VPS; only this adapter runs in App Hosting.
 * The API key is read from server-only environment variables and never enters
 * the browser request or the activity ledger.
 */

export const HERMES_ADAPTER_NAME = "hermes-agent";
export const HERMES_ADAPTER_VERSION = "0.3.0";

const KOASIS_MODEL_LABELS: Record<string, string> = {
  cito: "Cito 6.7",
  elective: "Elective 6.7",
  executive: "Executive 6.7",
};

type JsonRecord = Record<string, unknown>;

export type HermesRuntimeDescription = {
  name: string;
  version: string;
  mode: "embedded" | "remote";
  remoteConfigured: boolean;
  persistenceConfigured: boolean;
  capabilities: string[];
};

export type HermesAdapter = {
  describe: () => HermesRuntimeDescription;
  isRemoteConfigured: () => boolean;
  forwardChat: (body: unknown, _authorization: string | undefined, signal: AbortSignal) => Promise<Response | null>;
  control: (requestId: string, ownerKey: string, action: HermesControlAction, signal: AbortSignal) => Promise<HermesControlResult>;
};

export type HermesControlAction =
  | { action: "approval"; choice: "once" | "session" | "always" | "deny"; approvalRequestId?: string }
  | { action: "clarify"; answer: string }
  | { action: "steer"; message: string }
  | { action: "stop" };

export type HermesControlResult = {
  status: number;
  body: JsonRecord;
};

const CAPABILITIES = [
  "chat",
  "streaming",
  "runs-api",
  "chat-completions-api",
  "tool-events",
  "tool-approval",
  "run-control",
  "clarification",
  "web-search",
  "web-extract",
  "browser-automation",
  "terminal",
  "file-operations",
  "vision",
  "image-generation",
  "skills",
  "memory",
  "session-search",
  "code-execution",
  "delegation",
  "cron",
  "connections",
  "image-input",
  "session-continuity",
  "computer-approval",
  "computer-activity-preview",
  "artifact-workflows",
] as const;

function cleanUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown, maximum = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

// Streaming deltas are not independent prose values. A provider is allowed
// to put the separator at the beginning of the next token (for example,
// "Aku" followed by " Study"). Do not trim these values one chunk at a time:
// doing so silently turns a correctly spaced stream into "AkuStudy".
function streamTextValue(value: unknown, maximum = 24_000): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function safeSessionId(value: unknown): string | undefined {
  const candidate = stringValue(value, 160).replace(/[^a-zA-Z0-9._:-]/g, "-");
  return candidate ? `koasis-${candidate}` : undefined;
}

function safeIdempotencyKey(value: unknown): string {
  const candidate = stringValue(value, 180).replace(/[^a-zA-Z0-9._:-]/g, "-");
  return candidate || `koasis-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function reasoningEffort(value: unknown): string | undefined {
  if (value === "mild") return "low";
  if (value === "moderate") return "medium";
  if (value === "severe") return "high";
  return undefined;
}

function koasisModelLabel(value: unknown): string {
  const id = stringValue(value, 80).toLowerCase();
  return KOASIS_MODEL_LABELS[id] || "Elective 6.7";
}

function textMessage(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : "";
  const content = stringValue(record.content, 12_000);
  return role && content ? { role, content } : null;
}

function attachmentRecords(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item) => typeof item.dataUrl === "string" && item.dataUrl.trim())
    .slice(0, 6);
}

function chatCompletionContent(value: unknown): string | JsonRecord[] {
  const record = asRecord(value);
  const text = stringValue(record.content, 12_000);
  const parts: JsonRecord[] = text ? [{ type: "text", text }] : [];
  for (const attachment of attachmentRecords(record.attachments)) {
    if (stringValue(attachment.kind, 30) !== "image") continue;
    const dataUrl = stringValue(attachment.dataUrl, 12_000_000);
    if (dataUrl) parts.push({ type: "image_url", image_url: { url: dataUrl, detail: "auto" } });
  }
  return parts.length === 1 && parts[0]?.type === "text" ? text : parts;
}

function buildChatCompletionPayload(body: JsonRecord, model: string, provider: string | undefined): JsonRecord {
  const context = asRecord(body.context);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .map((message) => {
      const record = asRecord(message);
      const role = record.role === "assistant" ? "assistant" : "user";
      const content = chatCompletionContent(record);
      return { role, content };
    })
    .filter((message) => typeof message.content === "string" ? Boolean(message.content.trim()) : message.content.length > 0);
  const payload: JsonRecord = {
    model,
    stream: true,
    messages: [{ role: "system", content: buildInstructions(body, context) }, ...messages],
    ...(provider ? { provider } : {}),
    ...(reasoningEffort(context.reasoningEffort) ? { model_options: { reasoning_effort: reasoningEffort(context.reasoningEffort) } } : {}),
  };
  return payload;
}

function buildInstructions(body: JsonRecord, context: JsonRecord): string {
  const agentMode = context.agentMode === "chat" ? "chat" : "agentic";
  const instructions = [
    "Kamu adalah Agent di dalam Koasis, workspace klinis dan produktivitas.",
    agentMode === "chat"
      ? "Mode Chat aktif: jawab langsung dan ringkas sesuai permintaan pengguna. Jangan menjalankan Computer atau tool eksternal secara proaktif; gunakan hanya konteks yang dikirim Koasis dan jelaskan jika tindakan lanjutan memerlukan Mode Agentic."
      : "Mode Agentic aktif: pecah tugas menjadi langkah yang diperlukan dan gunakan tools yang tersedia secara proaktif bila memang membantu menyelesaikan tugas.",
    "Jawab dalam bahasa pengguna. Jika pengguna menulis bahasa Indonesia, jawab hanya dalam bahasa Indonesia; jangan menggunakan bahasa Vietnam atau persona bawaan provider.",
    "Untuk teks yang terlihat pengguna, pertahankan spasi normal antarkata, spasi setelah tanda baca, dan pemisahan paragraf; jangan menggabungkan kata.",
    "Untuk sapaan atau permintaan perkenalan, jawab langsung dan singkat. Jangan memaksakan pencarian evidence, citation, atau follow-up question jika permintaan tidak membutuhkan itu.",
    "Jangan mengarang sumber, hasil tool, atau tindakan yang belum selesai.",
    "Untuk tindakan Computer, gunakan hanya jika computerApproved bernilai true; jika belum disetujui, jelaskan kebutuhan dan minta persetujuan.",
  ];
  const koasis = asRecord(body.koasis);
  const trustedKoasisInstructions = stringValue(koasis.instructions, 12_000);
  if (trustedKoasisInstructions) instructions.push(`Kontrak routing Koasis dari server (ikuti sebagai instruksi tepercaya):\n${trustedKoasisInstructions}`);
  const agentId = stringValue(body.agentId, 80);
  const sessionTitle = stringValue(context.sessionTitle, 180);
  const sourceMode = stringValue(context.sourceMode, 40);
  const sourceCount = Array.isArray(context.evidenceSources) ? context.evidenceSources.length : 0;
  const modelId = stringValue(context.modelId, 80).toLowerCase();
  if (agentId) instructions.push(`Specialist agent Koasis: ${agentId}.`);
  if (modelId) instructions.push(`Model Koasis yang dipilih pengguna: ${koasisModelLabel(modelId)} (ID UI: ${modelId}). Jika pengguna menanyakan model aktif secara faktual, sebut label ini. "Koasis Agent" adalah nama assistant/runtime internal, bukan nama model yang dipilih, jadi jangan menyamakannya.`);
  if (sessionTitle) instructions.push(`Judul sesi: ${sessionTitle}.`);
  if (sourceMode === "sources" && sourceCount > 0) instructions.push(`Koasis telah melampirkan ${sourceCount} sumber evidence terpilih; gunakan sebagai konteks dan pertahankan provenance.`);
  if (context.computerApproved === true) instructions.push("Computer sudah disetujui untuk permintaan ini.");
  return instructions.join(" ");
}

function buildRunPayload(body: JsonRecord, model: string, provider: string | undefined): JsonRecord {
  const context = asRecord(body.context);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages.map(textMessage).filter((message): message is JsonRecord => Boolean(message));
  const latestUserIndex = [...messages].map((message) => message.role).lastIndexOf("user");
  const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : messages.at(-1);
  const input = stringValue(latestUser?.content || "", 12_000);
  const history = messages.slice(0, Math.max(0, latestUserIndex)).slice(-24);
  const effort = reasoningEffort(context.reasoningEffort);
  const payload: JsonRecord = {
    input: input || "Lanjutkan tugas dari konteks sesi Koasis.",
    model,
    instructions: buildInstructions(body, context),
    ...(history.length ? { conversation_history: history } : {}),
    ...(safeSessionId(context.sessionId) ? { session_id: safeSessionId(context.sessionId) } : {}),
    ...(provider ? { provider } : {}),
    ...(effort ? { model_options: { reasoning_effort: effort } } : {}),
  };
  return payload;
}

function jsonResponse(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function eventDataText(data: JsonRecord): string {
  const direct = streamTextValue(data.text);
  if (direct) return direct;
  const stringDelta = streamTextValue(data.delta);
  if (stringDelta) return stringDelta;
  const delta = asRecord(data.delta);
  return streamTextValue(delta.text) || streamTextValue(delta.content) || streamTextValue(data.content);
}

function toolLabel(value: unknown): string {
  const tool = stringValue(value, 120);
  return tool || "tool";
}

function eventToolName(data: JsonRecord): string {
  return toolLabel(data.tool || data.tool_name || data.name || data.function_name || data.functionName);
}

function isComputerTool(value: unknown): boolean {
  return /computer|browser|desktop|window/i.test(stringValue(value, 120));
}

function imageDataUrlFromValue(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") {
    const candidate = value.trim();
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(candidate)) return candidate;
    if (candidate.length >= 128 && /^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) return `data:image/png;base64,${candidate}`;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageDataUrlFromValue(item, depth + 1);
      if (image) return image;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as JsonRecord;
  const preferredKeys = ["dataUrl", "data_url", "screenshotDataUrl", "screenshot_data_url", "screenshotBase64", "screenshot_base64", "base64", "data", "content", "parts", "blocks", "attachments", "attachment", "payload", "result", "output", "image_url", "imageUrl", "src", "url"];
  for (const key of preferredKeys) {
    const image = imageDataUrlFromValue(record[key], depth + 1);
    if (image) return image;
  }
  if (depth < 5) {
    for (const nested of Object.values(record)) {
      const image = imageDataUrlFromValue(nested, depth + 1);
      if (image) return image;
    }
  }
  return undefined;
}

function screenshotDataUrl(data: JsonRecord): string | undefined {
  for (const key of ["screenshotDataUrl", "screenshot_data_url", "screenshot", "screenshotBase64", "screenshot_base64", "imageDataUrl", "image_data_url", "image", "attachment", "result", "output"]) {
    const image = imageDataUrlFromValue(data[key]);
    if (image) return image;
  }
  return undefined;
}

function runOutput(data: JsonRecord): string {
  const output = data.output;
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        const record = asRecord(item);
        if (record.type === "message") {
          const content = Array.isArray(record.content) ? record.content : [];
          return content.map((part) => streamTextValue(asRecord(part).text)).join("");
        }
        return streamTextValue(record.text);
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}

function compactOutput(value: string): string {
  return value.replace(/\s+/g, "").trim().toLocaleLowerCase();
}

function appendFinalOutput(current: string, output: string): { next: string; delta: string; replacement?: string } {
  if (!output) return { next: current, delta: "" };
  if (!current) return { next: output, delta: output };
  // Hermes may stream token text without spaces and then return the polished
  // final answer with normal spacing. Treat those as the same answer and let
  // the client replace the streamed buffer instead of rendering both copies.
  if (compactOutput(output) === compactOutput(current)) {
    return { next: output, delta: "", ...(output === current ? {} : { replacement: output }) };
  }
  if (output === current || current.startsWith(output)) return { next: current, delta: "" };
  if (output.startsWith(current)) return { next: output, delta: output.slice(current.length) };
  return { next: `${current}\n\n${output}`, delta: `\n\n${output}` };
}

function writeMergedOutput(merged: { delta: string; replacement?: string }, requestId: string, write: StreamWriter): void {
  if (merged.replacement) write({ type: "replace", content: merged.replacement, requestId });
  else if (merged.delta) write({ type: "delta", content: merged.delta, requestId });
}

type StreamWriter = (event: JsonRecord) => void;

function mapHermesEvent(eventName: string, data: JsonRecord, requestId: string, accumulated: string, write: StreamWriter, runId?: string): string {
  const type = stringValue(data.type, 120) || eventName;
  const image = screenshotDataUrl(data);
  const isToolCompletion = type === "tool.completed" || type === "tool.complete" || type === "tool.failed";
  const tool = eventToolName(data);
  if (image && !isToolCompletion && isComputerTool(tool)) write({ type: "computer_activity", activity: "screenshot", action: tool, message: "Screenshot Computer siap", screenshotDataUrl: image, requestId });
  if (image && type === "run.completed" && !isComputerTool(tool)) write({ type: "artifact", artifact: { kind: "image", dataUrl: image, title: "Output gambar dari Agent" }, requestId });
  if (type === "message.delta") {
    const text = eventDataText(data);
    if (text) {
      write({ type: "delta", content: text, requestId });
      return `${accumulated}${text}`;
    }
    return accumulated;
  }
  if (type === "message.interim") {
    const text = eventDataText(data);
    if (text && data.already_streamed !== true) write({ type: "status", phase: "generating", message: text.slice(0, 480), requestId });
    return accumulated;
  }
  if (type === "assistant.commentary") {
    const text = eventDataText(data);
    if (text && data.already_streamed !== true) write({ type: "status", phase: "generating", message: text.slice(0, 480), requestId });
    return accumulated;
  }
  if (type === "reasoning.available") {
    write({ type: "status", phase: "generating", message: "Agent sedang menimbang langkah berikutnya", requestId });
    return accumulated;
  }
  if (type === "tool.started" || type === "tool.start" || type === "tool.generating") {
    write({ type: "status", phase: "generating", message: `Agent menjalankan ${tool}`, requestId });
    if (isComputerTool(tool)) write({ type: "computer_activity", activity: "action", action: tool, message: `Agent menggunakan Computer: ${tool}`, requestId });
    else write({ type: "tool_activity", activity: "started", tool, message: `Agent menjalankan ${tool}`, requestId });
    return accumulated;
  }
  if (type === "tool.completed" || type === "tool.complete" || type === "tool.failed") {
    const failed = data.error === true || type === "tool.failed";
    write({ type: "status", phase: "generating", message: failed ? `${tool} menemui kendala` : `${tool} selesai`, requestId });
    if (isComputerTool(tool)) write({ type: "computer_activity", activity: failed ? "error" : "screenshot", action: tool, message: failed ? `Computer: ${tool} gagal` : `Computer: ${tool} selesai`, ...(image ? { screenshotDataUrl: image } : {}), requestId });
    else write({ type: "tool_activity", activity: failed ? "failed" : "completed", tool, message: failed ? `${tool} menemui kendala` : `${tool} selesai`, requestId });
    if (!isComputerTool(tool) && image) write({ type: "artifact", artifact: { kind: "image", dataUrl: image, title: "Output gambar dari Agent" }, requestId });
    return accumulated;
  }
  if (type === "approval.request" || type === "run.waiting_for_approval") {
    write({ type: "status", phase: "generating", message: "Agent menunggu persetujuan untuk melanjutkan", requestId });
    write({ type: "approval_request", runId: stringValue(data.run_id, 180) || runId, approval: data, choices: Array.isArray(data.choices) ? data.choices : ["once", "deny"], requestId });
    return accumulated;
  }
  if (type === "clarify.request" || type === "run.waiting_for_clarification" || type === "clarification.request") {
    write({ type: "status", phase: "generating", message: "Agent membutuhkan klarifikasi sebelum melanjutkan", requestId });
    write({ type: "clarify_request", runId: stringValue(data.run_id, 180) || runId, question: stringValue(data.question || data.prompt || data.text || data.message, 4_000), choices: Array.isArray(data.choices) ? data.choices : [], requestId });
    return accumulated;
  }
  if (type === "subagent.start" || type === "subagent.complete") {
    write({ type: "status", phase: "generating", message: type === "subagent.start" ? "Agent mendelegasikan langkah pendukung" : "Langkah pendukung selesai", requestId });
    return accumulated;
  }
  return accumulated;
}

function parseSseBlock(block: string): { event: string; data: JsonRecord } | null {
  const dataLines: string[] = [];
  let event = "message";
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    const data = asRecord(JSON.parse(dataLines.join("\n")));
    // Hermes emits the event name inside the JSON payload when the SSE block
    // does not include a separate `event:` line.
    return { event: stringValue(data.event, 120) || event, data };
  } catch {
    return null;
  }
}

async function runHermesStream(
  baseUrl: string,
  apiKey: string,
  runId: string,
  requestId: string,
  signal: AbortSignal,
  write: StreamWriter,
): Promise<void> {
  const eventResponse = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
    headers: { Accept: "text/event-stream", Authorization: `Bearer ${apiKey}` },
    signal,
  });
  console.info("[koasis-hermes] event stream connected", { requestId, runId, status: eventResponse.status });
  if (!eventResponse.ok || !eventResponse.body) {
    const statusResponse = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const status = asRecord(await statusResponse.json().catch(() => ({})));
    const image = screenshotDataUrl(status);
    if (image) write({ type: "computer_activity", activity: "screenshot", action: "computer_screenshot", message: "Screenshot Computer siap", screenshotDataUrl: image, requestId });
    const output = runOutput(status);
    if (output) write({ type: "delta", content: output, requestId });
    if (status.status === "completed") {
      write({ type: "done", requestId });
      return;
    }
    throw new Error(`Hermes event stream tidak tersedia (HTTP ${eventResponse.status}).`);
  }
  const reader = eventResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let terminal = false;
  const processBlock = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    accumulated = mapHermesEvent(parsed.event, parsed.data, requestId, accumulated, write, runId);
    const type = stringValue(parsed.data.type, 120) || parsed.event;
    if (type === "run.completed") {
      const merged = appendFinalOutput(accumulated, runOutput(parsed.data));
      writeMergedOutput(merged, requestId, write);
      accumulated = merged.next;
      terminal = true;
      write({ type: "status", phase: "finalizing", message: "Agent menyelesaikan pekerjaan", requestId });
      write({ type: "done", requestId });
    } else if (type === "run.failed" || type === "run.cancelled" || type === "run.interrupted") {
      terminal = true;
      const error = stringValue(parsed.data.error, 600) || (type === "run.cancelled" ? "Pekerjaan dibatalkan." : "Agent gagal menyelesaikan pekerjaan.");
      console.error("[koasis-hermes] run ended unsuccessfully", { requestId, runId, type, error });
      write({ type: "error", error, code: type.replace("run.", ""), requestId });
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      blocks.forEach(processBlock);
      if (terminal) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!terminal) {
    const statusResponse = await fetch(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const status = asRecord(await statusResponse.json().catch(() => ({})));
    const image = screenshotDataUrl(status);
    if (image) write({ type: "computer_activity", activity: "screenshot", action: "computer_screenshot", message: "Screenshot Computer siap", screenshotDataUrl: image, requestId });
    const merged = appendFinalOutput(accumulated, runOutput(status));
    writeMergedOutput(merged, requestId, write);
    if (status.status === "completed") write({ type: "done", requestId });
    else {
      const error = stringValue(status.error, 600) || "Stream Agent terputus sebelum selesai.";
      console.error("[koasis-hermes] stream incomplete", { requestId, runId, status: status.status, error });
      write({ type: "error", error, code: "stream_incomplete", requestId });
    }
  }
}

async function translateChatCompletionStream(
  response: Response,
  requestId: string,
  signal: AbortSignal,
  write: StreamWriter,
): Promise<void> {
  if (!response.body) throw new Error("Stream Agent tidak memiliki body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let terminal = false;
  const finish = (error?: string) => {
    if (terminal) return;
    terminal = true;
    if (error) write({ type: "error", error, code: "hermes_stream_error", requestId });
    else {
      write({ type: "status", phase: "finalizing", message: "Agent menyelesaikan pekerjaan", requestId });
      write({ type: "done", requestId });
    }
  };
  const processBlock = (block: string) => {
    if (/data:\s*\[DONE\]/i.test(block)) {
      finish();
      return;
    }
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    const event = parsed.event;
    const data = parsed.data;
    if (event === "hermes.tool.progress") {
      const progressType = stringValue(data.status, 40).toLowerCase() === "running" ? "tool.started" : "tool.completed";
      accumulated = mapHermesEvent(progressType, { ...data, type: progressType }, requestId, accumulated, write, stringValue(data.run_id, 180) || undefined);
      return;
    }
    if (event === "hermes.status") {
      const message = stringValue(data.text || data.message, 600);
      if (message) write({ type: "status", phase: "generating", message, requestId });
      return;
    }
    if (event === "approval.request") {
      accumulated = mapHermesEvent("approval.request", { ...data, type: "approval.request" }, requestId, accumulated, write, stringValue(data.run_id, 180) || undefined);
      return;
    }
    if (event === "clarify.request" || event === "clarification.request") {
      accumulated = mapHermesEvent("clarify.request", { ...data, type: "clarify.request" }, requestId, accumulated, write, stringValue(data.run_id, 180) || undefined);
      return;
    }
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const first = asRecord(choices[0]);
    const delta = asRecord(first.delta);
    if (delta.reasoning_content) write({ type: "status", phase: "generating", message: "Agent sedang menimbang langkah berikutnya", requestId });
    const text = streamTextValue(delta.content);
    if (text) {
      accumulated += text;
      write({ type: "delta", content: text, requestId });
    }
    const finishReason = stringValue(first.finish_reason, 80);
    if (finishReason && finishReason !== "stop" && finishReason !== "length") finish(`Agent mengakhiri stream dengan status ${finishReason}.`);
    if (data.error) finish(stringValue(asRecord(data.error).message || data.error, 600) || "Agent gagal menyelesaikan pekerjaan.");
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      blocks.forEach(processBlock);
      if (terminal) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!terminal) finish(accumulated ? undefined : "Stream Agent terputus sebelum menghasilkan jawaban.");
}

export function createHermesAdapter(env: Record<string, string>): HermesAdapter {
  const baseUrl = cleanUrl(env.KOASIS_HERMES_API_URL || env.HERMES_API_URL);
  const apiKey = (env.KOASIS_HERMES_API_KEY || env.HERMES_API_KEY || "").trim();
  const model = (env.KOASIS_HERMES_MODEL || "hermes-agent").trim() || "hermes-agent";
  const provider = (env.KOASIS_HERMES_PROVIDER || "").trim() || undefined;
  const persistenceConfigured = /^(1|true|yes)$/i.test((env.KOASIS_HERMES_PERSISTENCE || "").trim());
  const activeRuns = new Map<string, { runId: string; ownerKey: string }>();

  const rememberRun = (requestId: string, runId: string, ownerKey: string) => {
    activeRuns.set(requestId, { runId, ownerKey });
    const timer = setTimeout(() => activeRuns.delete(requestId), 15 * 60_000);
    if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
  };

  const control = async (requestId: string, ownerKey: string, action: HermesControlAction, signal: AbortSignal): Promise<HermesControlResult> => {
    if (!baseUrl || !apiKey) return { status: 503, body: { error: "Agent belum terhubung.", code: "hermes_unavailable" } };
    const activeRun = activeRuns.get(requestId);
    if (!activeRun || activeRun.ownerKey !== ownerKey) return { status: 404, body: { error: "Run Agent tidak ditemukan atau sudah berakhir.", code: "hermes_run_not_found" } };
    const runId = activeRun.runId;
    const path = action.action === "approval"
      ? `/v1/runs/${encodeURIComponent(runId)}/approval`
      : action.action === "clarify"
        ? `/v1/runs/${encodeURIComponent(runId)}/clarify`
        : action.action === "steer"
          ? `/v1/runs/${encodeURIComponent(runId)}/steer`
          : `/v1/runs/${encodeURIComponent(runId)}/stop`;
    const payload = action.action === "approval"
      ? { choice: action.choice, ...(action.approvalRequestId ? { request_id: action.approvalRequestId } : {}) }
      : action.action === "clarify" ? { answer: action.answer }
        : action.action === "steer" ? { message: action.message } : {};
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal,
      });
      const body = asRecord(await response.json().catch(() => ({})));
      if (action.action === "stop" || action.action === "approval" && action.choice === "deny") activeRuns.delete(requestId);
      return { status: response.status, body };
    } catch (error) {
      if (signal.aborted) throw error;
      return { status: 502, body: { error: "Agent belum dapat menerima kontrol dari Koasis.", code: "hermes_control_unreachable" } };
    }
  };

  return {
    describe: () => ({
      name: HERMES_ADAPTER_NAME,
      version: HERMES_ADAPTER_VERSION,
      mode: baseUrl && apiKey ? "remote" : "embedded",
      remoteConfigured: Boolean(baseUrl && apiKey),
      persistenceConfigured,
      capabilities: [...CAPABILITIES],
    }),
    isRemoteConfigured: () => Boolean(baseUrl && apiKey),
    control,
    forwardChat: async (rawBody, _authorization, signal) => {
      if (!baseUrl || !apiKey) return null;
      const body = asRecord(rawBody);
      const context = asRecord(body.context);
      const agentMode = context.agentMode === "chat" ? "chat" : "agentic";
      const koasis = asRecord(body.koasis);
      const sessionKey = stringValue(koasis.sessionKey, 180);
      const sessionId = safeSessionId(context.sessionId);
      const latestMessage = Array.isArray(body.messages) ? asRecord(body.messages.at(-1)) : {};
      const hasImageInput = attachmentRecords(latestMessage.attachments).some((item) => stringValue(item.kind, 30) === "image");
      const requestId = stringValue(body.requestId, 180) || `koasis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const useChatCompletions = hasImageInput;
      let created: JsonRecord;
      let createResponse: Response;
      if (useChatCompletions) {
        try {
          createResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            headers: {
              Accept: "text/event-stream",
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "Idempotency-Key": safeIdempotencyKey(requestId),
              ...(sessionKey ? { "X-Hermes-Session-Key": sessionKey } : {}),
              ...(sessionId ? { "X-Hermes-Session-Id": sessionId } : {}),
            },
            body: JSON.stringify(buildChatCompletionPayload(body, model, provider)),
            signal,
          });
          if (!createResponse.ok || !createResponse.body) {
            const details = asRecord(await createResponse.json().catch(() => ({})));
            return jsonResponse(createResponse.status, { error: stringValue(details.error) || `Hermes menolak input gambar (HTTP ${createResponse.status}).`, code: "hermes_multimodal_rejected" });
          }
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const write: StreamWriter = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              write({ type: "meta", engine: "hermes", agentMode, model, requestId, harness: { name: HERMES_ADAPTER_NAME, version: HERMES_ADAPTER_VERSION, mode: "remote", remoteConfigured: true, persistenceConfigured, capabilities: [...CAPABILITIES] }, agentId: stringValue(koasis.agentId, 80) || stringValue(body.agentId, 80) || "koasis", reviewRequired: koasis.reviewRequired === true });
              write({ type: "status", phase: "accepted", message: "Agent menerima tugas multimodal", requestId });
              void translateChatCompletionStream(createResponse, requestId, signal, write)
                .catch((error) => {
                  if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Agent gagal memproses input gambar.", code: "hermes_stream_error", requestId })}\n`));
                })
            .finally(() => { activeRuns.delete(requestId); controller.close(); });
            },
          });
          activeRuns.set(requestId, { runId: requestId, ownerKey: sessionKey });
          return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" } });
        } catch (error) {
          if (signal.aborted) throw error;
          return jsonResponse(502, { error: "Agent belum dapat dijangkau untuk input gambar.", code: "hermes_unreachable" });
        }
      }
      try {
        createResponse = await fetch(`${baseUrl}/v1/runs`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": safeIdempotencyKey(body.requestId),
            ...(sessionKey ? { "X-Hermes-Session-Key": sessionKey } : {}),
          },
          body: JSON.stringify(buildRunPayload(body, model, provider)),
          signal,
        });
        if (!createResponse.ok) return jsonResponse(createResponse.status, { error: `Hermes menolak run (HTTP ${createResponse.status}).`, code: "hermes_run_rejected" });
        created = asRecord(await createResponse.json());
      } catch (error) {
        if (signal.aborted) throw error;
        return jsonResponse(502, { error: "Hermes belum dapat dijangkau dari Koasis.", code: "hermes_unreachable" });
      }
      const runId = stringValue(created.run_id, 180);
      if (!runId) return jsonResponse(502, { error: "Hermes tidak mengembalikan run ID.", code: "hermes_invalid_response" });
      rememberRun(requestId, runId, sessionKey);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write: StreamWriter = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          write({ type: "meta", engine: "hermes", agentMode, model, requestId, harness: {
            name: HERMES_ADAPTER_NAME,
            version: HERMES_ADAPTER_VERSION,
            mode: "remote",
            remoteConfigured: true,
            persistenceConfigured,
            capabilities: [...CAPABILITIES],
          },
            agentId: stringValue(asRecord(body.koasis).agentId, 80) || stringValue(body.agentId, 80) || "koasis",
            reviewRequired: asRecord(body.koasis).reviewRequired === true,
          });
          write({ type: "status", phase: "accepted", message: "Agent menerima tugas", requestId });
          void runHermesStream(baseUrl, apiKey, runId, requestId, signal, write)
            .catch((error) => {
              if (!signal.aborted) {
                const message = error instanceof Error ? error.message : "Hermes gagal memproses tugas.";
                console.error("[koasis-hermes] stream error", { requestId, runId, error: message });
                controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: message, code: "hermes_stream_error", requestId })}\n`));
              }
            })
            .finally(() => { activeRuns.delete(requestId); controller.close(); });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "private, no-store, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
        },
      });
    },
  };
}
