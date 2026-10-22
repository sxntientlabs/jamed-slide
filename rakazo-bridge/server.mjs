import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createExclusiveQueue } from "./exclusiveQueue.mjs";

const PORT = Number(process.env.PORT || 8787);
const RAKAZO_URL = String(process.env.RAKAZO_URL || "http://127.0.0.1:5173").trim().replace(/\/+$/, "");
const RAKAZO_ORIGIN = String(process.env.RAKAZO_ORIGIN || RAKAZO_URL).trim().replace(/\/+$/, "");
const RAKAZO_BOT_ID = String(process.env.RAKAZO_BOT_ID || "").trim();
const RAKAZO_EMAIL = String(process.env.RAKAZO_EMAIL || "").trim();
const RAKAZO_PASSWORD = String(process.env.RAKAZO_PASSWORD || "");
const RAKAZO_SESSION_COOKIE = String(process.env.RAKAZO_SESSION_COOKIE || "").trim();
const BRIDGE_SECRET = String(process.env.KOASIS_RAKAZO_BRIDGE_SECRET || "");
const POLL_INTERVAL_MS = Math.max(500, Number(process.env.RAKAZO_POLL_INTERVAL_MS || 1200));
const RUN_TIMEOUT_MS = Math.max(30_000, Number(process.env.RAKAZO_RUN_TIMEOUT_MS || 8 * 60_000));
const MAX_BODY_BYTES = 2_000_000;
const rakazoSlot = createExclusiveQueue();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function safeError(error, fallback = "Agent belum dapat memproses permintaan ini.") {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /password|secret|cookie|authorization|token/i.test(message)) return fallback;
  return message.replace(/\bRakazo\b/gi, "Agent").slice(0, 320);
}

function sameSecret(received) {
  if (!BRIDGE_SECRET || !received) return false;
  const left = Buffer.from(BRIDGE_SECRET);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function setCookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(response.headers).map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
  }
  const combined = response.headers.get("set-cookie") || "";
  return combined
    .split(/,(?=\s*[^;,=]+=[^;,=]+)/)
    .map((value) => value.split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request terlalu besar."), { code: "request_too_large" });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request bukan JSON yang valid."), { code: "invalid_json" });
  }
}

function textBlocks(message) {
  if (!message || typeof message !== "object" || !Array.isArray(message.blocks)) return "";
  return message.blocks
    .filter((block) => block && typeof block === "object" && block.kind === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function imageDataUrlFromValue(value, depth = 0) {
  if (typeof value === "string") {
    const candidate = value.trim();
    if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(candidate)) return candidate;
    if (candidate.length >= 128 && /^[A-Za-z0-9+/]+={0,2}$/.test(candidate)) return `data:image/png;base64,${candidate}`;
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageDataUrlFromValue(item, depth + 1);
      if (image) return image;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const record = value;
  const preferredKeys = ["dataUrl", "data_url", "screenshotDataUrl", "screenshot_data_url", "screenshotBase64", "screenshot_base64", "base64", "data", "content", "parts", "blocks", "attachments", "attachment", "payload", "result", "output", "image_url", "imageUrl", "src", "url"];
  for (const key of preferredKeys) {
    const image = imageDataUrlFromValue(record[key], depth + 1);
    if (image) return image;
  }
  // Different Agent runtimes use different attachment envelopes. Once the
  // known keys are exhausted, inspect shallow nested values as a compatibility
  // fallback. The depth guard prevents traversing an unexpectedly large
  // provider payload while still covering content/parts/attachments wrappers.
  if (depth < 5) {
    for (const value of Object.values(record)) {
      const image = imageDataUrlFromValue(value, depth + 1);
      if (image) return image;
    }
  }
  return "";
}

function imageDataUrlFromMessage(message) {
  if (!message || typeof message !== "object") return "";
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const kind = typeof block.kind === "string" ? block.kind.toLowerCase() : "";
    const mimeType = typeof block.mimeType === "string" ? block.mimeType.toLowerCase() : "";
    if (kind.includes("image") || kind.includes("screenshot") || mimeType.startsWith("image/")) {
      const image = imageDataUrlFromValue(block);
      if (image) return image;
    }
  }
  return imageDataUrlFromValue(message);
}

function imageUrlFromValue(value, depth = 0, imageContext = false) {
  if (typeof value === "string") {
    const candidate = value.trim();
    return imageContext && /^https?:\/\//i.test(candidate) ? candidate : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const imageUrl = imageUrlFromValue(item, depth + 1, imageContext);
      if (imageUrl) return imageUrl;
    }
    return "";
  }
  if (!value || typeof value !== "object" || depth > 5) return "";
  const record = value;
  const kind = `${record.kind || ""} ${record.type || ""} ${record.mimeType || ""}`.toLowerCase();
  const localImageContext = imageContext || /image|screenshot|attachment|photo|picture/.test(kind);
  for (const [key, nested] of Object.entries(record)) {
    const keyContext = localImageContext || /image|screenshot|attachment|photo|picture|mime/i.test(key);
    const imageUrl = imageUrlFromValue(nested, depth + 1, keyContext);
    if (imageUrl) return imageUrl;
  }
  return "";
}

