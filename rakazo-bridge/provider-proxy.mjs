import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8788);
const UPSTREAM_BASE_URL = String(
  process.env.UPSTREAM_BASE_URL || "https://rcljvh2.abc-tunnel.us/v1",
)
  .trim()
  .replace(/\/+$/, "");
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function safeError(error) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /authorization|bearer|api.?key|secret|token/i.test(message)) {
    return "Provider proxy gagal meneruskan request.";
  }
  return message.slice(0, 320);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Provider request terlalu besar.");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function upstreamUrl(req) {
  const incoming = new URL(req.url || "/", "http://rakazo-provider-proxy");
  const upstream = new URL(UPSTREAM_BASE_URL);
  const suffix = incoming.pathname.startsWith("/v1")
    ? incoming.pathname.slice("/v1".length)
    : incoming.pathname;
  upstream.pathname = `${upstream.pathname.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
  upstream.search = incoming.search;
  return upstream;
}

function forwardedHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase()) || value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

async function proxy(req, res) {
  const requestUrl = new URL(req.url || "/", "http://rakazo-provider-proxy");
  if (req.method === "GET" && requestUrl.pathname === "/health") {
    return json(res, 200, { ok: true, upstreamConfigured: Boolean(UPSTREAM_BASE_URL) });
  }
  if (
    !["/v1/models", "/v1/chat/completions"].includes(requestUrl.pathname) ||
    !["GET", "POST"].includes(req.method || "")
  ) {
    return json(res, 404, { error: "Provider proxy route tidak tersedia." });
  }

  const body = req.method === "GET" ? undefined : await readBody(req);
  const response = await fetch(upstreamUrl(req), {
    method: req.method,
    headers: forwardedHeaders(req),
    body,
  });

  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
  res.setHeader("x-koasis-provider-proxy", "1");

  if (!response.body) return res.end();
  const isEventStream = (response.headers.get("content-type") || "").includes("text/event-stream");
  const reader = response.body.getReader();
  let tail = "";
  let sawDone = false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (isEventStream) {
      const text = new TextDecoder().decode(chunk.value);
      const scan = tail + text;
      if (scan.includes("data: [DONE]")) sawDone = true;
      tail = scan.slice(-64);
    }
    if (!res.write(chunk.value)) await new Promise((resolve) => res.once("drain", resolve));
  }
  if (isEventStream && !sawDone) res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  proxy(req, res).catch((error) => {
    if (!res.headersSent) return json(res, 502, { error: safeError(error) });
    res.destroy();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "provider_proxy_started", port: PORT, upstream: UPSTREAM_BASE_URL }));
});
