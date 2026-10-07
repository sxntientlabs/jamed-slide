import JSZip from "jszip";
import type {
  ParsedShape,
  ParsedSlide,
  ParsedTemplate,
  SemanticField,
  SlideRole,
  TemplateBinding,
  TemplateProfileId,
} from "../types";
import { inferPatientScope, inferSlideInclusion } from "./templateSlides";

const EMU_PER_INCH = 914400;

export function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeXml(value: string): string {
  // PowerPoint XML is XML 1.0. Clinical notes often come from copied text
  // and may contain vertical tabs, form feeds, or other control characters
  // that are illegal in XML even though JavaScript strings accept them.
  const xmlSafeValue = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    })
    .join("");
  return xmlSafeValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match?.[1];
}

function parseEmu(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed / EMU_PER_INCH) * 100) / 100 : undefined;
}

function textRuns(xml: string): string[] {
  return Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map((match) =>
    decodeXml(match[1]),
  );
}

function shapeBlock(xml: string, kind: "sp" | "graphicFrame" | "pic"): Array<{ index: number; xml: string }> {
  const matcher = new RegExp(`<p:${kind}\\b[\\s\\S]*?<\\/p:${kind}>`, "g");
  return Array.from(xml.matchAll(matcher)).map((match) => ({
    index: match.index ?? 0,
    xml: match[0],
  }));
}

function parseTableRows(block: string): string[][] | undefined {
  if (!block.startsWith("<p:graphicFrame")) return undefined;
  const table = block.match(/<a:tbl\b[\s\S]*?<\/a:tbl>/)?.[0];
  if (!table) return undefined;
  const rows = Array.from(table.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)).map((rowMatch) => {
    const row = rowMatch[0];
    return Array.from(row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)).map((cellMatch) =>
      textRuns(cellMatch[0]).join("").replace(/\u000b/g, " ").replace(/\s+/g, " ").trim(),
    );
  });
  return rows.length ? rows : undefined;
}

function parseFontSizePt(block: string): number | undefined {
  const match = block.match(/<a:(?:rPr|defRPr)\b[^>]*\bsz="(\d+)"/);
  if (!match) return undefined;
  const size = Number(match[1]) / 100;
  return Number.isFinite(size) ? Math.round(size * 10) / 10 : undefined;
}

function parseShapeFill(block: string): string | undefined {
  const color = block.match(/<a:solidFill>[\s\S]*?<a:(?:srgbClr|schemeClr)\b[^>]*\bval="([^"]+)"/);
  return color?.[1];
}

function resolveZipTarget(sourceFile: string, target: string): string {
  const base = sourceFile.split("/").slice(0, -1);
  const parts = [...base, ...target.split("/")];
  const resolved: string[] = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  });
  return resolved.join("/");
}