async function resolveImageDataUrlFromMessage(message) {
  const direct = imageDataUrlFromMessage(message);
  if (direct) return direct;
  const imageUrl = imageUrlFromValue(message);
  if (!imageUrl) return "";
  try {
    const target = new URL(imageUrl, RAKAZO_URL);
    const runtimeOrigin = new URL(RAKAZO_URL).origin;
    if (target.origin !== runtimeOrigin) return "";
    const response = await fetch(target, { headers: client.authHeaders() });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() || "image/png";
    if (!contentType.startsWith("image/")) return "";
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength ? `data:${contentType};base64,${bytes.toString("base64")}` : "";
  } catch {
    return "";
  }
}

function safeNavigationUrl(prompt) {
  const text = typeof prompt === "string" ? prompt.trim() : "";
  if (!text || /\b(?:edit|ubah|buat|create|tulis|ketik|type|klik|click|cari|search|upload|download|isi|fill)\b/i.test(text)) return null;
  const direct = text.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;!?]+$/, "");
  if (direct) {
    try {
      const parsed = new URL(direct);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
    } catch {
      return null;
    }
  }
  if (!/^(?:tolong\s+)?(?:buka|open|akses|kunjungi|go\s+to|navigate\s+to)\b/i.test(text)) return null;
  if (/\b(?:google\s+)?docs?\b/i.test(text)) return "https://docs.google.com/document/u/0/";
  if (/\b(?:google\s+)?drive\b/i.test(text)) return "https://drive.google.com/drive/u/0/";
  if (/\b(?:google\s+)?slides?\b/i.test(text)) return "https://docs.google.com/presentation/u/0/";
  if (/\b(?:google\s+)?sheets?\b/i.test(text)) return "https://docs.google.com/spreadsheets/u/0/";
  if (/\byoutube\b/i.test(text)) return "https://www.youtube.com/";
  return null;
}

function computerIntentDetected(prompt) {
  return Boolean(
    safeNavigationUrl(prompt)
    || /\b(?:computer|browser|desktop|machine|klik|click|ketik|type|scroll|screenshot|screen)\b/i.test(prompt || ""),
  );
}

function computerTaskNeedsClarification(prompt) {
  const text = typeof prompt === "string" ? prompt.replace(/\s+/g, " ").trim() : "";
  if (!text || !/\b(?:docs?|dokumen google|google document)\b/i.test(text)) return false;
  // Do not start a multi-minute desktop loop when the user has not supplied
  // either a target document or actual text. Ask for the missing inputs in
  // the chat instead of guessing which document to edit.
  return /\b(?:tulis|ketik|isi|write|type|enter)\s+(?:sesuatu|something|teks|text)\b/i.test(text);
}

