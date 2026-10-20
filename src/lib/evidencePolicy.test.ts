import { describe, expect, it } from "vitest";
import { promptNeedsEvidence } from "./evidencePolicy";

describe("promptNeedsEvidence", () => {
  it("requires a lookup for clinical and source-seeking questions", () => {
    expect(promptNeedsEvidence("Jelaskan tatalaksana pneumonia aspirasi", "koasis")).toBe(true);
    expect(promptNeedsEvidence("Carikan jurnal tentang TB laten", "study")).toBe(true);
    expect(promptNeedsEvidence("Apakah skrining ini direkomendasikan?", "case")).toBe(true);
    expect(promptNeedsEvidence("Bandingkan strategi diagnosis untuk anemia mikrositik", "koasis")).toBe(true);
  });

  it("keeps pure drafting and formatting tasks local", () => {
    expect(promptNeedsEvidence("Buat draft pesan singkat ke DPJP", "messages")).toBe(false);
    expect(promptNeedsEvidence("Susun tabel dari data yang saya kirim", "koasis")).toBe(false);
    expect(promptNeedsEvidence("Buat outline presentasi dari catatan ini", "presentation")).toBe(false);
  });

  it("requires a source for substantive source-required specialist work", () => {
    expect(promptNeedsEvidence("Buat clinical prebrief pneumonia komunitas", "prebrief")).toBe(true);
    expect(promptNeedsEvidence("Tolong bantu", "prebrief")).toBe(false);
  });
});
