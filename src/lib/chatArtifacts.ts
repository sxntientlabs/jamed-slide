import JSZip from "jszip";

export type ChatArtifactKind = "pptx" | "docx";

export type GeneratedChatArtifact = {
  kind: ChatArtifactKind;
  fileName: string;
  mimeType: string;
  title: string;
  blob: Blob;
};

type ArtifactBlock = {
  kind: "paragraph" | "bullet";
  text: string;
};

export type ChatArtifactSection = {
  title: string;
  blocks: ArtifactBlock[];
};

export type ParsedChatArtifactContent = {
  title: string;
  sections: ChatArtifactSection[];
};

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_SECTIONS = 8;
const MAX_BLOCKS_PER_SECTION = 10;
const MAX_BLOCK_CHARS = 900;

function xmlEscape(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint >= 0x20;
    })
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromPrompt(prompt: string): string {
  const cleaned = stripInlineMarkdown(prompt)
    .replace(/^(?:tolong|bantu|buatkan|buat|susun|generate|create)\s+/i, "")
    .replace(/^(?:file|output|dokumen|presentasi)\s+/i, "")
    .trim();
  const candidate = cleaned.split(/[.!?\n]/)[0]?.trim() || "Output dari percakapan Koasis";
  return candidate.slice(0, 90) || "Output dari percakapan Koasis";
}

function normalizeSectionTitle(value: string, fallback: string): string {
  const title = stripInlineMarkdown(value).replace(/^[:\-–—]+|[:\-–—]+$/g, "").trim();
  return (title || fallback).slice(0, 100);
}

function pushParagraph(buffer: string[], blocks: ArtifactBlock[]): void {
  const text = stripInlineMarkdown(buffer.join(" "));
  if (text) blocks.push({ kind: "paragraph", text: text.slice(0, MAX_BLOCK_CHARS) });
  buffer.length = 0;
}

function splitOversizedSection(section: ChatArtifactSection): ChatArtifactSection[] {
  if (section.blocks.length <= MAX_BLOCKS_PER_SECTION) return [section];
  const chunks: ChatArtifactSection[] = [];
  for (let index = 0; index < section.blocks.length; index += MAX_BLOCKS_PER_SECTION) {
    const chunk = section.blocks.slice(index, index + MAX_BLOCKS_PER_SECTION);
    chunks.push({
      title: index === 0 ? section.title : `${section.title} ${Math.floor(index / MAX_BLOCKS_PER_SECTION) + 1}`,
      blocks: chunk,
    });
  }
  return chunks;
}

export function parseChatArtifactContent(prompt: string, response: string): ParsedChatArtifactContent {
  const title = titleFromPrompt(prompt);
  const lines = response.replace(/\r/g, "").split("\n");
  const sections: ChatArtifactSection[] = [];
  let current: ChatArtifactSection = { title, blocks: [] };
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => pushParagraph(paragraphBuffer, current.blocks);
  const flushSection = () => {
    flushParagraph();
    if (current.blocks.length) sections.push(current);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushSection();
      current = { title: normalizeSectionTitle(heading[2], `Bagian ${sections.length + 1}`), blocks: [] };
      continue;
    }
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const text = stripInlineMarkdown(bullet[1]);
      if (text) current.blocks.push({ kind: "bullet", text: text.slice(0, MAX_BLOCK_CHARS) });
      continue;
    }
    paragraphBuffer.push(line);
  }
  flushSection();

  const expandedSections = sections.flatMap(splitOversizedSection).slice(0, MAX_SECTIONS);
  if (!expandedSections.length) {
    expandedSections.push({ title: "Ringkasan", blocks: [{ kind: "paragraph", text: "Belum ada isi yang dapat dibentuk dari percakapan ini." }] });
  }
  return { title, sections: expandedSections };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .slice(0, 48) || "koasis-output";
}

function pptRelationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
}

