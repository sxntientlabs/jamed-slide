import { describe, expect, test } from "vitest";
import { parseRichTextBlocks } from "./richText";

describe("rich text block parser", () => {
  test("groups paragraphs and supports semantic heading levels", () => {
    expect(parseRichTextBlocks("# Ringkasan\n\nKalimat pertama\nkalimat lanjutan.\n\n### Detail")).toEqual([
      { kind: "heading", level: 2, text: "Ringkasan" },
      { kind: "paragraph", lines: ["Kalimat pertama", "kalimat lanjutan."] },
      { kind: "heading", level: 4, text: "Detail" },
    ]);
  });

  test("groups markdown and unicode bullet lists", () => {
    expect(parseRichTextBlocks("• Satu\n• Dua\n\n1. Tiga\n2. Empat")).toEqual([
      { kind: "list", ordered: false, items: [{ level: 0, text: "Satu" }, { level: 0, text: "Dua" }] },
      { kind: "list", ordered: true, items: [{ level: 0, text: "Tiga" }, { level: 0, text: "Empat" }] },
    ]);
  });

  test("keeps quotes, tables, code blocks, and section labels as separate blocks", () => {
    expect(parseRichTextBlocks([
      "Alur clinical reasoning",
      "> Periksa tanda bahaya.",
      "",
      "| Temuan | Makna |",
      "| --- | --- |",
      "| Demam | Infeksi mungkin |",
      "",
      "```text",
      "catatan",
      "```",
    ].join("\n"))).toEqual([
      { kind: "section", text: "Alur clinical reasoning" },
      { kind: "blockquote", lines: ["Periksa tanda bahaya."] },
      { kind: "table", headers: ["Temuan", "Makna"], rows: [["Demam", "Infeksi mungkin"]] },
      { kind: "code", lang: "text", code: "catatan" },
    ]);
  });

  test("does not turn ordinary sentences beginning with a label word into headings", () => {
    expect(parseRichTextBlocks("Sumber ini perlu dibaca bersama konteks klinis.")).toEqual([
      { kind: "paragraph", lines: ["Sumber ini perlu dibaca bersama konteks klinis."] },
    ]);
  });
});