async function readSpeakerNotes(zip: JSZip, slideFile: string): Promise<string | undefined> {
  const slideName = slideFile.split("/").pop();
  if (!slideName) return undefined;
  const relsFile = `ppt/slides/_rels/${slideName}.rels`;
  const relsXml = await zip.file(relsFile)?.async("string");
  if (!relsXml) return undefined;
  const relationships = parseRelationships(relsXml);
  for (const target of relationships.values()) {
    if (!/notesSlide/i.test(target)) continue;
    const notesPath = resolveZipTarget(slideFile, target);
    const notesXml = await zip.file(notesPath)?.async("string");
    if (!notesXml) continue;
    const notes = textRuns(notesXml)
      .map((text) => text.replace(/\u000b/g, " ").replace(/\s+/g, " ").trim())
      .filter((text) => text && !/^(?:‹#›|click to add notes|catatan)$/i.test(text));
    if (notes.length) return notes.join(" ").slice(0, 2400);
  }
  return undefined;
}

function parseShapes(xml: string): ParsedShape[] {
  const blocks = [...shapeBlock(xml, "sp"), ...shapeBlock(xml, "graphicFrame"), ...shapeBlock(xml, "pic")].sort(
    (left, right) => left.index - right.index,
  );

  return blocks.map(({ xml: block }) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    const id = readAttribute(cNvPr, "id") ?? `shape-${Math.random().toString(36).slice(2, 8)}`;
    const name = readAttribute(cNvPr, "name");
    const text = textRuns(block).join("").replace(/\u000b/g, " ").trim();
    const off = block.match(/<a:off\b[^>]*>/)?.[0];
    const ext = block.match(/<a:ext\b[^>]*>/)?.[0];
    const placeholder = block.match(/<p:ph\b[^>]*>/)?.[0];
    const kind: ParsedShape["kind"] = block.startsWith("<p:graphicFrame")
      ? "graphicFrame"
      : block.startsWith("<p:pic")
        ? "picture"
        : "text";

    return {
      id,
      name,
      kind,
      text,
      tableRows: parseTableRows(block),
      fontSizePt: parseFontSizePt(block),
      bold: /<a:(?:rPr|defRPr)\b[^>]*\bb="(?:1|true)"/i.test(block) || undefined,
      fillColor: parseShapeFill(block),
      x: parseEmu(readAttribute(off ?? "", "x")),
      y: parseEmu(readAttribute(off ?? "", "y")),
      width: parseEmu(readAttribute(ext ?? "", "cx")),
      height: parseEmu(readAttribute(ext ?? "", "cy")),
      placeholderType: readAttribute(placeholder ?? "", "type"),
      placeholderIndex: readAttribute(placeholder ?? "", "idx"),
    } satisfies ParsedShape;
  });
}

function templateProfileIdForFile(fileName: string, slideCount: number): TemplateProfileId {
  const identity = fileName.toLowerCase();
  if (/igd\s*harkit/.test(identity)) return "igd-harkit";
  if (/igd\s*rsut/.test(identity)) return "igd-rsut";
  if (/perina\s*harkit/.test(identity)) return "perina-harkit";
  if (/perina\s*rsut/.test(identity)) return "perina-rsut";
  if (/perina\s*rsab/.test(identity)) return "perina-rsab";
  if (/perina\s*lapjag/.test(identity)) return "perina-lapjag";
  if (/\brscm\b/.test(identity)) return "rscm";
  if (/\brsui\b/.test(identity)) return "rsui";
  if (/lapjag/.test(identity) && slideCount >= 25) return "lapjag";
  return "generic";
}

function lapjagRoleForSlide(index: number, total: number): SlideRole | undefined {
  // Lapjag is a fixed clinical narrative. Keep the profile index-based because
  // the chart slides intentionally contain almost no text of their own.
  const rolesForCurrentTemplate = [
    "cover",
    "shift_summary",
    "patient_identity",
    "pediatric_assessment",
    "primary_survey",
    "secondary_survey",
    "anamnesis",
    "history",
    "history",
    "anthropometry",
    "anthropometry",
    "anthropometry",
    "anthropometry",
    "physical_exam",
    "physical_exam",
    "diagnosis",
    "management",
    "investigation",
    "investigation",
    "investigation",
    "investigation",
    "investigation",
    "diagnosis",
    "management",
    "management",
    "management",
    "closing",
  ] as SlideRole[];
  const rolesBeforeDuplicateRemoval = [
    "cover",
    "shift_summary",
    "patient_identity",
    "pediatric_assessment",
    "primary_survey",
    "secondary_survey",
    "anamnesis",
    "history",
    "history",
    "anthropometry",
    "anthropometry",
    "anthropometry",
    "anthropometry",
    "physical_exam",
    "physical_exam",
    "diagnosis",
    "management",
    "management",
    "investigation",
    "investigation",
    "investigation",
    "investigation",
    "diagnosis",
    "management",
    "management",
    "management",
    "management",
    "closing",
  ] as SlideRole[];
  const roles = total === rolesBeforeDuplicateRemoval.length ? rolesBeforeDuplicateRemoval : rolesForCurrentTemplate;
  return roles[index];
}

const PROFILE_ROLE_MAPS: Partial<Record<TemplateProfileId, SlideRole[]>> = {
  "perina-lapjag": ["cover", "patient_identity", "consultation", "history", "delivery_preparation", "resuscitation", "stabilization", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "investigation", "investigation", "management", "closing"],
  "perina-harkit": ["cover", "patient_identity", "consultation", "history", "delivery_preparation", "resuscitation", "stabilization", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "investigation", "investigation", "management", "closing"],
  "perina-rsut": ["cover", "patient_identity", "consultation", "history", "delivery_preparation", "resuscitation", "stabilization", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "investigation", "investigation", "management", "closing"],
  "perina-rsab": ["cover", "patient_identity", "consultation", "history", "delivery_preparation", "resuscitation", "stabilization", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "investigation", "investigation", "management", "closing"],
  "igd-harkit": ["cover", "shift_summary", "patient_identity", "pediatric_assessment", "primary_survey", "secondary_survey", "history", "history", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "management", "investigation", "diagnosis", "management", "closing"],
  "igd-rsut": ["cover", "shift_summary", "patient_identity", "pediatric_assessment", "primary_survey", "secondary_survey", "history", "history", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "management", "investigation", "diagnosis", "management", "closing"],
  rscm: ["cover", "shift_summary", "patient_identity", "pediatric_assessment", "primary_survey", "secondary_survey", "history", "history", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "management", "investigation", "diagnosis", "management", "closing"],
  rsui: ["cover", "patient_identity", "pediatric_assessment", "primary_survey", "management", "secondary_survey", "history", "history", "history", "anthropometry", "physical_exam", "physical_exam", "diagnosis", "investigation", "investigation", "investigation", "diagnosis", "management", "closing"],
};

const IGD_HARKIT_CURRENT_ROLES: SlideRole[] = [
  "cover", "shift_summary", "patient_identity", "pediatric_assessment", "primary_survey", "primary_survey", "pediatric_assessment", "secondary_survey", "anamnesis", "anamnesis", "history", "history", "history", "anthropometry", "physical_exam", "physical_exam", "investigation", "diagnosis", "management", "management", "closing",
];

const RSUI_CURRENT_ROLES: SlideRole[] = [
  "cover", "shift_summary", "patient_identity", "pediatric_assessment", "primary_survey", "secondary_survey", "anamnesis", "history", "history", "history", "anthropometry", "physical_exam", "physical_exam", "investigation", "diagnosis", "management", "management", "management", "management", "management", "closing",
];

function roleForSlide(text: string, index: number, total: number, fileName = "", profileId: TemplateProfileId = templateProfileIdForFile(fileName, total)): SlideRole {
  const explicitRole = profileId === "lapjag"
    ? lapjagRoleForSlide(index, total)
    : profileId === "igd-harkit" && total === 21
      ? IGD_HARKIT_CURRENT_ROLES[index]
      : profileId === "rsui" && total === 21
        ? RSUI_CURRENT_ROLES[index]
        : PROFILE_ROLE_MAPS[profileId]?.[index];
  if (explicitRole) return explicitRole;
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (index === 0 || normalized.includes("laporan jaga")) return "cover";
  if (index === total - 1 || normalized.includes("terima kasih") || normalized.includes("penutup")) {
    return "closing";
  }
  if (/(pasien baru|ringkasan|summary|resume jaga|daftar pasien)/.test(normalized)) return "shift_summary";
  if (/(identitas|nama\s*:|jenis kelamin|no\.\s*rm)/.test(normalized)) return "patient_identity";
  if (/(pediatric assesment triangle|pediatric assessment triangle)/.test(normalized)) return "pediatric_assessment";
  if (/primary survey/.test(normalized)) return "primary_survey";
  if (/secondary survey/.test(normalized)) return "secondary_survey";
  if (/(status antropometri|antropometri|status gizi)/.test(normalized)) return "anthropometry";
  if (/(pemeriksaan fisis|pemeriksaan fisik|tanda vital|keadaan umum)/.test(normalized)) return "physical_exam";
  if (/(organ\s*deskripsi|kepala.*mata.*mulut|ekstremitas.*kulit)/.test(normalized)) return "physical_exam";
  if (/(laboratorium|radiologi|usg|pemeriksaan penunjang|penunjang)/.test(normalized)) return "investigation";
  if (/(tata laksana|tatalaksana|terapi|pengobatan|manajemen)/.test(normalized)) return "management";
  if (/(diagnosis|assessment|diagnosa)/.test(normalized)) return "diagnosis";
  if (/(riwayat penyakit sekarang|anamnesis|keluhan utama)/.test(normalized)) return "anamnesis";
  if (/(riwayat penyakit dahulu|riwayat penyakit keluarga|riwayat keluarga|riwayat kehamilan|riwayat kelahiran|riwayat persalinan|riwayat imunisasi|riwayat nutrisi|sosioekonomi)/.test(normalized)) return "history";
  if (/(timeline|kronologi|perjalanan penyakit)/.test(normalized)) return "timeline";
  if (/(kesimpulan pasien|patient summary|resume pasien)/.test(normalized)) return "patient_summary";
  return "unknown";
}

function hasValueSlot(text: string): boolean {
  return /[:：]|_{2,}|\.{2,}|…{1,}/.test(text);
}

function normalizedText(text: string): string {
  return text.toLowerCase().replace(/[\s\u00a0]+/g, " ").trim();
}

function fieldForShape(text: string, role: SlideRole): SemanticField {
  const value = normalizedText(text);
  const slot = hasValueSlot(value);

  const fieldLabelCount = (value.match(/(?:nama|usia|umur|jenis kelamin|gender|sex|no\.?\s*rm|tanggal lahir|alamat|keluhan utama|rps|rpd|alergi|diagnosis|obat|tekanan darah|suhu|saturasi)\s*[:：]/g) || []).length;
  if (role === "unknown" || value.length > 160 || fieldLabelCount > 1 || /^kesan\s*[:：]/.test(value)) return "static";

  if (/(tanggal|hari\s*,?\s*tanggal)/.test(value) && (role === "cover" || slot)) return "shift.date";
  if (/fasilitator/.test(value) && (role === "cover" || slot)) return "shift.facilitator";
  if (/dpjp/.test(value) && (role === "cover" || slot)) return "shift.dpjp";
  if (/(mahasiswa|tim mahasiswa|penyaji)/.test(value) && (role === "cover" || slot)) return "shift.team";
  if (/(departemen|bagian|spesialis)/.test(value) && slot) return "shift.department";
  if (/(rumah sakit|rs\s)/.test(value) && slot) return "shift.hospital";

  if (!slot) return "static";

  if (/(nama\b|pasien)/.test(value) && role === "patient_identity") return "patient.identifiers.name";
  if (/(inisial)/.test(value)) return "patient.identifiers.initials";
  if (/(no\.?\s*rm|medical record|rekam medis)/.test(value)) return "patient.identifiers.medicalRecordNumber";
  if (/(jenis kelamin|gender|sex)/.test(value)) return "patient.demographics.sex";
  if (/(usia|umur|age)/.test(value)) return "patient.demographics.age";
  if (/(berat badan|\bbb\b|weight)/.test(value)) return "patient.demographics.weightKg";
  if (/(tinggi badan|\btb\b|height)/.test(value)) return "patient.demographics.heightCm";
  if (/(jam datang|arrival|waktu masuk)/.test(value)) return "patient.admission.arrivalTime";
  if (/(tanggal masuk|admission)/.test(value)) return "patient.admission.admissionDate";
  if (/(rujukan|asal rujukan)/.test(value)) return "patient.admission.referralSource";
  if (/(keluhan utama|chief complaint)/.test(value)) return "patient.chiefComplaint";
  if (/(riwayat penyakit sekarang|\brps\b|present illness)/.test(value)) return "patient.history.presentIllness";
  if (/(riwayat penyakit dahulu|\brpd\b|past medical)/.test(value)) return "patient.history.pastMedicalHistory";
  if (/(riwayat obat|obat sebelumnya|medication history)/.test(value)) return "patient.history.medicationHistory";
  if (/(alergi|allergy)/.test(value)) return "patient.history.allergyHistory";
  if (/(riwayat lahir|kelahiran|birth history)/.test(value)) return "patient.history.birthHistory";
  if (/(imunisasi|immunization)/.test(value)) return "patient.history.immunizationHistory";
  if (/(riwayat keluarga|family history)/.test(value)) return "patient.history.familyHistory";
  if (/(keadaan umum|general appearance)/.test(value)) return "patient.physicalExam.generalAppearance";
  if (/(kesadaran|consciousness|gcs)/.test(value)) return "patient.physicalExam.consciousness";
  if (/(tekanan darah|\btd\b|blood pressure)/.test(value)) return "patient.physicalExam.vitalSigns.bloodPressure";
  if (/(denyut jantung|frekuensi nadi|\bnadi\b|\bhr\b|heart rate)/.test(value)) {
    return "patient.physicalExam.vitalSigns.heartRate";
  }
  if (/(laju napas|frekuensi napas|\brr\b|respiratory rate)/.test(value)) {
    return "patient.physicalExam.vitalSigns.respiratoryRate";
  }
  if (/(suhu|temperature)/.test(value)) return "patient.physicalExam.vitalSigns.temperature";
  if (/(saturasi|\bspo2\b|oksigenasi)/.test(value)) return "patient.physicalExam.vitalSigns.spo2";
  if (/(pemeriksaan fisis|pemeriksaan fisik|temuan|findings)/.test(value)) {
    return "patient.physicalExam.findings";
  }
  if (/(laboratorium|lab work|hasil lab)/.test(value)) return "patient.investigations.laboratory";
  if (/(radiologi|usg|imaging)/.test(value)) return "patient.investigations.imaging";
  if (/(diagnosis kerja|working diagnosis|diagnosis)/.test(value)) return "patient.assessment.workingDiagnosis";
  if (/(diagnosis banding|differential)/.test(value)) return "patient.assessment.differentialDiagnosis";
  if (/(obat|medikamentosa|medications)/.test(value)) return "patient.management.medications";
  if (/(cairan|fluids)/.test(value)) return "patient.management.fluids";
  if (/(prosedur|tindakan|procedures)/.test(value)) return "patient.management.procedures";
  if (/(oksigen|oxygen therapy)/.test(value)) return "patient.management.oxygenTherapy";
  if (/(disposisi|rawat|pulang|disposition)/.test(value)) return "patient.disposition";

  return "static";
}

function overlapsHorizontally(left: ParsedShape, right: ParsedShape): boolean {
  if (left.x === undefined || left.width === undefined || right.x === undefined || right.width === undefined) return true;
  return left.x < right.x + right.width && right.x < left.x + left.width;
}

function nearestHeading(slide: ParsedSlide, shape: ParsedShape): string {
  if (shape.y === undefined) return "";
  const shapeY = shape.y;
  return slide.shapes
    .filter((candidate) => candidate.id !== shape.id && candidate.y !== undefined && candidate.y <= shapeY && overlapsHorizontally(candidate, shape))
    .filter((candidate) => candidate.text.length < 90 && /(riwayat|nutrisi|sosio|kehamilan|kelahiran|imunisasi|penyakit keluarga)/i.test(candidate.text))
    .sort((left, right) => (right.y ?? 0) - (left.y ?? 0))[0]?.text ?? "";
}

function historyFieldForHeading(heading: string): SemanticField {
  const value = normalizedText(heading);
  if (/penyakit sekarang/.test(value)) return "patient.history.presentIllness";
  if (/penyakit dahulu/.test(value)) return "patient.history.pastMedicalHistory";
  if (/keluarga/.test(value)) return "patient.history.familyHistory";
  if (/(kehamilan|kelahiran|persalinan)/.test(value)) return "patient.history.birthHistory";
  if (/imunisasi/.test(value)) return "patient.history.immunizationHistory";
  if (/nutrisi/.test(value)) return "patient.history.nutritionHistory";
  if (/sosio/.test(value)) return "patient.history.socioeconomicHistory";
  return "static";
}

type BindingTarget = { semanticField: SemanticField; templateKey?: string };

function target(semanticField: SemanticField, templateKey?: string): BindingTarget {
  return { semanticField, templateKey };
}

function profileBindingForSlide(slide: ParsedSlide, shape: ParsedShape, profileId: TemplateProfileId, total = 0): BindingTarget | undefined {
  const text = normalizedText(shape.text);
  const index = slide.index;
  const empty = !shape.text && shape.kind === "text" && !shape.placeholderType?.match(/title|ctrTitle/i);
  const isTitle = shape.placeholderType === "title" || shape.placeholderType === "ctrTitle" || shape.text === slide.title;
  const isNewIgdProfile = profileId === "igd-harkit" || profileId === "igd-rsut";
  const isCurrentIgdHarkit = profileId === "igd-harkit" && total === 21;
  const isCurrentRsui = profileId === "rsui" && total === 21;

  if (profileId === "lapjag") {
    const body = shape.kind === "text" && !isTitle && shape.text.trim().length > 8;
    const leftSide = (shape.x ?? 0) < 4.8;
    if (index === 0) {
      if (!isTitle && /tim mahasiswa|tim jaga/.test(text) && /fasilitator/.test(text) && /dpjp/.test(text)) return target("shift.coverBlock");
      if (!isTitle && /fasilitator/.test(text)) return target("shift.facilitator");
      if (!isTitle && /dpjp/.test(text)) return target("shift.dpjp");
      if (!isTitle && /mahasiswa|tim jaga/.test(text)) return target("shift.team");
    }
    if (index === 1 && shape.kind === "graphicFrame") return target("shift.patientSummaryTable");
    if (index === 2) {
      if (shape.kind === "graphicFrame") return target("patient.identityBlock");
      if (body && /keluhan utama|chief complaint/.test(text)) return target("patient.chiefComplaint");
    }
    if (index === 3) {
      if (/^kesan\s*[:：]/.test(text)) return target("patient.assessment.summary");
      if (body) return target(leftSide ? "patient.pediatricAssessment.leftBlock" : "patient.pediatricAssessment.rightBlock");
    }
    if (index === 4) {
      if (/^kesan\s*[:：]/.test(text)) return target("patient.assessment.summary");
      if (body) return target("patient.primarySurveyBlock");
    }
    if (index === 5) {
      if (/^kesan\s*[:：]/.test(text)) return target("patient.assessment.summary");
      if (body) return target("patient.secondarySurveyBlock");
    }
    if (index === 6 && body) return target("patient.history.presentIllness");
    if ((index === 7 || index === 8) && body) {
      const semanticField = bodyBindingForSlide(slide, shape);
      return semanticField === "static" ? undefined : target(semanticField);
    }
    if (index === 9) {
      if (/^kesan\s*[:：]/.test(text)) return target("patient.templateSection", "nutritionConclusion");
      if (body) return target("patient.anthropometryBlock");
    }
    if (index >= 10 && index <= 12) return undefined;
    if (index === 13) {
      if (/^kesan\s*[:：]/.test(text)) return target("patient.assessment.summary");
      if (/^kesadaran\b|gcs/.test(text)) return target("patient.physicalExam.generalAppearanceBlock");
      if (/tekanan darah|laju nadi|laju napas|suhu|spo2/.test(text)) return target("patient.physicalExam.vitalSignsBlock");
    }
    if (index === 14) {
      if (shape.kind === "graphicFrame") return target("patient.physicalExam.organFindings");
      if (body) return target("patient.physicalExamBlock");
    }
    if (index === 15 && body) return target("patient.templateSection", "initialDiagnosis");
    if (index === 16) {
      if (shape.kind === "graphicFrame") return target("patient.managementTable");
      if (body) return target(leftSide ? "patient.templateSection" : "patient.timelineBlock", leftSide ? "initialManagement" : undefined);
    }
    if (index === 17) {
      if (shape.kind === "graphicFrame") return target("patient.templateSection", "bloodGasTable");
      if (body) return target("patient.investigations.summary");
    }
    if (index === 18) return undefined;
    if (index === 19 || index === 20) {
      if (shape.kind === "graphicFrame") return target("patient.investigations.laboratory");
      if (/^kesan\s*[:：]/.test(text)) return target("patient.investigations.summary");
    }
    if (index === 21 && body) return target("patient.investigations.imaging");
    if (index === 22 && body) return target("patient.templateSection", "finalDiagnosis");
    if (index === 23) {
      if (shape.kind === "graphicFrame") return target("patient.managementTable", "finalManagement");
      if (body) return target("patient.templateSection", "finalManagement");
    }
    if ((index === 24 || index === 25) && body) return target("patient.nutritionBlock");
    return undefined;
  }

  if (profileId === "perina-lapjag" || profileId === "perina-harkit" || profileId === "perina-rsut" || profileId === "perina-rsab") {
    if (index === 0 && !isTitle && /mahasiswa/.test(text) && /dpjp/.test(text)) return target("shift.coverBlock");
    if (index === 0 && !isTitle && /mahasiswa/.test(text)) return target("shift.student");
    if (index === 0 && !isTitle && /tim jaga perinatologi/.test(text)) return target("shift.perinaTeam");
    if (index === 0 && !isTitle && /dpjp/.test(text)) return target("shift.dpjp");
    if (index === 1 && shape.kind === "graphicFrame") return target("patient.identityBlock");
    if (index === 1 && /keluhan utama/.test(text)) return target("patient.chiefComplaint");
    if (index === 2 && /konsultasi antenatal|usg fetomaternal/.test(text)) return undefined;
    if (index === 2 && empty && shape.y !== undefined && shape.y > 3.5) return target("patient.templateSection", "fetomaternalUltrasound");
    if (index === 2 && empty && shape.y !== undefined && shape.y > 0.15) return target("patient.templateSection", "antenatalConsultation");
    if (index === 3 && /riwayat persalinan sebelumnya|riwayat penyakit dahulu|riwayat penyakit keluarga/.test(text)) return undefined;
    if (index === 3 && (empty || text === ".") && shape.y !== undefined && shape.y >= 3.07) return target("patient.history.familyHistory");
    if (index === 3 && (empty || text === ".") && shape.y !== undefined && shape.y >= 1.55 && shape.y < 2.6) return target("patient.history.pastMedicalHistory");
    if (index === 3 && (empty || text === ".") && shape.y !== undefined && shape.y >= 0.05 && shape.y < 1.1) return target("patient.templateSection", "previousDeliveries");
    if (index === 4 && /persiapan pertolongan persalinan/.test(text)) return undefined;
    if (index === 4 && empty && shape.y !== undefined && shape.y > 0.2) return target("patient.templateSection", "deliveryPreparation");
    if (index === 5 && /bayi lahir secara/.test(text)) return target("patient.templateSection", "neonatalBirthProcess");
    if (index === 5 && shape.kind === "graphicFrame") return target("patient.templateSection", "resuscitationTimeline");
    if (index === 6 && /kesan/.test(text)) return target("patient.templateSection", "stableConclusion");
    if (index === 6 && /safe care|temperature|airway|blood pressure|lab works|emotional support/.test(text)) return target("patient.templateSection", "stableStabilization");
    if (index === 7 && /bb\s*:|ballard/.test(text)) return target("patient.anthropometryBlock");
    if (index === 7 && /^kesan/.test(text)) return target("patient.templateSection", "neonatalAnthropometryConclusion");
    if (index === 8 && /keadaan umum|tanda vital/.test(text)) return undefined;
    if (index === 8 && /denyut jantung|laju napas|suhu|saturasi/.test(text)) return target("patient.templateSection", "neonatalVitals");
    if (index === 8 && empty && shape.y !== undefined && shape.y > 0.2 && shape.y < 1.8) return target("patient.physicalExam.generalAppearance");
    if (index === 9 && shape.kind === "graphicFrame") return target("patient.physicalExam.organFindings");
    if (index === 10 && !isTitle && (empty || /icd/.test(text))) return target("patient.templateSection", "initialDiagnosis");
    if (index === 11 && shape.kind === "graphicFrame") return target("patient.investigations.laboratory");
    if (index === 11 && /^kesan/.test(text)) return target("patient.investigations.summary");
    if (index === 12 && empty) return target("patient.investigations.imaging");
    if (index === 13 && /termoregulasi|oksigenasi|nutrisi|atasi infeksi|pemantauan/.test(text)) return target("patient.templateSection", "neonatalManagement");
    return undefined;
  }

  if (isCurrentIgdHarkit) {
    if (index === 0 && shape.kind === "text" && !isTitle && /nama mahasiswa/.test(text) && /fasilitator/.test(text)) return target("shift.coverBlock");
    if (index === 1 && shape.kind === "graphicFrame") return target("shift.patientSummaryTable");
    if (index === 2 && shape.id === "65") return target("patient.identityBlock");
    if (index === 3) {
      if (shape.id === "68" || shape.id === "99") return target("patient.pediatricAssessment.leftBlock");
      if (shape.id === "69" || shape.id === "98") return target("patient.pediatricAssessment.rightBlock");
      if (shape.id === "70" || shape.id === "97") return target("patient.assessment.summary");
    }
    if (index === 4) {
      if (shape.id === "77") return target("patient.templateSection", "primarySurveyLeft");
      if (shape.id === "78") return target("patient.templateSection", "primarySurveyRight");
      if (shape.id === "79") return target("patient.assessment.summary");
    }
    if (index === 5) {
      if (shape.id === "86") return target("patient.templateSection", "primarySurveyContinuationLeft");
      if (shape.id === "87") return target("patient.templateSection", "primarySurveyContinuationRight");
      if (shape.id === "88") return target("patient.assessment.summary");
    }
    if (index === 6) {
      if (shape.id === "99") return target("patient.pediatricAssessment.leftBlock");
      if (shape.id === "98") return target("patient.pediatricAssessment.rightBlock");
      if (shape.id === "97") return target("patient.assessment.summary");
    }
    if (index === 7 && shape.id === "104") return target("patient.secondarySurveyBlock");
    if ((index === 8 && shape.id === "113") || (index === 9 && shape.id === "119")) return target("patient.history.presentIllness");
    if (index === 10) {
      if (shape.id === "122") return target("patient.history.pastMedicalHistory");
      if (shape.id === "123") return target("patient.history.familyHistory");
    }
    if (index === 11) {
      if (shape.id === "132") return target("patient.templateSection", "pregnancyBirth");
      if (shape.id === "133") return target("patient.history.immunizationHistory");
    }
    if (index === 12) {
      if (shape.id === "136") return target("patient.history.nutritionHistory");
      if (shape.id === "137") return target("patient.templateSection", "growthDevelopment");
    }
    if (index === 13) {
      if (shape.id === "142") return target("patient.templateSection", "anthropometryMeasurements");
      if (shape.id === "143") return target("patient.templateSection", "anthropometryAssessment");
    }
    if (index === 14 && shape.id === "147") return target("patient.physicalExamBlock");
    if (index === 15 && shape.id === "153") return target("patient.physicalExam.organFindings");
    if (index === 16) {
      if (shape.id === "154") return target("patient.investigations.summary");
      if (shape.id === "155") return target("patient.investigations.laboratory");
    }
    if (index === 17 && shape.id === "159") return target("patient.assessment.workingDiagnosis");
    if (index === 18 && shape.id === "164") return target("patient.templateSection", "managementPart1");
    if (index === 19 && shape.id === "170") return target("patient.templateSection", "monitoringPlan");
    return undefined;
  }

  if (profileId === "rscm" || isNewIgdProfile) {
    if (index === 0 && !isTitle && /tim mahasiswa/.test(text) && (isNewIgdProfile ? /fasilitator/.test(text) : /tim ppds/.test(text)) && /dpjp/.test(text)) return target("shift.coverBlock");
    if (index === 0 && !isTitle && /tim mahasiswa/.test(text)) return target("shift.team");
    if (index === 0 && !isTitle && isNewIgdProfile && /fasilitator/.test(text)) return target("shift.facilitator");
    if (index === 0 && !isTitle && !isNewIgdProfile && /tim ppds/.test(text)) return target("shift.ppds");
    if (index === 0 && !isTitle && /dpjp/.test(text)) return target("shift.dpjp");
    if (index === 1 && shape.kind === "graphicFrame") return target("shift.patientSummaryTable");
    if (index === 2 && /nama|usia|tanggal lahir|jenis kelamin|nrm|alamat/.test(text) && !/keluhan/.test(text)) return target("patient.identityBlock");
    if (index === 2 && /keluhan utama/.test(text)) return target("patient.chiefComplaint");
    if (index === 3 && /^kesan/.test(text)) return target("patient.assessment.summary");
    if (index === 3 && !isTitle) return target("patient.pediatricAssessmentBlock");
    if (index === 4 && /^kesan/.test(text)) return target("patient.assessment.summary");
    if (index === 4 && !isTitle) return target("patient.primarySurveyBlock");
    if (index === 5 && !isTitle) return target("patient.secondarySurveyBlock");
    if (index === 6 && /riwayat penyakit dahulu|riwayat penyakit keluarga|kehamilan|kelahiran/.test(text)) return undefined;
    if (index === 6 && (empty || text === ".") && shape.y !== undefined && shape.y >= (isNewIgdProfile ? 3.5 : 5.4)) return target("patient.templateSection", "pregnancyBirth");
    if (index === 6 && (empty || text === ".") && shape.y !== undefined && shape.y >= (isNewIgdProfile ? 1.7 : 2.9) && shape.y < (isNewIgdProfile ? 3.3 : 4.5)) return target("patient.history.familyHistory");
    if (index === 6 && (empty || text === ".") && shape.y !== undefined && shape.y >= 0.2 && shape.y < 2.0) return target("patient.history.pastMedicalHistory");
    if (index === 7 && /imunisasi|nutrisi|sosioekonomi/.test(text)) return undefined;
    if (index === 7 && (empty || text === ".") && shape.y !== undefined && shape.y >= (isNewIgdProfile ? 3.5 : 5.0)) return target("patient.history.socioeconomicHistory");
    if (index === 7 && (empty || text === ".") && shape.y !== undefined && shape.y >= (isNewIgdProfile ? 1.7 : 2.7) && shape.y < (isNewIgdProfile ? 3.3 : 4.2)) return target("patient.history.nutritionHistory");
    if (index === 7 && (empty || text === ".") && shape.y !== undefined && shape.y >= 0.2 && shape.y < 2.0) return target("patient.history.immunizationHistory");
    if (index === 8 && /^kesan/.test(text)) return target("patient.templateSection", "nutritionConclusion");
    if (index === 8 && !isTitle) return target("patient.anthropometryBlock");
    if (index === 9 && /keadaan umum/.test(text)) return undefined;
    if (index === 9 && /kesadaran/.test(text)) return target("patient.physicalExam.generalAppearanceBlock");
    if (index === 9 && /tekanan darah|laju nadi|laju napas|suhu|spo2/.test(text)) return target("patient.physicalExam.vitalSignsBlock");
    if (index === 10 && shape.kind === "graphicFrame") return target("patient.physicalExam.organFindings");
    if (index === 11 && !isTitle) return target("patient.templateSection", "initialDiagnosis");
    if (index === 12 && !isTitle) return target("patient.templateSection", "initialManagement");
    if (index === 13 && !isTitle) return target("patient.templateSection", "supportingInvestigations");
    if (index === 14 && !isTitle) return target("patient.templateSection", "finalDiagnosis");
    if (index === 15 && !isTitle) return target("patient.templateSection", "finalManagement");
    return undefined;
  }

  if (profileId === "rsui") {
    if (isCurrentRsui) {
      if (index === 0 && shape.id === "18") return target("shift.coverBlock");
      if (index === 1 && shape.id === "21" && shape.kind === "graphicFrame") return target("shift.patientSummaryTable");
      if (index === 2) {
        if (shape.id === "22") return target("patient.identityBlock");
        if (shape.id === "24") return target("patient.chiefComplaint");
      }
      if (index === 3) {
        if (shape.id === "25") return target("patient.pediatricAssessment.leftBlock");
        if (shape.id === "26") return target("patient.pediatricAssessment.rightBlock");
        if (shape.id === "28") return target("patient.assessment.summary");
      }
      if (index === 4 && shape.id === "31") return target("patient.primarySurveyBlock");
      if (index === 5 && shape.id === "33") return target("patient.secondarySurveyBlock");
      if (index === 6 && shape.id === "35") return target("patient.history.presentIllness");
      if (index === 7) {
        if (shape.id === "37") return target("patient.history.pastMedicalHistory");
        if (shape.id === "39") return target("patient.history.familyHistory");
      }
      if (index === 8) {
        if (shape.id === "40") return target("patient.history.birthHistory");
        if (shape.id === "41") return target("patient.history.immunizationHistory");
        if (shape.id === "43") return target("patient.history.socioeconomicHistory");
      }
      if (index === 9) {
        if (shape.id === "44") return target("patient.history.nutritionHistory");
        if (shape.id === "45") return target("patient.templateSection", "growthDevelopment");
      }
      if (index === 10) {
        if (shape.id === "47") return target("patient.templateSection", "anthropometryAssessment");
        if (shape.id === "49") return target("patient.templateSection", "nutritionConclusion");
      }
      if (index === 11) {
        if (shape.id === "51") return target("patient.physicalExam.generalAppearanceBlock");
        if (shape.id === "52") return target("patient.physicalExam.vitalSignsBlock");
      }
      if (index === 12 && shape.id === "54") return target("patient.physicalExam.organFindings");
      if (index === 13) {
        if (shape.id === "57") return target("patient.investigations.summary");
        if (shape.id === "58" || shape.id === "59") return target("patient.investigations.laboratory");
      }
      if (index === 14 && shape.id === "61") return target("patient.templateSection", "finalDiagnosis");
      if (index === 15 && shape.id === "63") return target("patient.templateSection", "managementPart1");
      if (index === 16 && shape.id === "65") return target("patient.templateSection", "managementPart2");
      if (index === 17 && shape.id === "67") return target("patient.templateSection", "managementPart3");
      if (index === 18 && shape.id === "69") return target("patient.templateSection", "diagnosticPlan");
      if (index === 19 && shape.id === "71") return target("patient.templateSection", "monitoringPlan");
      return undefined;
    }
    if (index === 0 && !isTitle && /nama penyaji/.test(text)) return target("shift.presenter");
    if (index === 1 && /nama:|usia:|jenis kelamin|nomor rm|tempat tinggal/.test(text)) return target("patient.identityBlock");
    if (index === 1 && /keluhan utama/.test(text)) return target("patient.chiefComplaint");
    if (index === 2 && /^kesan/.test(text)) return target("patient.assessment.summary");
    if (index === 2 && /tampilan|tonus|interaksi|kenyamanan|kontak mata|suara/.test(text)) return target("patient.pediatricAssessment.leftBlock");
    if (index === 2 && /upaya napas|sirkulasi|cuping|sianosis|pucat|kutis/.test(text)) return target("patient.pediatricAssessment.rightBlock");
    if (index === 3 && /kesimpulan/.test(text)) return target("patient.assessment.summary");
    if (index === 3 && !isTitle) return target("patient.primarySurveyBlock");
    if (index === 4 && !isTitle) return target("patient.templateSection", "emergencyManagement");
    if (index === 5 && !isTitle) return target("patient.history.presentIllness");
    if (index === 6 && /penyakit dahulu/.test(text)) return target("patient.history.pastMedicalHistory");
    if (index === 6 && /penyakit keluarga/.test(text)) return target("patient.history.familyHistory");
    if (index === 7 && /kehamilan|persalinan/.test(text)) return target("patient.templateSection", "pregnancyBirth");
    if (index === 7 && /imunisasi/.test(text)) return target("patient.history.immunizationHistory");
    if (index === 8 && /nutrisi/.test(text)) return target("patient.history.nutritionHistory");
    if (index === 8 && /tumbuh kembang/.test(text)) return target("patient.templateSection", "growthDevelopment");
    if (index === 9 && /^kesimpulan/.test(text)) return target("patient.templateSection", "nutritionConclusion");
    if (index === 9 && !isTitle) return target("patient.anthropometryBlock");
    if (index === 10 && !isTitle) return target("patient.physicalExamBlock");
    if (index === 11 && shape.kind === "graphicFrame") return target("patient.physicalExam.organFindings");
    if (index === 12 && !isTitle) return target("patient.assessment.workingDiagnosis");
    if (index === 13 && shape.kind === "graphicFrame" && shape.x !== undefined && shape.x < 4) return target("patient.investigations.laboratory");
    if (index === 13 && shape.kind === "graphicFrame") return target("patient.templateSection", "bloodGasTable");
    if (index === 13 && /kesimpulan/.test(text)) return target("patient.investigations.summary");
    if (index === 14 && /radiologi/.test(text)) return target("patient.templateSection", "radiology");
    if (index === 14 && /interpretasi/.test(text)) return target("patient.templateSection", "radiologyInterpretation");
    if (index === 15 && !isTitle) return target("patient.templateSection", "otherExaminations");
    if (index === 16 && !isTitle) return target("patient.templateSection", "finalDiagnosis");
    if (index === 17 && !isTitle) return target("patient.templateSection", "finalManagement");
    return undefined;
  }
  return undefined;
}

function bodyBindingForSlide(slide: ParsedSlide, shape: ParsedShape): SemanticField {
  const text = normalizedText(shape.text);
  const slideText = normalizedText(slide.text);
  const isTitle = shape.placeholderType === "title" || shape.placeholderType === "ctrTitle" || shape.text === slide.title;
  if (isTitle) return "static";

  if (shape.kind === "graphicFrame") {
    if (slide.role === "shift_summary") return "shift.patientSummaryTable";
    if (slide.role === "patient_identity") return "patient.identityBlock";
    if (slide.role === "physical_exam" && /organ|deskripsi/.test(text)) return "patient.physicalExam.organFindings";
    if (slide.role === "investigation" && /radiologi|foto toraks|imaging|usg/.test(slideText)) return "patient.investigations.imaging";
    if (slide.role === "investigation" && /pemeriksaan|hasil|reference|rujukan/.test(text)) return "patient.investigations.laboratory";
    if (slide.role === "management" && /diagnosis|masalah|target|tindakan/.test(text)) return "patient.managementTable";
    return "static";
  }

  if (slide.role === "cover") {
    const combinedCoverBlock = /tim mahasiswa/.test(text) && /fasilitator/.test(text) && /dpjp/.test(text);
    if (!combinedCoverBlock && /fasilitator/.test(text)) return "shift.facilitator";
    if (!combinedCoverBlock && /dpjp/.test(text)) return "shift.dpjp";
    if (!combinedCoverBlock && /tim mahasiswa|penyaji/.test(text)) return "shift.team";
    return /tim mahasiswa|fasilitator|dpjp|penyaji/.test(text) ? "shift.coverBlock" : "static";
  }
  if (slide.role === "patient_identity") {
    if (/keluhan utama|chief complaint/.test(text) && text.length < 160) return "patient.chiefComplaint";
    if (/nama\s*[:：]/.test(text) || shape.placeholderType === "body" || text.length > 80) return "patient.identityBlock";
  }
  if (slide.role === "anamnesis") {
    if (/keluhan utama/.test(text) && text.length < 160) return "patient.chiefComplaint";
    if (text.length > 20) return "patient.history.presentIllness";
  }
  if (slide.role === "history") {
    if (/^(riwayat|riwayat penyakit|sosio)/.test(text) && text.length < 90) return "static";
    const headingField = historyFieldForHeading(nearestHeading(slide, shape));
    if (headingField !== "static" && text.length > 3) return headingField;
    return "static";
  }
  if (slide.role === "pediatric_assessment") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.assessment.summary";
    if (/behaviour|behavoir|tonus|consolability|look or gaze|interactiveness/.test(text)) return "patient.pediatricAssessment.leftBlock";
    if (/breathing|speech and cry|body colour|body color|retraksi|cuping hidung/.test(text)) return "patient.pediatricAssessment.rightBlock";
    if (text.length > 20) return "patient.pediatricAssessmentBlock";
  }
  if (slide.role === "primary_survey") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.assessment.summary";
    if (text.length > 20) return "patient.primarySurveyBlock";
  }
  if (slide.role === "secondary_survey") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.assessment.summary";
    if (text.length > 20) return "patient.secondarySurveyBlock";
  }
  if (slide.role === "anthropometry") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.templateSection";
    if (text.length > 20) return "patient.anthropometryBlock";
  }
  if (slide.role === "physical_exam") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.assessment.summary";
    if (text.length > 20) return "patient.physicalExamBlock";
  }
  if (slide.role === "investigation") {
    if (/^kesan\s*[:：]/.test(text)) return "patient.investigations.summary";
    if (/radiologi|imaging|usg/.test(slideText) && text.length > 3) return "patient.investigations.imaging";
    if (text.length > 20) return "patient.investigationsBlock";
  }
  if (slide.role === "diagnosis") {
    if (text.length > 20) return /(?:akhir|final)/.test(text) ? "patient.templateSection" : "patient.assessmentBlock";
  }
  if (slide.role === "management") {
    if (/(?:gizi|nutrisi)/.test(slideText) && text.length > 20) return "patient.nutritionBlock";
    if (/(?:akhir|final)/.test(slideText) && text.length > 20) return "patient.managementBlock";
    if (text.length > 20) {
      const bodyShapes = slide.shapes.filter((item) => item.kind === "text" && item.placeholderType !== "title" && item.text.length > 20).sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
      return bodyShapes[0]?.id === shape.id ? "patient.managementBlock" : "patient.timelineBlock";
    }
  }
  return fieldForShape(shape.text, slide.role);
}

