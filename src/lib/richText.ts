export type RichTextListItem = {
  text: string;
  level: number;
};

export type RichTextBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "section"; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: RichTextListItem[] }
  | { kind: "todo"; items: Array<{ text: string; done: boolean }> }
  | { kind: "blockquote"; lines: string[] }
  | { kind: "code"; lang: string; code: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "rule" };

type ParsedListLine = {
  ordered: boolean;
  indent: number;
  text: string;
};

function pipeCells(line: string): string[] {
  const value = line.trim();
  if (!value.includes("|")) return [];
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isPipeDivider(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isRule(line: string): boolean {
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim());
}

function parseListLine(line: string): ParsedListLine | null {
  const ordered = /^(\s*)\d+[.)]\s+(.+)$/.exec(line);
  if (ordered) {
    return { ordered: true, indent: ordered[1].length, text: ordered[2].trim() };
  }
  const unordered = /^(\s*)[-*+•◦▪‣]\s+(.+)$/.exec(line);
  if (unordered) {
    return { ordered: false, indent: unordered[1].length, text: unordered[2].trim() };
  }
  return null;
}

function isTodoLine(line: string): boolean {
  return /^\s*[-*+•]\s+\[[ xX]\]\s+.+$/.test(line);
}

function sectionLabel(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 88 || /https?:\/\//i.test(trimmed)) return null;
  if (/^\*\*.+\*\*:?$/.test(trimmed) || /^__.+__:?$/.test(trimmed)) return trimmed.replace(/^(?:\*\*|__)|(?:\*\*|__)\:?$/g, "").trim();
  const plain = trimmed.replace(/^[*_]+|[*_]+$/g, "").trim();
  if (/^(?:tujuan|klarifikasi|sertakan|output|rencana sumber|sumber utama|sumber|bukti|metode|hasil|keterbatasan|implikasi|opsi|pilihan)$/i.test(plain)) return plain;
  if (/^(?:alur|contoh|kesalahan umum|exit ticket|takeaway|ringkasan|kesimpulan|batas klinis|catatan|langkah berikutnya|prioritas|poin penting|inti|diagnosis banding|tanda bahaya|interpretasi|pertimbangan|rekomendasi|apa yang perlu diingat)\b/i.test(plain)) return plain.replace(/:$/, "").trim();
  if (/^[^.!?]{3,72}:$/.test(plain)) return plain.slice(0, -1).trim();
  return null;
}

function isStructuralLine(lines: string[], index: number): boolean {
  const line = lines[index];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^```/.test(trimmed) || /^#{1,6}\s+/.test(trimmed) || /^>/.test(trimmed) || isRule(trimmed)) return true;
  if (parseListLine(line) || sectionLabel(line)) return true;
  const header = pipeCells(trimmed);
  const divider = index + 1 < lines.length ? pipeCells(lines[index + 1]) : [];
  return header.length >= 2 && isPipeDivider(divider);
}

export function parseRichTextBlocks(content: string): RichTextBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: RichTextBlock[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const lang = trimmed.replace(/^```/, "").trim() || "text";
      const codeLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) {
        codeLines.push(lines[cursor]);
        cursor += 1;
      }
      blocks.push({ kind: "code", lang, code: codeLines.join("\n") });
      index = cursor < lines.length ? cursor + 1 : cursor;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      blocks.push({ kind: "heading", level: depth === 1 ? 2 : depth === 2 ? 3 : 4, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (isRule(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const headerCells = pipeCells(trimmed);
    const dividerCells = index + 1 < lines.length ? pipeCells(lines[index + 1]) : [];
    if (headerCells.length >= 2 && isPipeDivider(dividerCells)) {
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length) {
        const cells = pipeCells(lines[cursor]);
        if (cells.length !== headerCells.length) break;
        rows.push(cells);
        cursor += 1;
      }
      if (rows.length) blocks.push({ kind: "table", headers: headerCells, rows });
      index = cursor;
      continue;
    }

    if (/^>/.test(trimmed)) {
      const quoteLines: string[] = [];
      let cursor = index;
      while (cursor < lines.length) {
        const quoteLine = lines[cursor].trim();
        if (!quoteLine.startsWith(">")) break;
        quoteLines.push(quoteLine.replace(/^>\s?/, "").trim());
        cursor += 1;
      }
      blocks.push({ kind: "blockquote", lines: quoteLines });
      index = cursor;
      continue;
    }

    if (isTodoLine(line)) {
      const items: Array<{ text: string; done: boolean }> = [];
      let cursor = index;
      while (cursor < lines.length) {
        const todo = /^\s*[-*+•]\s+\[([ xX])\]\s+(.+)$/.exec(lines[cursor]);
        if (!todo) break;
        items.push({ done: todo[1].toLowerCase() === "x", text: todo[2].trim() });
        cursor += 1;
      }
      blocks.push({ kind: "todo", items });
      index = cursor;
      continue;
    }

    const listStart = parseListLine(line);
    if (listStart) {
      const items: RichTextListItem[] = [];
      let cursor = index;
      while (cursor < lines.length) {
        const parsed = parseListLine(lines[cursor]);
        if (parsed && parsed.ordered === listStart.ordered) {
          items.push({ level: Math.min(3, Math.floor(parsed.indent / 2)), text: parsed.text });
          cursor += 1;
          continue;
        }
        if (!lines[cursor].trim() && parseListLine(lines[cursor + 1] || "")?.ordered === listStart.ordered) {
          cursor += 1;
          continue;
        }
        const continuation = lines[cursor].trim();
        const previous = items[items.length - 1];
        if (previous && continuation && lines[cursor].length - lines[cursor].trimStart().length > listStart.indent) {
          previous.text = `${previous.text} ${continuation}`;
          cursor += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered: listStart.ordered, items });
      index = cursor;
      continue;
    }

    const label = sectionLabel(line);
    if (label) {
      blocks.push({ kind: "section", text: label });
      index += 1;
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() && !isStructuralLine(lines, cursor)) {
      paragraphLines.push(lines[cursor].trim());
      cursor += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraphLines });
    index = cursor;
  }

  return blocks;
}
