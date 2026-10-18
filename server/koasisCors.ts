import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

type Next = (error?: unknown) => void;

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://koasis.my.id",
  "https://jamed--jamed-9bdbe.asia-southeast1.hosted.app",
];

function parseAllowedOrigins(value: string | undefined): Set<string> {
  const configured = (value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function applyCors(request: IncomingMessage, response: ServerResponse, allowedOrigins: Set<string>): boolean {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.replace(/\/$/, "") : "";
  if (!origin) return true;
  if (!allowedOrigins.has(origin)) {
    if (request.method === "OPTIONS") {
      response.statusCode = 403;
      response.end();
      return false;
    }
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return false;
  }
  return true;
}

export function createKoasisCorsPlugin(env: Record<string, string>): Plugin {
  const allowedOrigins = parseAllowedOrigins(env.KOASIS_CORS_ORIGINS);
  const middleware = (request: IncomingMessage, response: ServerResponse, next: Next) => {
    if (!request.url?.startsWith("/api/")) {
      next();
      return;
    }
    if (applyCors(request, response, allowedOrigins)) next();
  };

  return {
    name: "koasis-api-cors",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