function autoBindings(slides: ParsedSlide[], profileId: TemplateProfileId): TemplateBinding[] {
  const bindings: TemplateBinding[] = [];
  const usesCurrent21SlideContract = slides.length === 21 && (profileId === "igd-harkit" || profileId === "rsui");
  slides.forEach((slide) => {
    slide.shapes.forEach((shape) => {
      const profileTarget = profileBindingForSlide(slide, shape, profileId, slides.length);
      if (!shape.text && !profileTarget) return;
      const semanticField = profileTarget?.semanticField ?? (usesCurrent21SlideContract ? "static" : bodyBindingForSlide(slide, shape));
      if (semanticField === "static") return;
      bindings.push({
        slideIndex: slide.index,
        shapeId: shape.id,
        semanticField,
        templateKey: profileTarget?.templateKey,
        confidence: semanticField.includes("Block") || semanticField.includes("Table") || semanticField.endsWith("summary") ? 0.96 : 0.91,
        source: "auto",
      });
    });
  });
  const unique = new Map<string, TemplateBinding>();
  bindings.forEach((binding) => {
    const key = `${binding.slideIndex}:${binding.shapeId}`;
    if (!unique.has(key) || binding.source === "user") unique.set(key, binding);
  });
  const provisional = Array.from(unique.values());
  const grouped = new Map<string, TemplateBinding[]>();
  provisional.forEach((binding) => {
    // A custom section may intentionally have more than one independently
    // editable slot (for example two neonatal panels). Every other semantic
    // fact gets exactly one target per slide so the same block cannot be
    // written into multiple boxes.
    const evidencePictureSlot = ["patient.investigations.imaging", "patient.investigations.laboratory"].includes(binding.semanticField)
      && slides.find((slide) => slide.index === binding.slideIndex)?.shapes.some((shape) => shape.id === binding.shapeId && shape.kind === "picture");
    if (binding.semanticField === "patient.templateSection" || evidencePictureSlot) return;
    const key = `${binding.slideIndex}:${binding.semanticField}`;
    grouped.set(key, [...(grouped.get(key) || []), binding]);
  });
  const discarded = new Set<string>();
  grouped.forEach((candidates) => {
    if (candidates.length < 2) return;
    const slide = slides.find((item) => item.index === candidates[0]?.slideIndex);
    const ranked = candidates
      .map((binding) => {
        const shape = slide?.shapes.find((item) => item.id === binding.shapeId);
        const area = (shape?.width || 0) * (shape?.height || 0);
        const bodyBonus = shape?.placeholderType && /body|content/i.test(shape.placeholderType) ? 10_000_000 : 0;
        const textBonus = Math.min(1_000_000, shape?.text.length || 0);
        return { binding, score: bodyBonus + area + textBonus };
      })
      .sort((left, right) => right.score - left.score);
    ranked.slice(1).forEach(({ binding }) => discarded.add(`${binding.slideIndex}:${binding.shapeId}`));
  });
  return provisional.filter((binding) => !discarded.has(`${binding.slideIndex}:${binding.shapeId}`));
}

