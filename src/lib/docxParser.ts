import JSZip from "jszip";
import { decodeXml } from "./pptxParser";

const DOCUMENT_XML_PATH = "word/document.xml";

/**
 * Convert the WordprocessingML document body into readable clinical notes.
 *
 * DOCX is a zip of XML parts. We intentionally keep this parser small and
 * deterministic: paragraph breaks, explicit line breaks, tabs, and table
 * cells are preserved, while formatting-only XML is discarded.
 */
export function extractWordXmlText(xml: string): string {
  const tableCellMarker = "\uE000";
  const tableRowMarker = "\uE001";
  const textWithBreaks = xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, "\t")
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/w:tc\s*>/gi, tableCellMarker)
    .replace(/<\/w:tr\s*>/gi, tableRowMarker)
    .replace(/<\/w:p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n*\uE000\n*/g, "\t")
    .replace(/\n*\uE001\n*/g, "\n");

  return textWithBreaks
    .split(/\r\n?|\n/)
    .map((line) => decodeXml(line).replace(/[ ]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocxText(source: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const input = source instanceof Blob ? await source.arrayBuffer() : source;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new Error("DOCX tidak bisa dibaca. Pastikan file tidak rusak dan berformat .docx.");
  }

  const documentFile = zip.file(DOCUMENT_XML_PATH);
  if (!documentFile) {
    throw new Error("DOCX tidak memiliki dokumen utama yang bisa dibaca.");
  }

  const xml = await documentFile.async("string");
  const text = extractWordXmlText(xml);
  if (!text) {
    throw new Error("DOCX tidak berisi teks yang bisa diekstrak.");
  }
  return text;
}
