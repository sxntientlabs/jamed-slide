import { afterEach, describe, expect, test, vi } from "vitest";
import { createHermesAdapter } from "./hermesAdapter";

describe("Hermes adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  test("does not activate without both a URL and server-only key", async () => {
    const adapter = createHermesAdapter({ KOASIS_HERMES_API_URL: "https://hermes.example" });
    expect(adapter.isRemoteConfigured()).toBe(false);
    await expect(adapter.forwardChat({}, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  test("starts a run and translates Hermes SSE into Koasis NDJSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run_123", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        "event: message.delta",
        'data: {"type":"message.delta","text":"Halo"}',
        "",
        "event: tool.started",
        'data: {"type":"tool.started","tool":"browser"}',
        "",
        "event: tool.completed",
        `data: {"type":"tool.completed","tool":"browser","duration":0.4,"error":false,"screenshotBase64":"${"a".repeat(160)}"}`,
        "",
        "event: run.completed",
        'data: {"type":"run.completed","run_id":"run_123","output":"Halo"}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "https://hermes.example/",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-123",
      agentId: "koasis",
      messages: [{ role: "user", content: "Buka browser" }],
      context: { agentMode: "agentic", sessionId: "chat-1", reasoningEffort: "severe", computerApproved: true },
      koasis: { agentId: "koasis", reviewRequired: false, instructions: "Jawab dalam bahasa Indonesia dan jangan mengarang sumber." },
    }, undefined, new AbortController().signal);

    expect(response?.status).toBe(200);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.type)).toEqual(["meta", "status", "delta", "status", "computer_activity", "status", "computer_activity", "status", "done"]);
    expect(lines.find((line) => line.type === "meta")).toMatchObject({ engine: "hermes", agentMode: "agentic" });
    expect(lines.find((line) => line.type === "delta")).toMatchObject({ content: "Halo" });
    expect(lines.find((line) => line.type === "computer_activity" && line.screenshotDataUrl)).toMatchObject({ activity: "screenshot", screenshotDataUrl: expect.stringMatching(/^data:image\/png;base64,a+$/) });
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "https://hermes.example/v1/runs", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer server-secret", "Idempotency-Key": "request-123" }),
      body: expect.stringContaining('"session_id":"koasis-chat-1"'),
    }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).instructions).toContain("Jawab dalam bahasa Indonesia");
    expect(lines.find((line) => line.type === "meta")).toMatchObject({ agentId: "koasis", reviewRequired: false });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "https://hermes.example/v1/runs/run_123/events", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer server-secret", Accept: "text/event-stream" }),
    }));
  });

  test("forwards screenshots nested in a provider attachment envelope", async () => {
    const screenshot = "a".repeat(160);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run_nested", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        "event: tool.completed",
        `data: ${JSON.stringify({ type: "tool.completed", tool: "browser", result: { content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } }] } })}`,
        "",
        "event: run.completed",
        'data: {"type":"run.completed","run_id":"run_nested","output":"Screenshot siap"}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "https://hermes.example",
      KOASIS_HERMES_API_KEY: "server-secret",
    });
    const response = await adapter.forwardChat({
      requestId: "request-nested",
      messages: [{ role: "user", content: "kirim screenshot" }],
      context: { agentMode: "agentic", computerApproved: true },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.type === "computer_activity" && line.screenshotDataUrl)).toMatchObject({
      activity: "screenshot",
      screenshotDataUrl: expect.stringMatching(/^data:image\/png;base64,a+$/),
    });
  });
});