function parseRelationships(xml: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = readAttribute(tag, "Id");
    const target = readAttribute(tag, "Target");
    if (id && target) {
      result.set(id, target.replace(/^\//, "").replace(/^ppt\//, "ppt/"));
    }
  }
  return result;
}

function slideRefs(xml: string): Array<{ id: string; relationshipId: string }> {
  return Array.from(xml.matchAll(/<p:sldId\b[^>]*>/g)).map((match) => ({
    id: readAttribute(match[0], "id") ?? "",
    relationshipId: readAttribute(match[0], "r:id") ?? readAttribute(match[0], "id") ?? "",
  }));
}

function displayTitle(text: string, index: number): string {
  const firstLine = text
    .split(/\r?\n|(?=\s{2,})/)
    .map((line) => line.trim())
    .find((line) => line.length > 2);
  return (firstLine || `Slide ${index + 1}`).slice(0, 72);
}

function sourceToArrayBuffer(source: File | ArrayBuffer): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return Promise.resolve(source);
  return source.arrayBuffer();
}

export async function parsePptx(source: File | ArrayBuffer, fileName = "template.pptx", profileOverride?: TemplateProfileId): Promise<ParsedTemplate> {
  const raw = await sourceToArrayBuffer(source);
  const zip = await JSZip.loadAsync(raw);
  const presentationXml = (await zip.file("ppt/presentation.xml")?.async("string")) ?? "";
  const presentationRels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) ?? "";
  const relationships = parseRelationships(presentationRels);
  const refs = slideRefs(presentationXml);
  const slideFiles = Object.keys(zip.files)
    .filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file))
    .sort((left, right) => {
      const leftIndex = Number(left.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      const rightIndex = Number(right.match(/slide(\d+)\.xml/)?.[1] ?? 0);
      return leftIndex - rightIndex;
    });
  const ordered = refs.length
    ? refs
        .map((ref) => ({
          relationshipId: ref.relationshipId,
          fileName: relationships.get(ref.relationshipId),
        }))
        .filter((ref): ref is { relationshipId: string; fileName: string } => Boolean(ref.fileName))
    : slideFiles.map((fileName, index) => ({ relationshipId: `rId-slide-${index + 1}`, fileName }));
  const profileId = profileOverride ?? templateProfileIdForFile(fileName, ordered.length);

  const slides: ParsedSlide[] = [];
  for (const [index, item] of ordered.entries()) {
    const normalizedFileName = item.fileName.startsWith("ppt/") ? item.fileName : `ppt/${item.fileName}`;
    const xml = (await zip.file(normalizedFileName)?.async("string")) ?? "";
    const text = textRuns(xml).join(" ").replace(/\s+/g, " ").trim();
    const speakerNotes = await readSpeakerNotes(zip, normalizedFileName);
    const role = roleForSlide(text, index, ordered.length, fileName, profileId);
    // Speaker notes contain workflow instructions (for example “if applicable”)
    // and must not make an otherwise routine clinical slide optional. Inclusion
    // is inferred from the visible slide content; an agent/profile may refine
    // it later using the full template context and notes.
    const inclusion = inferSlideInclusion(text, role, index, profileId);
    const repeat = inclusion.inclusion === "routine" && index > 0 && index < ordered.length - 1;
    slides.push({
      index,
      fileName: normalizedFileName,
      relationshipId: item.relationshipId,
      title: profileId === "lapjag" && [10, 11, 12].includes(index)
        ? ["WHO length/height-for-age", "WHO weight-for-age", "WHO weight-for-length"][index - 10]
        : displayTitle(text, index),
      text,
      role,
      repeat,
      patientScope: inferPatientScope(role, repeat),
      speakerNotes,
      shapes: parseShapes(xml),
      inclusion: inclusion.inclusion,
      include: inclusion.include,
      inclusionReason: inclusion.reason,
    });
  }

  slides.forEach((slide) => {
    slide.repeat = slide.inclusion === "routine"
      && slide.include !== false
      && slide.index > 0
      && slide.index < slides.length - 1
      && slide.role !== "shift_summary";
    slide.patientScope = inferPatientScope(slide.role, slide.repeat);
  });
  const bindings = autoBindings(slides, profileId);

  return {
    id: `template-${Date.now()}`,
    name: fileName.replace(/\.pptx$/i, ""),
    fileName,
    slideCount: slides.length,
    slides,
    bindings,
    raw,
    profileId,
    analysisStatus: "needs_review",
  };
}

export function shapeSummary(shape: ParsedShape): string {
  const position = [shape.x, shape.y, shape.width, shape.height]
    .filter((value) => value !== undefined)
    .map((value) => `${value}in`)
    .join(" · ");
  return `${shape.name || shape.id}${position ? ` · ${position}` : ""}`;
}
