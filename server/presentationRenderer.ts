import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const execFileAsync = promisify(execFile);
const MAX_RENDER_BYTES = 45_000_000;
const REMOTE_RENDER_TIMEOUT_MS = 180_000;

type Next = (error?: unknown) => void;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_RENDER_BYTES) {
        reject(new Error("PPTX terlalu besar untuk dipreview."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
      } catch {
        reject(new Error("Body preview bukan JSON yang valid."));
      }
    });
    request.on("error", reject);
  });
}

function numericSuffix(fileName: string): number {
  return Number(fileName.match(/-(\d+)\.png$/)?.[1] ?? 0);
}

async function renderWithRemoteRenderer(encoded: string, env: Record<string, string>): Promise<unknown> {
  const baseUrl = (env.JAMED_RENDERER_URL || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("JAMED_RENDERER_URL belum dikonfigurasi.");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.JAMED_RENDERER_TOKEN) headers["X-Renderer-Token"] = env.JAMED_RENDERER_TOKEN;
  const response = await fetch(`${baseUrl}/render`, {
    method: "POST",
    headers,
    body: JSON.stringify({ pptxBase64: encoded }),
    signal: AbortSignal.timeout(REMOTE_RENDER_TIMEOUT_MS),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Renderer VPS mengembalikan HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object" || !("slides" in payload) || !Array.isArray(payload.slides) || payload.slides.length === 0) {
    throw new Error("Renderer VPS tidak mengembalikan slide PNG.");
  }
  return payload;
}

async function renderPresentation(request: IncomingMessage, response: ServerResponse, env: Record<string, string>): Promise<void> {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Gunakan POST /api/presentation/render." });
    return;
  }
  let directory = "";
  try {
    const body = await readJsonBody(request);
    const encoded = typeof body.pptxBase64 === "string" ? body.pptxBase64 : "";
    if (!encoded) {
      sendJson(response, 400, { error: "pptxBase64 wajib diisi." });
      return;
    }
    const bytes = Buffer.from(encoded.replace(/^data:.*?;base64,/, ""), "base64");
    if (!bytes.length || bytes.length > MAX_RENDER_BYTES) {
      sendJson(response, 400, { error: "Data PPTX tidak valid atau terlalu besar." });
      return;
    }
    if (env.JAMED_RENDERER_URL) {
      sendJson(response, 200, await renderWithRemoteRenderer(encoded, env));
      return;
    }
    directory = await mkdtemp(join(tmpdir(), "jamed-render-"));
    const inputPath = join(directory, "laporan-jaga.pptx");
    const officePath = env.JAMED_SOFFICE_PATH || "soffice";
    const pdfToPpmPath = env.JAMED_PDFTOPPM_PATH || "pdftoppm";
    await writeFile(inputPath, bytes);
    await execFileAsync(officePath, ["--headless", "--convert-to", "pdf", "--outdir", directory, inputPath], { timeout: 120_000, maxBuffer: 2_000_000 });
    const pdfPath = join(directory, "laporan-jaga.pdf");
    await execFileAsync(pdfToPpmPath, ["-png", "-r", "110", pdfPath, join(directory, "slide")], { timeout: 120_000, maxBuffer: 2_000_000 });
    const files = (await readdir(directory)).filter((file) => /^slide-\d+\.png$/.test(file)).sort((left, right) => numericSuffix(left) - numericSuffix(right));
    const slides = await Promise.all(files.map(async (file) => `data:image/png;base64,${(await readFile(join(directory, file))).toString("base64")}`));
    sendJson(response, 200, { engine: "libreoffice", slideCount: slides.length, slides });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render PPTX gagal.";
    sendJson(response, 502, { error: `Preview visual tidak tersedia: ${message.slice(0, 260)}` });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function createPresentationRendererPlugin(env: Record<string, string>): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void renderPresentation(request, response, env);
  };
  return {
    name: "jamed-presentation-renderer",
    configureServer(server) {
      server.middlewares.use("/api/presentation/render", middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/presentation/render", middleware);
    },
  };
}
