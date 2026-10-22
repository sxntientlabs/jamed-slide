import { describe, expect, test } from "vitest";
import { COMPUTER_AGENT_MAX_ACTIONS, COMPUTER_AGENT_MAX_ROUNDS, COMPUTER_AGENT_TOOLS, computerIntentDetected, parseComputerToolArguments, simpleComputerNavigationUrl } from "./computerAgent";

describe("Computer agent capability", () => {
  test("only activates for explicit Computer intent", () => {
    expect(computerIntentDetected("buka Computer lalu cek halaman login")).toBe(true);
    expect(computerIntentDetected("tolong jelaskan konsep ini tanpa membuka browser")).toBe(false);
    expect(computerIntentDetected("buatkan ringkasan jurnal")).toBe(false);
    expect(computerIntentDetected("tolong buka dan tinjau link Google Slides ini https://docs.google.com/presentation/d/example")).toBe(true);
    expect(computerIntentDetected("gunakan browser untuk membuka website dan cek form ini")).toBe(true);
    expect(computerIntentDetected("buatkan ringkasan dari link tanpa membuka browser")).toBe(false);
  });

  test("resolves simple navigation without an LLM planning round", () => {
    expect(simpleComputerNavigationUrl("tolong buka docs")).toBe("https://docs.google.com/document/u/0/");
    expect(simpleComputerNavigationUrl("open this https://example.com")).toBe("https://example.com/");
    expect(simpleComputerNavigationUrl("buka Google Drive")).toBe("https://drive.google.com/drive/my-drive");
    expect(simpleComputerNavigationUrl("buka docs lalu cari file pneumonia")).toBeNull();
    expect(simpleComputerNavigationUrl("buka docs dan edit dokumen ini")).toBeNull();
  });

  test("exposes bounded desktop tools without arbitrary shell access", () => {
    const names = COMPUTER_AGENT_TOOLS.map((tool) => tool.function.name);
    expect(names).toEqual(expect.arrayContaining(["computer_start", "computer_screenshot", "computer_click", "computer_type"]));
    expect(names).not.toContain("computer_shell");
    expect(COMPUTER_AGENT_MAX_ACTIONS).toBe(32);
    expect(COMPUTER_AGENT_MAX_ROUNDS).toBe(16);
  });

  test("rejects malformed tool arguments", () => {
    expect(parseComputerToolArguments('{"url":"https://example.com"}')).toEqual({ url: "https://example.com" });
    expect(() => parseComputerToolArguments("not-json")).toThrow("bukan JSON object yang valid");
    expect(() => parseComputerToolArguments(["unexpected"])).toThrow("harus berupa JSON object");
  });
});