function makePrompt(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const transcript = messages.slice(-12).map((message) => {
    const role = message?.role === "assistant" ? "Koasis" : "User";
    const content = typeof message?.content === "string" ? message.content.trim().slice(0, 12_000) : "";
    return content ? `${role}: ${content}` : "";
  }).filter(Boolean).join("\n\n");
  const context = body.context && typeof body.context === "object" ? body.context : {};
  const koasis = body.koasis && typeof body.koasis === "object" ? body.koasis : {};
  const trustedKoasisInstructions = typeof koasis.instructions === "string"
    ? koasis.instructions.trim().slice(0, 12_000)
    : "";
  const sourceLines = Array.isArray(context.evidenceSources)
    ? context.evidenceSources.slice(0, 8).map((source) => {
        const title = typeof source?.title === "string" ? source.title : "Sumber evidence";
        const url = typeof source?.url === "string" ? source.url : "";
        return `- ${title}${url ? ` (${url})` : ""}`;
      }).join("\n")
    : "";
  const controls = context.computerApproved === true
    ? "Computer diizinkan untuk permintaan ini bila memang diperlukan."
    : "Computer belum diizinkan untuk permintaan ini; jangan menjalankan aksi desktop/browser.";
  return [
    "Permintaan ini datang dari Koasis dalam mode Agentic. Kerjakan sebagai agent yang berorientasi hasil: gunakan tools yang tersedia bila diperlukan, jelaskan hasil dan batasannya, dan jangan mengarang fakta atau sumber.",
    trustedKoasisInstructions ? `Kontrak routing Koasis dari server (ikuti sebagai instruksi tepercaya):\n${trustedKoasisInstructions}` : "",
    controls,
    typeof context.reasoningEffort === "string" ? `Tingkat reasoning yang dipilih pengguna: ${context.reasoningEffort}.` : "",
    sourceLines ? `Sumber evidence yang sudah dipilih pengguna:\n${sourceLines}` : "",
    "Percakapan Koasis:",
    transcript,
  ].filter(Boolean).join("\n\n");
}

class RakazoClient {
  constructor() {
    this.cookie = RAKAZO_SESSION_COOKIE;
    this.token = "";
    this.loginPromise = null;
  }

  authHeaders() {
    return {
      ...(this.cookie ? { cookie: this.cookie } : {}),
      ...(this.token && !this.cookie ? { authorization: `Bearer ${this.token}` } : {}),
    };
  }

