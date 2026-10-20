import { expect, test } from "vitest";
import { extractDocxText } from "./docxParser";
import { createChatArtifact, parseChatArtifactContent } from "./chatArtifacts";
import { parsePptx } from "./pptxParser";

const prompt = "Buat materi ringkas tentang keselamatan pasien dan handover";
const response = `# Keselamatan pasien

Keselamatan pasien membutuhkan struktur komunikasi yang jelas dan review sebelum dipakai.

- Identifikasi fakta yang sudah terdokumentasi.
- Tandai data yang belum tersedia.

## Handover

Gunakan format yang konsisten agar penerima dapat mengonfirmasi rencana berikutnya.`;

test("chat artifact parser keeps headings, paragraphs, and bullets", () => {
  const parsed = parseChatArtifactContent(prompt, response);
  expect(parsed.title).toContain("materi ringkas");
  expect(parsed.sections.map((section) => section.title)).toEqual(["Keselamatan pasien", "Handover"]);
  expect(parsed.sections[0]?.blocks.some((block) => block.kind === "bullet" && block.text.includes("fakta"))).toBe(true);
});

test("chat DOCX output is readable by the existing DOCX parser", async () => {
  const artifact = await createChatArtifact("docx", prompt, response);
  expect(artifact.fileName.endsWith(".docx")).toBe(true);
  const text = await extractDocxText(artifact.blob);
  expect(text).toContain("Keselamatan pasien");
  expect(text).toContain("Identifikasi fakta yang sudah terdokumentasi.");
  expect(text).toContain("Handover");
});

test("chat PPTX output is a valid parseable editable deck", async () => {
  const artifact = await createChatArtifact("pptx", prompt, response);
  expect(artifact.fileName.endsWith(".pptx")).toBe(true);
  const parsed = await parsePptx(await artifact.blob.arrayBuffer(), artifact.fileName, "generic");
  expect(parsed.slideCount).toBe(3);
  expect(parsed.slides[0]?.text).toContain("materi ringkas");
  expect(parsed.slides[1]?.text).toContain("Identifikasi fakta");
  expect(parsed.slides[2]?.text).toContain("Handover");
});
