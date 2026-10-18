import { describe, expect, it } from "vitest";
import { MKAR_ASSESSMENTS, MKAR_PHASES, MKAR_PROFILE, MKAR_SUB_CPMK, MKAR_TARGETS } from "./mkarProfile";

describe("MKAR module profile", () => {
  it("keeps the curriculum contract visible in the cockpit", () => {
    expect(MKAR_PROFILE.duration).toBe("9 minggu");
    expect(MKAR_PHASES.map((phase) => phase.id)).toEqual(["orientasi", "latihan", "umpan-balik"]);
    expect(MKAR_SUB_CPMK).toHaveLength(18);
  });

  it("contains both skill and clinical exposure targets", () => {
    expect(MKAR_TARGETS.some((target) => target.category === "skill")).toBe(true);
    expect(MKAR_TARGETS.some((target) => target.category === "case")).toBe(true);
    expect(MKAR_TARGETS.find((target) => target.id === "pneumonia")?.target).toBe(2);
    expect(MKAR_TARGETS.find((target) => target.id === "kpsp")?.target).toBe(2);
  });

  it("preserves the assessment weight map", () => {
    expect(MKAR_ASSESSMENTS.find((assessment) => assessment.id === "cbd")?.weight).toBe("10%");
    expect(MKAR_ASSESSMENTS.find((assessment) => assessment.id === "dops")?.weight).toBe("10%");
    expect(MKAR_ASSESSMENTS.find((assessment) => assessment.id === "mcq")?.weight).toBe("20%");
    expect(MKAR_ASSESSMENTS.find((assessment) => assessment.id === "osce")?.weight).toBe("20%");
    expect(MKAR_ASSESSMENTS.find((assessment) => assessment.id === "oral")?.weight).toBe("30%");
  });
});