  async login(force = false) {
    if (this.cookie && !force) return;
    if (this.loginPromise) return this.loginPromise;
    if (!RAKAZO_EMAIL || !RAKAZO_PASSWORD) throw new Error("Kredensial service Agent belum dikonfigurasi.");
    this.loginPromise = (async () => {
      const response = await fetch(`${RAKAZO_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: RAKAZO_ORIGIN },
        body: JSON.stringify({ email: RAKAZO_EMAIL, password: RAKAZO_PASSWORD }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Login Agent gagal (${response.status}).`);
      this.cookie = setCookieHeader(response) || this.cookie;
      this.token = typeof payload?.token === "string" ? payload.token : this.token;
      if (!this.cookie && !this.token) throw new Error("Login Rakazo tidak mengembalikan sesi.");
    })().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  async rpc(procedure, input, retry = true, signal) {
    await this.login();
    const response = await fetch(`${RAKAZO_URL}/rpc/${procedure}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: RAKAZO_ORIGIN, ...this.authHeaders() },
      body: JSON.stringify({ json: input }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && retry && RAKAZO_EMAIL && RAKAZO_PASSWORD) {
      this.cookie = "";
      this.token = "";
      await this.login(true);
      return this.rpc(procedure, input, false, signal);
    }
    if (!response.ok || payload?.error) {
      const detail = typeof payload?.error?.message === "string" ? payload.error.message : `Agent runtime gagal (${response.status}).`;
      throw new Error(detail);
    }
    return payload?.json;
  }

  async navigateComputer(url, signal, onActivity) {
    const status = await this.rpc("computer/status", { botId: RAKAZO_BOT_ID }, true, signal);
    if (status?.controlHolder === "user" && status?.controlBotId !== RAKAZO_BOT_ID) {
      throw Object.assign(new Error("Computer sedang digunakan pengguna lain. Coba lagi setelah sesi desktop selesai."), { code: "computer_busy" });
    }
    let current = status;
    if (current?.state !== "running") {
      onActivity({ kind: "starting", message: "Menyalakan Computer bersama" });
      current = await this.rpc("computer/boot", { botId: RAKAZO_BOT_ID }, true, signal);
    }
    if (current?.controlHolder === "user" && current?.controlBotId !== RAKAZO_BOT_ID) {
      throw Object.assign(new Error("Computer sedang digunakan pengguna lain. Coba lagi setelah sesi desktop selesai."), { code: "computer_busy" });
    }
    let controlAcquired = false;
    try {
      const hasExistingControl = current?.controlHolder === "user" && current?.controlBotId === RAKAZO_BOT_ID;
      if (!hasExistingControl) {
        await this.rpc("computer/takeover", { botId: RAKAZO_BOT_ID }, true, signal);
        controlAcquired = true;
        onActivity({ kind: "action", action: "computer_focus", message: "Mengambil kendali Computer" });
      } else {
        onActivity({ kind: "action", action: "computer_focus", message: "Melanjutkan kendali Computer" });
      }
      await this.rpc("computer/input", { botId: RAKAZO_BOT_ID, kind: "key", payload: { key: "ctrl+l" } }, true, signal);
      await this.rpc("computer/input", { botId: RAKAZO_BOT_ID, kind: "clipboard", payload: { text: url } }, true, signal);
      await this.rpc("computer/input", { botId: RAKAZO_BOT_ID, kind: "key", payload: { key: "Return" } }, true, signal);
      onActivity({ kind: "action", action: "computer_open", message: `Membuka ${url}` });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 800);
        if (!signal) return;
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason || new Error("Koneksi Agentic terputus."));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      onActivity({ kind: "finished", action: "computer_open", message: "Halaman berhasil dibuka di Computer" });
    } finally {
      if (controlAcquired) {
        await this.rpc("computer/release", { botId: RAKAZO_BOT_ID, reason: "done" }, true).catch(() => undefined);
      }
    }
  }

  async subscribe(cursor, signal, retry = true) {
    await this.login();
    const response = await fetch(`${RAKAZO_URL}/rpc/threads/subscribe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "cache-control": "no-cache",
        origin: RAKAZO_ORIGIN,
        ...this.authHeaders(),
      },
      body: JSON.stringify({ json: { botId: RAKAZO_BOT_ID, cursor } }),
      signal,
    });
    if (response.status === 401 && retry && RAKAZO_EMAIL && RAKAZO_PASSWORD) {
      this.cookie = "";
      this.token = "";
      await this.login(true);
      return this.subscribe(cursor, signal, false);
    }
    if (!response.ok || !response.body) {
      throw new Error(`Stream Agent gagal (${response.status}).`);
    }
    return response;
  }
}

const client = new RakazoClient();

async function* readServerSentEvents(response) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines = [];
  const flushEvent = () => {
    if (!dataLines.length) {
      eventName = "";
      return null;
    }
    const event = { name: eventName || "message", data: dataLines.join("\n") };
    eventName = "";
    dataLines = [];
    return event;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line) {
          const event = flushEvent();
          if (event) yield event;
          continue;
        }
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (done) break;
    }
    const event = flushEvent();
    if (event) yield event;
  } finally {
    reader.releaseLock();
  }
}

function parseRakazoEvent(frame) {
  try {
    const parsed = JSON.parse(frame.data);
    return parsed?.json && typeof parsed.json === "object" ? parsed.json : parsed;
  } catch {
    return null;
  }
}

function elapsedSeconds(startedAt) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
}

