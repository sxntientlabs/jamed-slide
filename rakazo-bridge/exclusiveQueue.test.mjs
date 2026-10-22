import { describe, expect, it } from "vitest";
import { createExclusiveQueue } from "./exclusiveQueue.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("Rakazo bridge exclusive queue", () => {
  it("keeps shared bot work in order and reports queued requests", async () => {
    const queue = createExclusiveQueue();
    const events = [];

    const first = queue.run(async () => {
      events.push("first:start");
      await delay(20);
      events.push("first:end");
      return "first";
    });
    await delay(0);
    const second = queue.run(async () => {
      events.push("second:start");
      return "second";
    }, { onQueued: (position) => events.push(`second:queued:${position}`) });

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual([
      "first:start",
      "second:queued:1",
      "first:end",
      "second:start",
    ]);
    expect(queue.pending).toBe(0);
  });

  it("allows a disconnected request to leave the queue", async () => {
    const queue = createExclusiveQueue();
    const controller = new AbortController();
    let releaseFirst;
    const first = queue.run(() => new Promise((resolve) => { releaseFirst = resolve; }));
    await delay(0);
    const second = queue.run(() => "second", { signal: controller.signal });
    controller.abort();
    releaseFirst();

    await expect(second).rejects.toMatchObject({ code: "request_aborted" });
    await expect(first).resolves.toBeUndefined();
    expect(queue.pending).toBe(0);
  });
});
