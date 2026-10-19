import { describe, expect, test } from "vitest";
import { KOASIS_MODELS, KOASIS_REASONING_LEVELS, koasisModelStyleInstructions, koasisReasoningProfile, normalizeKoasisModelId, normalizeKoasisReasoning } from "./koasisModels";

describe("Koasis model controls", () => {
  test("exposes the three named model tiers in product order", () => {
    expect(KOASIS_MODELS.map((model) => [model.label, model.tier])).toEqual([
      ["Cito 6.7", "Instant"],
      ["Elective 6.7", "Balance"],
      ["Executive 6.7", "Premium"],
    ]);
    expect(KOASIS_MODELS.every((model) => model.description.length > 20)).toBe(true);
  });

  test("keeps reasoning to Mild, Moderate, and Severe while migrating old values", () => {
    expect(KOASIS_REASONING_LEVELS.map((level) => level.label)).toEqual(["Mild", "Moderate", "Severe"]);
    expect(normalizeKoasisReasoning("low")).toBe("mild");
    expect(normalizeKoasisReasoning("medium")).toBe("moderate");
    expect(normalizeKoasisReasoning("extra-high")).toBe("severe");
    expect(normalizeKoasisModelId("unknown")).toBe("elective");
  });

  test("defines distinct visible answer styles for each model", () => {
    expect(koasisModelStyleInstructions("cito")).toContain("bullet");
    expect(koasisModelStyleInstructions("elective")).toContain("seimbangkan");
    expect(koasisModelStyleInstructions("executive")).toContain("mayoritas berbentuk paragraf");
  });

  test("maps each reasoning level to a distinct provider profile", () => {
    const profiles = KOASIS_REASONING_LEVELS.map((level) => koasisReasoningProfile(level.id));

    expect(profiles.map((profile) => profile.providerEffort)).toEqual(["low", "medium", "high"]);
    expect(profiles.map((profile) => profile.maxTokens)).toEqual([1200, 1800, 2800]);
    expect(profiles.map((profile) => profile.temperature)).toEqual([0.25, 0.2, 0.15]);
    expect(new Set(profiles.map((profile) => profile.instruction)).size).toBe(3);
  });
});
