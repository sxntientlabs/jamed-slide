import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "./agentCatalog";
import { ASSESSMENT_LAB, CALCULATOR_CATALOG, CLINICAL_DAY_BLOCKS, fillMessageTemplate, MESSAGE_TEMPLATES, PROCEDURE_CATALOG, calculateClinicalTool } from "./clinicalOps";

describe("clinical ops registry", () => {
  it("keeps operational catalogs addressable and agent-backed", () => {
    const ids = [
      ...CLINICAL_DAY_BLOCKS.map((item) => item.id),
      ...PROCEDURE_CATALOG.map((item) => item.id),
      ...CALCULATOR_CATALOG.map((item) => item.id),
      ...MESSAGE_TEMPLATES.map((item) => item.id),
      ...ASSESSMENT_LAB.map((item) => item.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const agentIds = new Set(AGENT_DEFINITIONS.map((agent) => agent.id));
    expect(ASSESSMENT_LAB.every((item) => agentIds.has(item.agentId))).toBe(true);
    expect(PROCEDURE_CATALOG.every((item) => item.steps.length > 2 && item.safetyGate.length > 20)).toBe(true);
  });
});

describe("deterministic clinical calculators", () => {
  it("calculates BMI and BSA without relying on the agent", () => {
    expect(calculateClinicalTool("bmi", { weightKg: "18.5", heightCm: "110" })).toMatchObject({ value: "15.3", unit: "kg/m²" });
    expect(calculateClinicalTool("bsa", { weightKg: "18.5", heightCm: "110" })).toMatchObject({ value: "0.75", unit: "m²" });
  });

  it("calculates MAP and shock index with visible units", () => {
    expect(calculateClinicalTool("map", { systolic: "100", diastolic: "60" })).toMatchObject({ value: "73.3", unit: "mmHg" });
    expect(calculateClinicalTool("shock-index", { heartRate: "120", systolic: "100" })).toMatchObject({ value: "1.20", unit: "rasio" });
  });

  it("rejects incomplete or non-positive input", () => {
    expect(calculateClinicalTool("bmi", { weightKg: "", heightCm: "110" })).toEqual({ error: "Masukkan berat dan tinggi dengan angka lebih dari 0." });
    expect(calculateClinicalTool("map", { systolic: "100", diastolic: "0" })).toEqual({ error: "Masukkan tekanan sistolik dan diastolik." });
  });
});

describe("DPJP message desk", () => {
  it("fills a template and leaves missing context visible", () => {
    const template = MESSAGE_TEMPLATES.find((item) => item.id === "new-patient");
    expect(template).toBeDefined();
    expect(fillMessageTemplate(template!, { alias: "P-07", unit: "IGD", summary: "Demam sejak pagi" })).toContain("P-07");
    expect(fillMessageTemplate(template!, { alias: "P-07" })).toContain("[unit]");
  });
});
