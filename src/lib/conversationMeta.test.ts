import { describe, expect, test } from "vitest";
import { buildConversationTitle, buildUniqueFollowUpQuestions } from "./conversationMeta";
import type { EvidenceSource } from "./evidenceSearchClient";

const source = (id: string, title: string, figures = false): EvidenceSource => ({
  id,
  source: "pubmed",
  title,
  authors: "Author A",
  journal: "Clinical Journal",
  year: "2025",
  isOpenAccess: true,
  url: `https://example.test/${id}`,
  ...(figures ? { figures: [{ id: `${id}-figure`, caption: "Comparison of outcomes", imageUrl: `https://example.test/${id}.png` }] } : {}),
});

describe("conversation metadata", () => {
  test("synthesizes a title from opening turns instead of copying one prompt", () => {
    const firstPrompt = "Jelaskan tentang pneumonia aspirasi dan cari evidence terbaru";
    const title = buildConversationTitle([
      { role: "assistant", content: "Halo, aku Evidence Desk." },
      { role: "user", content: firstPrompt },
      { role: "assistant", content: "## Diagnosis\n## Pencegahan\nTemuan awal tersedia." },
      { role: "user", content: "Bandingkan guideline komunitas dengan hasil meta-analisis untuk pasien dewasa." },
    ], { agentLabel: "Evidence Desk" });

    expect(title).toMatch(/^Mencari evidence tentang /);
    expect(title.toLocaleLowerCase()).toContain("pneumonia aspirasi");
    expect(title).not.toBe(firstPrompt);
    expect(title).not.toContain(" · ");
    expect(title.length).toBeLessThanOrEqual(68);
  });

  test("uses a natural sentence for Computer tasks", () => {
    const title = buildConversationTitle([
      { role: "user", content: "Buka Computer lalu cek YouTube untuk mencari video ini." },
    ], { agentLabel: "Koasis Agent" });

    expect(title).toBe("Menggunakan Computer untuk membuka YouTube");
    expect(title).not.toContain(" · ");
  });

  test("changes follow-ups when the answer and evidence graph change", () => {
    const first = buildUniqueFollowUpQuestions({
      prompt: "Carikan evidence pneumonia aspirasi",
      answer: "## Diagnosis\nDiagnosis klinis perlu dibedakan dari kolonisasi.\n## Pencegahan\nIntervensi perlu disesuaikan.",
      sources: [source("one", "Aspiration pneumonia diagnosis and prevention"), source("two", "Clinical outcomes after aspiration events", true)],
    });
    const second = buildUniqueFollowUpQuestions({
      prompt: "Jelaskan hematoma epidural pascatrauma",
      answer: "## Imaging\nMRI menjadi fokus evaluasi.\n## Red flags\nPerburukan neurologis harus diverifikasi.",
      sources: [source("three", "Acute traumatic epidural hematoma imaging")],
    });

    expect(first).toHaveLength(3);
    expect(new Set(first).size).toBe(3);
    expect(second).toHaveLength(3);
    expect(new Set(second).size).toBe(3);
    expect(first).not.toEqual(second);
    expect(first.join(" ").toLocaleLowerCase()).toContain("pneumonia");
    expect(second.join(" ").toLocaleLowerCase()).toContain("hematoma");
  });
});
