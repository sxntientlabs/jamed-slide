import { describe, expect, test } from "vitest";
import { createInstaboxSettings, DEFAULT_SHARED_MACHINE_IDENTIFIERS } from "./instabox";

describe("Instabox shared machine configuration", () => {
  test("uses the five Koasis pool names by default", () => {
    const settings = createInstaboxSettings({});
    expect(settings.sharedMachineIds).toEqual([...DEFAULT_SHARED_MACHINE_IDENTIFIERS]);
  });

  test("accepts an explicit allowlist of machine ids or names", () => {
    const settings = createInstaboxSettings({
      INSTABOX_SHARED_MACHINE_IDS: " m-alpha, m-beta, m-delta ",
    });
    expect(settings.sharedMachineIds).toEqual(["m-alpha", "m-beta", "m-delta"]);
  });
});
