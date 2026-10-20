import { afterEach, describe, expect, test, vi } from "vitest";
import { createRakazoAdapter } from "./rakazoAdapter";

describe("Rakazo adapter", () => {
  afterEach(() => vi.restoreAllMocks());

  test("exposes the lightweight runtime capabilities without a database", async () => {
    const adapter = createRakazoAdapter({ KOASIS_RAKAZO_MAX_RUN_EVENTS: "3" }, null);
    expect(adapter.describe()).toMatchObject({
      name: "koasis-rakazo-adapter",
      mode: "embedded",
      persistenceConfigured: false,
    });
    expect(adapter.describe().capabilities).toContain("computer-approval");

    await adapter.startRun({
      runId: "run-1",
      userId: "user-1",
      agentId: "evidence",
      modelId: "elective",
      reasoningEffort: "moderate",
      approvalMode: "ask",
    });
    await adapter.appendEvent("run-1", "user-1", "run.generating", { tool: "chat" });
    await adapter.finishRun("run-1", "user-1", "completed");

    const run = await adapter.getRun("run-1", "user-1");
    expect(run).toMatchObject({ runId: "run-1", status: "completed", harness: "rakazo" });
    expect(run?.events.map((event) => event.type)).toEqual(["run.accepted", "run.generating", "run.completed"]);
  });

  test("does not expose sensitive event payload fields", async () => {
    const adapter = createRakazoAdapter({}, null);
    await adapter.startRun({ runId: "run-2", userId: "user-2", agentId: "koasis", approvalMode: "approved" });
    await adapter.appendEvent("run-2", "user-2", "tool.activity", {
      tool: "computer",
      prompt: "private prompt",
      screenshotDataUrl: "data:image/png;base64,secret",
      message: "Membaca layar",
    });

    const run = await adapter.getRun("run-2", "user-2");
    expect(run?.events[1]?.payload).toEqual({ tool: "computer", message: "Membaca layar" });
  });

  test("forwards the documented chat contract when a remote runtime is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const adapter = createRakazoAdapter({ KOASIS_RAKAZO_API_URL: "https://rakazo.example/" }, null);
    expect(adapter.describe()).toMatchObject({ mode: "remote", remoteConfigured: true });

    await adapter.forwardChat({ requestId: "run-3", messages: [] }, "Bearer firebase-token", new AbortController().signal);
    expect(fetchSpy).toHaveBeenCalledWith("https://rakazo.example/api/agent/chat", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer firebase-token", "X-Koasis-Rakazo-Forwarded": "1" }),
    }));
  });
});
