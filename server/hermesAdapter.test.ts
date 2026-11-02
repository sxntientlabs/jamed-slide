import { afterEach, describe, expect, test, vi } from "vitest";
import { createHermesAdapter } from "./hermesAdapter";

describe("Hermes adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  test("does not activate without both a URL and server-only key", async () => {
    const adapter = createHermesAdapter({ KOASIS_HERMES_API_URL: "https://hermes.example" });
    expect(adapter.isRemoteConfigured()).toBe(false);
    await expect(adapter.forwardChat({}, undefined, new AbortController().signal)).resolves.toBeNull();
  });

  test("reports persistent Agent state when the private runtime has a volume", () => {
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
      KOASIS_HERMES_PERSISTENCE: "true",
    });
    expect(adapter.describe()).toMatchObject({ mode: "remote", remoteConfigured: true, persistenceConfigured: true });
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
      context: { agentMode: "agentic", sessionId: "chat-1", modelId: "elective", reasoningEffort: "severe", computerApproved: true },
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
    const runPayload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(runPayload.instructions).toContain("Jawab dalam bahasa Indonesia");
    expect(runPayload.instructions).toContain("Model Koasis yang dipilih pengguna: Elective 6.7");
    expect(runPayload.instructions).toContain("bukan nama model yang dipilih");
    expect(lines.find((line) => line.type === "meta")).toMatchObject({ agentId: "koasis", reviewRequired: false });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "https://hermes.example/v1/runs/run_123/events", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer server-secret", Accept: "text/event-stream" }),
    }));
  });

  test("accepts Hermes SSE blocks whose event name and delta live in JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run_json_events", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        "id: 0",
        'data: {"event":"message.delta","run_id":"run_json_events","delta":"READY"}',
        "",
        "id: 1",
        'data: {"event":"run.completed","run_id":"run_json_events","output":"READY"}',
        "",
        ": stream closed",
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-json-events",
      messages: [{ role: "user", content: "uji" }],
      context: { agentMode: "agentic" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.type)).toEqual(["meta", "status", "delta", "status", "done"]);
    expect(lines.find((line) => line.type === "delta")).toMatchObject({ content: "READY" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("preserves Chat mode when the app uses Hermes as its configured fallback", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run_chat", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        'data: {"event":"message.delta","delta":"READY"}',
        "",
        'data: {"event":"run.completed","output":"READY"}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-chat",
      messages: [{ role: "user", content: "Balas READY saja." }],
      context: { agentMode: "chat" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.type === "meta")).toMatchObject({ engine: "hermes", agentMode: "chat" });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).instructions).toContain("Mode Chat aktif");
  });

  test("replaces an unspaced stream buffer with Hermes' formatted final output", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run-formatted", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        'event: message.delta',
        'data: {"type":"message.delta","text":"SayamemakaimodelKoasisAgent."}',
        "",
        'event: run.completed',
        'data: {"type":"run.completed","output":"Saya memakai model Koasis Agent."}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-formatted",
      messages: [{ role: "user", content: "uji format" }],
      context: { agentMode: "agentic" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter((line) => line.type === "delta")).toHaveLength(1);
    expect(lines.find((line) => line.type === "replace")).toMatchObject({ content: "Saya memakai model Koasis Agent." });
  });

  test("preserves separator spaces between Hermes run-event deltas", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run-spaces", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        "event: message.delta",
        'data: {"type":"message.delta","text":"Aku"}',
        "",
        "event: message.delta",
        'data: {"type":"message.delta","text":" Study"}',
        "",
        "event: message.delta",
        'data: {"type":"message.delta","text":" Desk."}',
        "",
        "event: run.completed",
        'data: {"type":"run.completed","output":"Aku Study Desk."}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-spaces",
      messages: [{ role: "user", content: "uji spasi" }],
      context: { agentMode: "chat" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter((line) => line.type === "delta").map((line) => line.content)).toEqual(["Aku", " Study", " Desk."]);
  });

  test("preserves separator spaces between Hermes chat-completion deltas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"content":"Aku"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" Study"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" Desk."}}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });

    const response = await adapter.forwardChat({
      requestId: "request-completion-spaces",
      messages: [{ role: "user", content: "uji spasi", attachments: [{ kind: "image", dataUrl: `data:image/png;base64,${"a".repeat(160)}` }] }],
      context: { agentMode: "chat" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.filter((line) => line.type === "delta").map((line) => line.content)).toEqual(["Aku", " Study", " Desk."]);
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

  test("translates tool_name progress and keeps generated images as artifacts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run-image", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        "event: tool.started",
        'data: {"type":"tool.started","tool_name":"image_generate"}',
        "",
        "event: run.completed",
        `data: ${JSON.stringify({ type: "run.completed", run_id: "run-image", output: "Selesai", image: `data:image/png;base64,${"a".repeat(160)}` })}`,
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "https://hermes.example",
      KOASIS_HERMES_API_KEY: "server-secret",
    });
    const response = await adapter.forwardChat({
      requestId: "request-image",
      messages: [{ role: "user", content: "buat gambar" }],
      context: { agentMode: "agentic" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.type === "tool_activity")).toMatchObject({ activity: "started", tool: "image_generate" });
    expect(lines.find((line) => line.type === "artifact")).toMatchObject({ artifact: { kind: "image", title: "Output gambar dari Agent" } });
  });

  test("sends image attachments through Hermes' multimodal streaming endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"Saya melihat gambar."}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({
      KOASIS_HERMES_API_URL: "http://koasis-agent:8642",
      KOASIS_HERMES_API_KEY: "server-secret",
    });
    const response = await adapter.forwardChat({
      requestId: "request-multimodal",
      messages: [{ role: "user", content: "jelaskan gambar", attachments: [{ kind: "image", dataUrl: `data:image/png;base64,${"a".repeat(160)}` }] }],
      context: { agentMode: "agentic", sessionId: "chat-2" },
      koasis: { sessionKey: "owner-a" },
    }, undefined, new AbortController().signal);
    const lines = (await response?.text() || "").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.find((line) => line.type === "delta")).toMatchObject({ content: "Saya melihat gambar." });
    expect(fetchSpy).toHaveBeenCalledWith("http://koasis-agent:8642/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-Hermes-Session-Key": "owner-a", "X-Hermes-Session-Id": "koasis-chat-2" }),
    }));
    const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const requestMessages = payload.messages as Array<Record<string, unknown>>;
    expect(requestMessages.at(-1)?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image_url" })]));
  });

  test("only the session owner can resolve a pending run", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ run_id: "run-control", status: "started" }), { status: 202 }))
      .mockResolvedValueOnce(new Response([
        'event: approval.request',
        'data: {"type":"approval.request","run_id":"run-control","description":"Izinkan tool?","choices":["once","deny"]}',
        "",
        'event: run.completed',
        'data: {"type":"run.completed","run_id":"run-control","output":"Selesai"}',
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const adapter = createHermesAdapter({ KOASIS_HERMES_API_URL: "https://hermes.example", KOASIS_HERMES_API_KEY: "server-secret" });
    const response = await adapter.forwardChat({
      requestId: "request-control",
      messages: [{ role: "user", content: "uji" }],
      koasis: { sessionKey: "owner-a" },
    }, undefined, new AbortController().signal);
    const controlResponse = new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
    fetchSpy.mockResolvedValueOnce(controlResponse);
    const foreignControl = adapter.control("request-control", "owner-b", { action: "approval", choice: "once" }, new AbortController().signal);
    const ownerControl = adapter.control("request-control", "owner-a", { action: "approval", choice: "once" }, new AbortController().signal);
    await expect(foreignControl).resolves.toMatchObject({ status: 404 });
    await expect(ownerControl).resolves.toMatchObject({ status: 202 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
