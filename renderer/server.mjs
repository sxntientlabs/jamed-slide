import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);
const MAX_PPTX_BYTES = 45_000_000;
const MAX_REQUEST_BYTES = 64_000_000;
const RENDER_TIMEOUT_MS = 180_000;

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function numericSuffix(fileName) {
  return Number(fileName.match(/-(\d+)\.png$/)?.[1] ?? 0);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        fail(new Error("Request terlalu besar untuk diproses."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on("error", fail);
  });
}

function configuredToken() {
  return (process.env.RENDERER_TOKEN || "").trim();
}

function hasValidToken(request) {
  const expected = configuredToken();
  const supplied = request.headers["x-renderer-token"];
  return Boolean(expected) && typeof supplied === "string" && supplied === expected;
}

async function renderPptx(request, response) {
  if (!configuredToken()) {
    sendJson(response, 503, { error: "RENDERER_TOKEN belum dikonfigurasi di service renderer." });
    return;
  }
  if (!hasValidToken(request)) {
    sendJson(response, 401, { error: "Token renderer tidak valid." });
    return;
  }

  let directory = "";
  try {
    const body = JSON.parse((await readRequestBody(request)).toString("utf8"));
    const encoded = typeof body?.pptxBase64 === "string" ? body.pptxBase64 : "";
    if (!encoded) {
      sendJson(response, 400, { error: "pptxBase64 wajib diisi." });
      return;
    }

    const bytes = Buffer.from(encoded.replace(/^data:.*?;base64,/, ""), "base64");
    if (!bytes.length || bytes.length > MAX_PPTX_BYTES) {
      sendJson(response, 400, { error: "Data PPTX tidak valid atau terlalu besar." });
      return;
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      sendJson(response, 400, { error: "File yang dikirim bukan PPTX yang valid." });
      return;
    }

    directory = await mkdtemp(join(tmpdir(), "koasis-render-"));
    const inputPath = join(directory, "laporan-jaga.pptx");
    const profilePath = join(directory, "libreoffice-profile");
    const officePath = process.env.SOFFICE_PATH || "soffice";
    const pdfToPpmPath = process.env.PDFTOPPM_PATH || "pdftoppm";
    await writeFile(inputPath, bytes, { mode: 0o600 });

    await execFileAsync(
      officePath,
      [
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${profilePath}`,
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        directory,
        inputPath,
      ],
      { timeout: RENDER_TIMEOUT_MS, maxBuffer: 4_000_000 },
    );

    const pdfPath = join(directory, "laporan-jaga.pdf");
    await execFileAsync(
      pdfToPpmPath,
      ["-png", "-r", "110", pdfPath, join(directory, "slide")],
      { timeout: RENDER_TIMEOUT_MS, maxBuffer: 4_000_000 },
    );

    const files = (await readdir(directory))
      .filter((file) => /^slide-\d+\.png$/.test(file))
      .sort((left, right) => numericSuffix(left) - numericSuffix(right));
    if (!files.length) {
      throw new Error("LibreOffice tidak menghasilkan halaman slide.");
    }

    const slides = await Promise.all(
      files.map(async (file) => `data:image/png;base64,${(await readFile(join(directory, file))).toString("base64")}`),
    );
    sendJson(response, 200, { engine: "libreoffice-vps", slideCount: slides.length, slides });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render PPTX gagal.";
    const status = message.includes("Request terlalu besar") ? 413 : 502;
    sendJson(response, status, { error: `Preview visual tidak tersedia: ${message.slice(0, 260)}` });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

function handleRequest(request, response) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Renderer-Token");
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, {
      ok: true,
      ready: Boolean(configuredToken()),
      engine: "libreoffice",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/render") {
    void renderPptx(request, response);
    return;
  }

  sendJson(response, 404, { error: "Endpoint renderer tidak ditemukan." });
}

const port = Number.parseInt(process.env.PORT || "8080", 10);
const server = http.createServer(handleRequest);
server.requestTimeout = RENDER_TIMEOUT_MS + 30_000;
server.headersTimeout = 30_000;
server.listen(Number.isFinite(port) ? port : 8080, "0.0.0.0", () => {
  console.log(`Koasis PPTX renderer listening on port ${Number.isFinite(port) ? port : 8080}`);
});

function shutdown(signal) {
  console.log(`${signal}: shutting down renderer`);
  server.close(() => process.exit(0));
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