function pptShape(id: number, name: string, x: number, y: number, cx: number, cy: number, paragraphs: Array<{ text: string; bullet?: boolean }>, options: { fontSize: number; color: string; bold?: boolean; fill?: string } ): string {
  const paragraphXml = paragraphs.map((paragraph) => `<a:p><a:pPr${paragraph.bullet ? ' marL="228600" indent="-114300"' : ""}>${paragraph.bullet ? '<a:buChar char="•"/>' : ""}</a:pPr><a:r><a:rPr lang="id-ID" sz="${options.fontSize}" b="${options.bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${options.color}"/></a:solidFill></a:rPr><a:t>${xmlEscape(paragraph.text)}</a:t></a:r><a:endParaRPr lang="id-ID" sz="${options.fontSize}"/></a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xmlEscape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${options.fill ? `<a:solidFill><a:srgbClr val="${options.fill}"/></a:solidFill>` : "<a:noFill/>"}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t"><a:spAutoFit/></a:bodyPr><a:lstStyle/>${paragraphXml}</p:txBody></p:sp>`;
}

function pptBackground(id: number, fill: string): string {
  return pptShape(id, "Background", 0, 0, 12192000, 6858000, [], { fontSize: 100, color: fill, fill });
}

function pptSlideXml(title: string, sections: ChatArtifactSection[], index: number): string {
  const slideChildren: string[] = [pptBackground(2, "18212B")];
  if (index === 0) {
    slideChildren.push(pptShape(3, "Title", 720000, 1550000, 10752000, 1250000, [{ text: title }], { fontSize: 3000, color: "FFFFFF", bold: true }));
    slideChildren.push(pptShape(4, "Subtitle", 750000, 3100000, 10000000, 600000, [{ text: "Dibuat dari percakapan Koasis" }], { fontSize: 1600, color: "AFC2D4" }));
  } else {
    const section = sections[index - 1];
    slideChildren.push(pptShape(3, "Section title", 720000, 560000, 10752000, 700000, [{ text: section.title }], { fontSize: 2400, color: "FFFFFF", bold: true }));
    const paragraphs = section.blocks.map((block) => ({ text: block.text, bullet: block.kind === "bullet" }));
    slideChildren.push(pptShape(4, "Content", 850000, 1450000, 10300000, 4600000, paragraphs, { fontSize: 1600, color: "E8EEF4" }));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Slide ${index + 1}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="12192000" cy="6858000"/></a:xfrm></p:grpSpPr>${slideChildren.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function pptThemeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Koasis"><a:themeElements><a:clrScheme name="Koasis"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="18212B"/></a:dk2><a:lt2><a:srgbClr val="E8EEF4"/></a:lt2><a:accent1><a:srgbClr val="2997D8"/></a:accent1><a:accent2><a:srgbClr val="77B5D9"/></a:accent2><a:accent3><a:srgbClr val="AFC2D4"/></a:accent3><a:accent4><a:srgbClr val="6B7C8F"/></a:accent4><a:accent5><a:srgbClr val="516171"/></a:accent5><a:accent6><a:srgbClr val="FFFFFF"/></a:accent6><a:hlink><a:srgbClr val="2997D8"/></a:hlink><a:folHlink><a:srgbClr val="77B5D9"/></a:folHlink></a:clrScheme><a:fontScheme name="Koasis"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Koasis"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`;
}

function pptSlideMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld name="Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
}

function pptSlideLayoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

async function createPptxBlob(parsed: ParsedChatArtifactContent): Promise<Blob> {
  const zip = new JSZip();
  const slideCount = parsed.sections.length + 1;
  const overrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
  const slideIds = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  const slideRelationships = Array.from({ length: slideCount }, (_, index) => pptRelationship(`rId${index + 2}`, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide", `slides/slide${index + 1}.xml`)).join("");

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "ppt/presentation.xml")}${pptRelationship("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")}${pptRelationship("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml")}</Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", "slideMasters/slideMaster1.xml")}${slideRelationships}</Relationships>`);
  zip.file("ppt/slideMasters/slideMaster1.xml", pptSlideMasterXml());
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", "../slideLayouts/slideLayout1.xml")}${pptRelationship("rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", "../theme/theme1.xml")}</Relationships>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", pptSlideLayoutXml());
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster", "../slideMasters/slideMaster1.xml")}</Relationships>`);
  zip.file("ppt/theme/theme1.xml", pptThemeXml());
  for (let index = 0; index < slideCount; index += 1) {
    zip.file(`ppt/slides/slide${index + 1}.xml`, pptSlideXml(parsed.title, parsed.sections, index));
    zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout", "../slideLayouts/slideLayout1.xml")}</Relationships>`);
  }
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(parsed.title)}</dc:title><dc:creator>Koasis</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Koasis</Application><Slides>${slideCount}</Slides></Properties>`);
  return zip.generateAsync({ type: "blob", mimeType: PPTX_MIME });
}

function docxRun(text: string, bold = false): string {
  return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function docxParagraph(text: string, style?: string, bullet = false): string {
  const prefix = bullet ? "• " : "";
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${docxRun(`${prefix}${text}`)}</w:p>`;
}

function docxStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
}

async function createDocxBlob(parsed: ParsedChatArtifactContent): Promise<Blob> {
  const zip = new JSZip();
  const paragraphs = [docxParagraph(parsed.title, "Title"), docxParagraph("Dibuat dari percakapan Koasis")];
  for (const section of parsed.sections) {
    paragraphs.push(docxParagraph(section.title, "Heading1"));
    for (const block of section.blocks) paragraphs.push(docxParagraph(block.text, undefined, block.kind === "bullet"));
  }
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "word/document.xml")}${pptRelationship("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml")}${pptRelationship("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", "docProps/app.xml")}</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  zip.file("word/styles.xml", docxStylesXml());
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pptRelationship("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml")}</Relationships>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(parsed.title)}</dc:title><dc:creator>Koasis</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Koasis</Application></Properties>`);
  return zip.generateAsync({ type: "blob", mimeType: DOCX_MIME });
}

export async function createChatArtifact(kind: ChatArtifactKind, prompt: string, response: string): Promise<GeneratedChatArtifact> {
  const parsed = parseChatArtifactContent(prompt, response);
  const extension = kind === "pptx" ? "pptx" : "docx";
  const mimeType = kind === "pptx" ? PPTX_MIME : DOCX_MIME;
  const blob = kind === "pptx" ? await createPptxBlob(parsed) : await createDocxBlob(parsed);
  return {
    kind,
    title: parsed.title,
    fileName: `${slugify(parsed.title)}.${extension}`,
    mimeType,
    blob,
  };
}
