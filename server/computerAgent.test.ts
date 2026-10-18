import { describe, expect, test } from "vitest";
import { COMPUTER_AGENT_MAX_ACTIONS, COMPUTER_AGENT_MAX_ROUNDS, COMPUTER_AGENT_TOOLS, computerIntentDetected, parseComputerToolArguments } from "./computerAgent";

describe("Computer agent capability", () => {
  test("only activates for explicit Computer intent", () => {
    expect(computerIntentDetected("buka Computer lalu cek halaman login")).toBe(true);
    expect(computerIntentDetected("tolong jelaskan konsep ini tanpa membuka browser")).toBe(false);
    expect(computerIntentDetected("buatkan ringkasan jurnal")).toBe(false);
  });

  test("exposes bounded desktop tools without arbitrary shell access", () => {
    const names = COMPUTER_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining(["computer_start", "computer_screenshot", "computer_click", "computer_type"]));
    expect(names).not.toContain("computer_shell");
    expect(COMPUTER_AGENT_MAX_ACTIONS).toBe(12);
    expect(COMPUTER_AGENT_MAX_ROUNDS).toBe(8);
  });

  test("rejects malformed tool arguments", () => {
    expect(parseComputerToolArguments('{"url":"https://example.com"}')).toEqual({ url: "https://example.com" });
    expect(() => parseComputerToolArguments("not-json")).toThrow("bukan JSON object yang valid");
    expect(() => parseComputerToolArguments(["unexpected"])).toThrow("harus berupa JSON object");
  });
});

