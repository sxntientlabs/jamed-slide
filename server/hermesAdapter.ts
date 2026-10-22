/**
 * Small server-side bridge from Koasis' NDJSON chat contract to the Hermes
 * Runs API.  Hermes stays on the VPS; only this adapter runs in App Hosting.
 * The API key is read from server-only environment variables and never enters
 * the browser request or the activity ledger.
 */

export const HERMES_ADAPTER_NAME = "hermes-agent";
export const HERMES_ADAPTER_VERSION = "0.1.0";

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
};

const CAPABILITIES = [
  "chat",
  "streaming",
  "runs-api",
  "tool-events",
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

function textMessage(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : "";
  const content = stringValue(record.content, 12_000);
  return role && content ? { role, content } : null;
}

function buildInstructions(body: JsonRecord, context: JsonRecord): string {
  const instructions = [
    "Kamu adalah Agent di dalam Koasis, workspace klinis dan produktivitas.",
    "Gunakan tools yang tersedia secara proaktif bila memang membantu menyelesaikan tugas; jangan berhenti hanya karena tugas membutuhkan beberapa langkah.",
    "Jawab dalam bahasa pengguna. Jika pengguna menulis bahasa Indonesia, jawab hanya dalam bahasa Indonesia; jangan menggunakan bahasa Vietnam atau persona bawaan provider.",
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
  if (agentId) instructions.push(`Specialist agent Koasis: ${agentId}.`);
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
  const direct = stringValue(data.text, 24_000);
  if (direct) return direct;
  const delta = asRecord(data.delta);
  return stringValue(delta.text, 24_000) || stringValue(data.content, 24_000);
}

function toolLabel(value: unknown): string {
  const tool = stringValue(value, 120);
  return tool || "tool";
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
          return content.map((part) => stringValue(asRecord(part).text, 24_000)).filter(Boolean).join("");
        }
        return stringValue(record.text, 24_000);
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}

function appendFinalOutput(current: string, output: string): { next: string; delta: string } {
  if (!output) return { next: current, delta: "" };
  if (!current) return { next: output, delta: output };
  if (output === current || current.startsWith(output)) return { next: current, delta: "" };
  if (output.startsWith(current)) return { next: output, delta: output.slice(current.length) };
  return { next: `${current}\n\n${output}`, delta: `\n\n${output}` };
}

type StreamWriter = (event: JsonRecord) => void;

function mapHermesEvent(eventName: string, data: JsonRecord, requestId: string, accumulated: string, write: StreamWriter): string {
  const type = stringValue(data.type, 120) || eventName;
  const image = screenshotDataUrl(data);
  const isToolCompletion = type === "tool.completed" || type === "tool.complete" || type === "tool.failed";
  if (image && !isToolCompletion) write({ type: "computer_activity", activity: "screenshot", action: toolLabel(data.tool) === "tool" ? "computer_screenshot" : toolLabel(data.tool), message: "Screenshot Computer siap", screenshotDataUrl: image, requestId });
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
  if (type === "tool.started" || type === "tool.start" || type === "tool.generating") {
    const tool = toolLabel(data.tool);
    write({ type: "status", phase: "generating", message: `Agent menjalankan ${tool}`, requestId });
    if (isComputerTool(tool)) write({ type: "computer_activity", activity: "action", action: tool, message: `Agent menggunakan Computer: ${tool}`, requestId });
    return accumulated;
  }
  if (type === "tool.completed" || type === "tool.complete" || type === "tool.failed") {
    const tool = toolLabel(data.tool);
    const failed = data.error === true || type === "tool.failed";
    write({ type: "status", phase: "generating", message: failed ? `${tool} menemui kendala` : `${tool} selesai`, requestId });
    if (isComputerTool(tool)) write({ type: "computer_activity", activity: failed ? "error" : "screenshot", action: tool, message: failed ? `Computer: ${tool} gagal` : `Computer: ${tool} selesai`, ...(image ? { screenshotDataUrl: image } : {}), requestId });
    return accumulated;
  }
  if (type === "approval.request" || type === "run.waiting_for_approval") {
    write({ type: "status", phase: "generating", message: "Agent menunggu persetujuan untuk melanjutkan", requestId });
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
    return { event, data: asRecord(JSON.parse(dataLines.join("\n"))) };
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
    accumulated = mapHermesEvent(parsed.event, parsed.data, requestId, accumulated, write);
    const type = stringValue(parsed.data.type, 120) || parsed.event;
    if (type === "run.completed") {
      const merged = appendFinalOutput(accumulated, runOutput(parsed.data));
      if (merged.delta) write({ type: "delta", content: merged.delta, requestId });
      accumulated = merged.next;
      terminal = true;
      write({ type: "status", phase: "finalizing", message: "Agent menyelesaikan pekerjaan", requestId });
      write({ type: "done", requestId });
    } else if (type === "run.failed" || type === "run.cancelled" || type === "run.interrupted") {
      terminal = true;
      const error = stringValue(parsed.data.error, 600) || (type === "run.cancelled" ? "Pekerjaan dibatalkan." : "Agent gagal menyelesaikan pekerjaan.");
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
    if (merged.delta) write({ type: "delta", content: merged.delta, requestId });
    if (status.status === "completed") write({ type: "done", requestId });
    else write({ type: "error", error: stringValue(status.error, 600) || "Stream Agent terputus sebelum selesai.", code: "stream_incomplete", requestId });
  }
}

export function createHermesAdapter(env: Record<string, string>): HermesAdapter {
  const baseUrl = cleanUrl(env.KOASIS_HERMES_API_URL || env.HERMES_API_URL);
  const apiKey = (env.KOASIS_HERMES_API_KEY || env.HERMES_API_KEY || "").trim();
  const model = (env.KOASIS_HERMES_MODEL || "hermes-agent").trim() || "hermes-agent";
  const provider = (env.KOASIS_HERMES_PROVIDER || "").trim() || undefined;

  return {
    describe: () => ({
      name: HERMES_ADAPTER_NAME,
      version: HERMES_ADAPTER_VERSION,
      mode: baseUrl && apiKey ? "remote" : "embedded",
      remoteConfigured: Boolean(baseUrl && apiKey),
      persistenceConfigured: false,
      capabilities: [...CAPABILITIES],
    }),
    isRemoteConfigured: () => Boolean(baseUrl && apiKey),
    forwardChat: async (rawBody, _authorization, signal) => {
      if (!baseUrl || !apiKey) return null;
      const body = asRecord(rawBody);
      let created: JsonRecord;
      let createResponse: Response;
      try {
        createResponse = await fetch(`${baseUrl}/v1/runs`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": safeIdempotencyKey(body.requestId),
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
      const requestId = stringValue(body.requestId, 180) || runId;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write: StreamWriter = (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          write({ type: "meta", engine: "hermes", agentMode: "agentic", model, requestId, harness: {
            name: HERMES_ADAPTER_NAME,
            version: HERMES_ADAPTER_VERSION,
            mode: "remote",
            remoteConfigured: true,
            persistenceConfigured: false,
            capabilities: [...CAPABILITIES],
          },
            agentId: stringValue(asRecord(body.koasis).agentId, 80) || stringValue(body.agentId, 80) || "koasis",
            reviewRequired: asRecord(body.koasis).reviewRequired === true,
          });
          write({ type: "status", phase: "accepted", message: "Agent menerima tugas", requestId });
          void runHermesStream(baseUrl, apiKey, runId, requestId, signal, write)
            .catch((error) => {
              if (!signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : "Hermes gagal memproses tugas.", code: "hermes_stream_error", requestId })}\n`));
            })
            .finally(() => controller.close());
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
