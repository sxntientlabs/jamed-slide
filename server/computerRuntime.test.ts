import { describe, expect, test } from "vitest";
import { DEFAULT_COMPUTER_RUNTIME, resolveComputerRuntime } from "./computerRuntime";

describe("Koasis Computer runtime routing", () => {
  test("defaults to the private VPS sandbox", () => {
    expect(resolveComputerRuntime(undefined)).toBe(DEFAULT_COMPUTER_RUNTIME);
    expect(resolveComputerRuntime("vps")).toBe("vps");
  });

  test("keeps Instabox as an explicit compatibility mode", () => {
    expect(resolveComputerRuntime("instabox")).toBe("instabox");
    expect(resolveComputerRuntime(" INSTABOX ")).toBe("instabox");
  });

  test("fails closed to the VPS sandbox for unknown values", () => {
    expect(resolveComputerRuntime("anything-else")).toBe("vps");
  });
});