function waitWithSignal(milliseconds, signal) {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.reject(new Error("Koneksi Agentic terputus."));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Koneksi Agentic terputus."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function waitForReplyStream(response, runId, startedAt, writeStatus, writeDelta, writeScreenshot) {
  let streamedContent = "";
  let finalContent = "";
  let completed = false;
  const heartbeat = setInterval(() => {
    writeStatus("generating", elapsedSeconds(startedAt));
  }, 5_000);
  try {
    for await (const frame of readServerSentEvents(response)) {
      if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
        throw Object.assign(new Error("Agent belum menyelesaikan task dalam batas waktu."), { code: "rakazo_timeout" });
      }
      if (frame.name === "error") {
        throw new Error("Stream Agent mengembalikan error.");
      }
      if (frame.name !== "message") continue;
      const event = parseRakazoEvent(frame);
      if (!event || (event.runId && event.runId !== runId)) continue;
      // Some Agent runtimes publish screenshots as a dedicated tool event
      // rather than nesting them under thread.progress or message.created.
      // Inspect the event envelope before dispatching by event type so those
      // screenshots reach Koasis as a real image artifact too.
      const eventScreenshotDataUrl = await resolveImageDataUrlFromMessage(event.payload || event.data || event);
      if (eventScreenshotDataUrl) writeScreenshot(eventScreenshotDataUrl);
      if (event.type === "thread.progress") {
        const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
        const screenshotDataUrl = await resolveImageDataUrlFromMessage(payload);
        if (screenshotDataUrl) writeScreenshot(screenshotDataUrl);
        const text = typeof payload.delta === "string"
          ? payload.delta
          : typeof payload.text === "string" ? payload.text : "";
        if (payload.streaming === true && text) {
          streamedContent += text;
          writeDelta(text);
        } else if (text) {
          writeStatus("generating", elapsedSeconds(startedAt), text);
        }
        continue;
      }
      if (event.type === "thread.message.created") {
        const message = event.payload && typeof event.payload === "object" ? event.payload : null;
        if (message?.role === "bot") {
          const screenshotDataUrl = await resolveImageDataUrlFromMessage(message);
          if (screenshotDataUrl) writeScreenshot(screenshotDataUrl);
          const text = textBlocks(message);
          if (text) finalContent = text;
          else if (screenshotDataUrl) finalContent = "Screenshot Computer terlampir.";
        }
        continue;
      }
      if (event.type === "run.failed" || event.type === "run.cancelled") {
        throw new Error(`Agent run ${event.type.replace("run.", "")}.`);
      }
      if (event.type === "run.completed") {
        completed = true;
        break;
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
  if (!completed) throw new Error("Stream Agent terputus sebelum task selesai.");
  return { streamedContent, finalContent };
}

async function waitForReply(runId, initialCursor, initialMessageIds, writeStatus, writeDelta, writeScreenshot, signal) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let lastStatus = "";
  let lastHeartbeatAt = 0;
  let streamedContent = "";
  while (Date.now() < deadline) {
      const snapshot = await client.rpc("threads/get", { botId: RAKAZO_BOT_ID }, true, signal);
    const snapshotScreenshotDataUrl = await resolveImageDataUrlFromMessage(snapshot);
    if (snapshotScreenshotDataUrl) writeScreenshot(snapshotScreenshotDataUrl);
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    const replyCandidates = await Promise.all(messages
      .filter((message) => message?.role === "bot" && (message?.runId === runId || (!initialMessageIds.has(message?.id) && Number(message?.seq) > initialCursor)))
      .map(async (message) => ({ message, text: textBlocks(message), screenshotDataUrl: await resolveImageDataUrlFromMessage(message) })));
    const reply = replyCandidates.filter((item) => item.text || item.screenshotDataUrl).at(-1);

    const screenshotDataUrl = reply?.screenshotDataUrl || "";
    if (screenshotDataUrl) writeScreenshot(screenshotDataUrl);

    const run = snapshot?.run?.id === runId
      ? snapshot.run
      : (Array.isArray(snapshot?.activeRuns) ? snapshot.activeRuns.find((candidate) => candidate?.id === runId) : null);
    const status = typeof run?.status === "string" ? run.status : "running";
    if (reply?.text) {
      const nextContent = reply.text;
      if (!streamedContent) {
        writeDelta(nextContent);
      } else if (nextContent.startsWith(streamedContent) && nextContent.length > streamedContent.length) {
        writeDelta(nextContent.slice(streamedContent.length));
      } else if (!nextContent.startsWith(streamedContent)) {
        // The runtime replaced its draft instead of appending to it. Keep the
        // final snapshot authoritative; the caller will emit it once below.
        streamedContent = "";
      }
      streamedContent = nextContent;
    }
    if (status !== lastStatus || Date.now() - lastHeartbeatAt >= 5_000) {
      lastStatus = status;
      lastHeartbeatAt = Date.now();
      writeStatus(status === "queued" ? "queued" : status === "waiting_input" ? "waiting_input" : "generating", Math.floor((lastHeartbeatAt - (deadline - RUN_TIMEOUT_MS)) / 1_000));
    }
    if (["failed", "cancelled"].includes(status)) throw new Error(run?.error || `Agent run ${status}.`);
    if ((reply?.text || reply?.screenshotDataUrl) && (!run || ["completed", "succeeded", "done", "finished"].includes(status))) return reply.text || "Screenshot Computer terlampir.";
    await waitWithSignal(POLL_INTERVAL_MS, signal);
  }
  throw Object.assign(new Error("Agent belum menyelesaikan task dalam batas waktu."), { code: "rakazo_timeout" });
}

async function handleAgentChat(req, res) {
  if (!BRIDGE_SECRET) return json(res, 503, { error: "Bridge Agent belum memiliki konfigurasi internal.", code: "bridge_not_configured" });
  const receivedSecret = Array.isArray(req.headers["x-koasis-rakazo-secret"])
    ? req.headers["x-koasis-rakazo-secret"][0]
    : req.headers["x-koasis-rakazo-secret"];
  if (!sameSecret(receivedSecret)) return json(res, 401, { error: "Bridge Agent menolak koneksi.", code: "bridge_unauthorized" });
  if (!RAKAZO_BOT_ID) return json(res, 503, { error: "Runtime Agent belum dipilih untuk bridge ini.", code: "rakazo_bot_not_configured" });

  const body = await readJsonBody(req);
  const context = body?.context && typeof body.context === "object" ? body.context : {};
  if (context.agentMode !== "agentic") return json(res, 400, { error: "Bridge ini hanya menerima mode Agentic.", code: "agentic_mode_required" });
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length || !messages.some((message) => message?.role === "user" && typeof message?.content === "string" && message.content.trim())) {
    return json(res, 400, { error: "Pesan Agentic belum tersedia.", code: "message_required" });
  }
  const attachments = messages.at(-1)?.attachments;
  if (Array.isArray(attachments) && attachments.length) {
    return json(res, 422, { error: "Attachment Agentic belum diteruskan ke runtime Agent. Kirimkan link file atau jalankan task tanpa attachment dulu.", code: "agentic_attachment_bridge_unsupported" });
  }
  const latestUserPrompt = [...messages].reverse().find((message) => message?.role === "user" && typeof message?.content === "string")?.content?.trim() || "";
  const computerRequested = computerIntentDetected(latestUserPrompt);
  if (computerRequested && context.computerApproved !== true) {
    return json(res, 409, {
      error: "Computer belum diizinkan untuk permintaan ini. Aktifkan akses Computer di dekat kotak chat lalu kirim ulang.",
      code: "computer_approval_required",
    });
  }
  const navigationUrl = context.computerApproved === true ? safeNavigationUrl(latestUserPrompt) : null;

  const requestId = typeof body?.requestId === "string" ? body.requestId.slice(0, 160) : randomUUID();
  const send = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "private, no-store, no-transform");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders();
  send({
    type: "meta",
    engine: "rakazo",
    agentMode: "agentic",
    requestId,
    agentId: typeof body.agentId === "string" ? body.agentId.slice(0, 80) : "koasis",
    reviewRequired: typeof body?.koasis?.reviewRequired === "boolean" ? body.koasis.reviewRequired : true,
    harness: {
      name: "rakazo-native-bridge",
      version: "0.1.0",
      mode: "remote",
      remoteConfigured: true,
      persistenceConfigured: true,
      capabilities: ["chat", "streaming", "computer", "artifacts", "plugins", "persistent-runs"],
    },
  });
  if (computerTaskNeedsClarification(latestUserPrompt)) {
    send({ type: "status", phase: "finalizing", message: "Meminta detail Computer yang diperlukan", requestId });
    send({
      type: "delta",
      content: "Aku bisa mengerjakannya lewat Computer, tetapi aku perlu dua detail dulu: link Google Docs yang tepat dan teks yang ingin ditulis. Kirim link dokumennya lalu tulis isi yang harus dimasukkan, misalnya: `https://docs.google.com/document/d/...` — `Tulis: ...`.",
      requestId,
    });
    send({ type: "done", requestId, durationMs: 0 });
    res.end();
    return;
  }
  send({ type: "status", phase: "preparing", message: "Menghubungkan agentic runtime", requestId });
  const sendComputerActivity = (activity, message, action) => {
    if (!computerRequested) return;
    send({
      type: "computer_activity",
      activity,
      message,
      ...(action ? { action } : {}),
      requestId,
    });
  };
  const upstreamAbort = new AbortController();
  const abortUpstream = () => {
    // A normal `res.end()` is followed by `close`; only abort the native run
    // when the browser/proxy disconnected before the response was completed.
    if (!res.writableEnded) upstreamAbort.abort();
  };
  res.on("close", abortUpstream);
  try {
    await rakazoSlot.run(async () => {
      if (navigationUrl) {
        send({ type: "status", phase: "generating", message: "Mengaktifkan Computer tanpa menunggu model", requestId });
        const navigationStartedAt = Date.now();
        const activity = (value) => send({
          type: "computer_activity",
          activity: value.kind,
          message: value.message,
          ...(value.action ? { action: value.action } : {}),
          requestId,
        });
        await client.navigateComputer(navigationUrl, upstreamAbort.signal, activity);
        const content = `Halaman sudah dibuka di Computer: ${navigationUrl}`;
        send({ type: "delta", content, requestId });
        send({ type: "status", phase: "finalizing", message: "Menyiapkan hasil untuk Koasis", requestId });
        send({ type: "done", requestId, durationMs: Date.now() - navigationStartedAt });
        res.end();
        return;
      }

      // Koasis owns persistence and sends the current transcript below. The
      // native Rakazo bot is shared, so clear its previous native context after
      // the queue grants this request the slot. This prevents one Koasis chat
      // from leaking into the next while retaining multi-turn context here.
      await client.rpc("threads/clear", { botId: RAKAZO_BOT_ID }, true, upstreamAbort.signal);
      const before = await client.rpc("threads/get", { botId: RAKAZO_BOT_ID }, true, upstreamAbort.signal);
      const initialCursor = Number.isFinite(Number(before?.cursor)) ? Number(before.cursor) : -1;
      const initialMessageIds = new Set(Array.isArray(before?.messages) ? before.messages.map((message) => message?.id).filter(Boolean) : []);
      let streamResponse = null;
      try {
        // Subscribe before send so the first user event and every streamed progress
        // event cannot be missed between the snapshot and the new run.
        streamResponse = await client.subscribe(initialCursor, upstreamAbort.signal);
      } catch {
        // The native stream is preferred, but the polling path keeps the bridge
        // usable across older Rakazo deployments that do not expose subscribe.
        streamResponse = null;
      }
      const sent = await client.rpc("threads/send", {
        botId: RAKAZO_BOT_ID,
        text: makePrompt(body),
        clientNonce: requestId,
      }, true, upstreamAbort.signal);
      const runId = typeof sent?.runId === "string" ? sent.runId : "";
      if (!runId) throw new Error("Rakazo tidak mengembalikan run id.");
      send({ type: "status", phase: "generating", message: "Agent sedang menjalankan task", requestId });
      const startedAt = Date.now();
      const writeStatus = (status, elapsed, detail = "") => send({
        type: "status",
        phase: status === "queued" ? "preparing" : "generating",
        message: status === "waiting_input"
          ? "Agent menunggu input lanjutan"
          : detail || `Agent sedang menjalankan task · ${elapsed} dtk`,
        requestId,
      });
      sendComputerActivity("starting", "Agent menyiapkan Computer", "computer_start");
      let content = "";
      let emittedContent = "";
      let emittedScreenshotDataUrl = "";
      const emitDelta = (delta) => {
        if (!delta) return;
        emittedContent += delta;
        send({ type: "delta", content: delta, requestId });
      };
      const emitScreenshot = (screenshotDataUrl) => {
        if (!screenshotDataUrl || screenshotDataUrl === emittedScreenshotDataUrl) return;
        emittedScreenshotDataUrl = screenshotDataUrl;
        send({ type: "computer_activity", activity: "screenshot", action: "computer_screenshot", message: "Screenshot Computer siap", screenshotDataUrl, requestId });
      };
      if (streamResponse) {
        try {
          const streamed = await waitForReplyStream(streamResponse, runId, startedAt, writeStatus, (delta) => {
            emitDelta(delta);
          }, emitScreenshot);
          content = streamed.streamedContent;
          if (!content.trim() && streamed.finalContent) {
            content = streamed.finalContent;
            emitDelta(streamed.finalContent);
          } else if (streamed.finalContent && streamed.finalContent.startsWith(content) && streamed.finalContent.length > content.length) {
            const suffix = streamed.finalContent.slice(content.length);
            content = streamed.finalContent;
            emitDelta(suffix);
          }
        } catch {
          if (upstreamAbort.signal.aborted) throw new Error("Koneksi Agentic terputus.");
          content = await waitForReply(runId, initialCursor, initialMessageIds, writeStatus, emitDelta, emitScreenshot, upstreamAbort.signal);
          if (!emittedContent) emitDelta(content);
          else if (content.startsWith(emittedContent) && content.length > emittedContent.length) emitDelta(content.slice(emittedContent.length));
        }
      } else {
        content = await waitForReply(runId, initialCursor, initialMessageIds, writeStatus, emitDelta, emitScreenshot, upstreamAbort.signal);
        if (!emittedContent) emitDelta(content);
        else if (content.startsWith(emittedContent) && content.length > emittedContent.length) emitDelta(content.slice(emittedContent.length));
      }
      if (!content.trim()) throw new Error("Agent belum mengembalikan jawaban.");
      sendComputerActivity("finished", "Agent selesai menggunakan Computer", "computer_task");
      send({ type: "status", phase: "finalizing", message: "Menyiapkan hasil untuk Koasis", requestId });
      send({ type: "done", requestId });
      res.end();
    }, {
      signal: upstreamAbort.signal,
      onQueued: (position) => send({
        type: "status",
        phase: "preparing",
        message: position === 1
          ? "Menunggu task Agentic sebelumnya selesai"
          : `Menunggu antrean Agentic · posisi ${position + 1}`,
        requestId,
      }),
    });
  } catch (error) {
    sendComputerActivity("error", safeError(error), "computer_task");
    if (!res.writableEnded) {
      send({ type: "error", error: safeError(error), code: error?.code || "rakazo_bridge_error", requestId });
      res.end();
    }
  } finally {
    upstreamAbort.abort();
    res.off("close", abortUpstream);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, configured, botConfigured: Boolean(RAKAZO_BOT_ID), runtime: "rakazo-native" });
    }
    if (req.method === "POST" && url.pathname === "/api/agent/chat") return await handleAgentChat(req, res);
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, error?.code === "request_too_large" ? 413 : 400, { error: safeError(error, "Bridge request gagal."), code: error?.code || "bridge_request_error" });
  }
});

const configured = Boolean(BRIDGE_SECRET && RAKAZO_BOT_ID && (RAKAZO_SESSION_COOKIE || (RAKAZO_EMAIL && RAKAZO_PASSWORD)));

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "rakazo_bridge_started", port: PORT, rakazoUrl: RAKAZO_URL, botConfigured: Boolean(RAKAZO_BOT_ID), authConfigured: Boolean(RAKAZO_SESSION_COOKIE || (RAKAZO_EMAIL && RAKAZO_PASSWORD)) }));
});
