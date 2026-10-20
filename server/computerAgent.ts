import { randomUUID } from "node:crypto";

/**
 * Private capability used only when the server-side agent calls the local
 * Computer middleware. It is intentionally generated at runtime and is never
 * sent to the browser.
 */
export const COMPUTER_AGENT_INTERNAL_TOKEN = randomUUID();

export const COMPUTER_AGENT_MAX_ROUNDS = 8;
export const COMPUTER_AGENT_MAX_ACTIONS = 12;

export const COMPUTER_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "computer_start",
      description: "Start or resume the user's selected shared Koasis Computer from the available pool. Use this before any other computer tool.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_screenshot",
      description: "Read the current Computer desktop screenshot. Use it after navigation or an interaction to verify the result.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_open",
      description: "Open an http or https URL in the user's Computer browser.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The full http or https URL to open." } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_click",
      description: "Click a coordinate on the current Computer desktop. Take a screenshot first when coordinates are uncertain.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "Horizontal pixel coordinate." },
          y: { type: "number", description: "Vertical pixel coordinate." },
          button: { type: "string", enum: ["left", "right", "middle"] },
          double: { type: "boolean" },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_type",
      description: "Type text into the currently focused Computer control. Never type passwords, API keys, or other secrets unless the user explicitly asks for that exact input.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type." },
          delayMs: { type: "number", description: "Optional delay between keystrokes, from 0 to 250 milliseconds." },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_press",
      description: "Press one key or a key sequence on the Computer, for example Enter, Tab, or Control+L.",
      parameters: {
        type: "object",
        properties: {
          keys: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        },
        required: ["keys"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_scroll",
      description: "Scroll the Computer desktop in one direction. Take a screenshot after scrolling when the target is not obvious.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "number", description: "Scroll amount from 1 to 20." },
        },
        required: ["direction"],
        additionalProperties: false,
      },
    },
  },
] as const;

const COMPUTER_INTENT_PATTERN = /\b(computer|desktop|browser|machine|browsing eksternal|gunakan internet|pakai internet|klik|click|ketik|type|scroll|buka situs|buka website|open browser|screenshot layar)\b|https?:\/\/|\b(?:drive|docs|slides)\.google\.com\b/i;
const COMPUTER_ACTION_PATTERN = /\b(?:buka|open|edit|ubah|perbaiki|tinjau|review|cek|akses|unggah|upload|download|unduh|salin|isi|ketik|klik|click)\b[^.?!]{0,90}\b(?:link|dokumen|document|slide|slides|file|situs|website|browser|drive|docs|sheet|sheets)\b/i;
const COMPUTER_NEGATION_PATTERN = /\b(jangan|tanpa|tidak perlu|gausah|nggak usah|jangan gunakan|do not|don't)\b[^.?!]{0,80}\b(?:computer|desktop|browser|machine|https?:\/\/|drive\.google\.com|docs\.google\.com|slides\.google\.com)\b/i;

export function computerIntentDetected(message: string): boolean {
  return (COMPUTER_INTENT_PATTERN.test(message) || COMPUTER_ACTION_PATTERN.test(message)) && !COMPUTER_NEGATION_PATTERN.test(message);
}

export function parseComputerToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // The provider may return malformed arguments; the caller returns a
      // tool error to the model instead of executing an ambiguous action.
    }
    throw new Error("Argumen tool Computer bukan JSON object yang valid.");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("Argumen tool Computer harus berupa JSON object.");
}
