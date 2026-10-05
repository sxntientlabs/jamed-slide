import type { ParsedTemplate, PatientRecord } from "../types";
import { parsePptx } from "./pptxParser";
import { slideIsIncluded } from "./templateSlides";

export type PresentationReviewStatus = "pass" | "needs_review" | "blocked";
export type PresentationReviewEngine = "agent" | "local";

export interface PresentationReviewIssue {
  severity: "error" | "warning";
  slideIndex?: number;
  title: string;
  detail: string;
}

export interface PresentationReview {
  status: PresentationReviewStatus;
  engine: PresentationReviewEngine;
  summary: string;
  issues: PresentationReviewIssue[];
  checkedSlides: number;
  model?: string;
}

interface ReviewShapeSnapshot {
  id: string;
  kind: string;
  text: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSizePt?: number;
}

export interface PresentationReviewSnapshot {
  slideCount: number;
  slides: Array<{
    index: number;
    title: string;
    role: string;
    text: string;
    shapes: ReviewShapeSnapshot[];
  }>;
}

const INTERNAL_INSTRUCTION = /slide\s+ini\s+(?:cuma|hanya)|opsional\s+(?:harus|untuk)|kalau\s+emang\s+kasusnya|hapus\s+aja|ga\s+harus\s+ada|tidak\s+nyambung|orang\s+kasusnya/i;
const SAMPLE_LEAK = /\b(?:qhs|cti\s*0[,.]62|pediatric sample|sample patient|contoh pasien|cat\s*mudpi(?:les|lles)|high\s+anion\s+gap|congenital heart failure|syok hipovolemia e\.c\. diare akut)\b/i;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function clinicalText(value: string): boolean {
  const text = normalizedText(value);
  return text.length >= 48 && !/^(?:tidak tercantum|normal|hasil|deskripsi|organ|pemeriksaan|tanda vital|keadaan umum)$/i.test(text);
}

function isAllPatientsSummarySlide(template: ParsedTemplate, slide: ParsedTemplate["slides"][number]): boolean {
  return slide.role === "shift_summary"
    || slide.patientScope === "all_patients"
    || template.bindings.some((binding) => binding.slideIndex === slide.index && binding.semanticField === "shift.patientSummaryTable");
}

function summaryTableCapacity(template: ParsedTemplate, slide: ParsedTemplate["slides"][number]): number {
  const binding = template.bindings.find((item) => item.slideIndex === slide.index && item.semanticField === "shift.patientSummaryTable");
  if (!binding) return 0;
  const shape = slide.shapes.find((item) => item.id === binding.shapeId);
  return Math.max(0, (shape?.tableRows?.length ?? 0) - 1);
}

function summaryPageCount(template: ParsedTemplate, patientCount: number): number {
  return template.slides
    .filter((slide) => slideIsIncluded(slide) && isAllPatientsSummarySlide(template, slide))
    .reduce((total, slide) => {
      const capacity = summaryTableCapacity(template, slide);
      return total + (capacity > 0 ? Math.max(1, Math.ceil(patientCount / capacity)) : 1);
    }, 0);
}

function expectedSlideCount(template: ParsedTemplate, totalPatientCount: number, detailPatientCount: number): number {
  const selected = template.slides.filter(slideIsIncluded);
  const repeatCount = selected.filter((slide) => slide.repeat).length;
  const summarySlides = selected.filter((slide) => isAllPatientsSummarySlide(template, slide)).length;
  const summaryPages = summaryPageCount(template, totalPatientCount);
  const summaryContinuationPages = Math.max(0, summaryPages - summarySlides);
  return selected.length + summaryContinuationPages + Math.max(0, detailPatientCount - 1) * repeatCount;
}

function detailPatientCount(patients: PatientRecord[], focusPatientId?: string): number {
  if (!focusPatientId) return patients.length;
  return patients.some((patient) => patient.id === focusPatientId) ? 1 : 0;
}

function estimateOverflow(shape: ReviewShapeSnapshot): boolean {
  if (shape.kind !== "text" || !shape.text.trim() || !shape.width || !shape.height) return false;
  const fontSize = shape.fontSizePt && shape.fontSizePt > 0 ? shape.fontSizePt : 14;
  const charactersPerLine = Math.max(12, Math.floor((shape.width * 72) / (fontSize * 0.55)));
  const estimatedLines = shape.text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  const availableLines = Math.max(1, Math.floor((shape.height * 72) / (fontSize * 1.25)));
  return estimatedLines > availableLines * 1.8 && shape.text.length > 90;
}

function patientNames(patients: PatientRecord[]): string[] {
  return patients
    .map((patient) => patient.identifiers.name?.value || patient.identifiers.initials?.value || patient.displayName)
    .map((name) => String(name || "").trim())
    .filter((name) => name.length >= 2);
}

function summaryOutputSlides(parsed: { slides: Array<{ title: string; text: string; shapes: Array<{ tableRows?: string[][] }> }> }): Array<{ title: string; text: string; shapes: Array<{ tableRows?: string[][] }> }> {
  return parsed.slides.filter((slide) => /(?:pasien baru|daftar pasien|ringkasan pasien|resume jaga)/i.test(`${slide.title} ${slide.text}`));
}

function summaryOutputText(slides: Array<{ title: string; text: string; shapes: Array<{ tableRows?: string[][] }> }>): string {
  return slides
    .flatMap((slide) => [slide.title, slide.text, ...slide.shapes.flatMap((shape) => shape.tableRows?.flat() || [])])
    .join(" ");
}

export function buildPresentationReviewSnapshot(parsed: { slides: Array<{ index: number; title: string; role: string; text: string; shapes: ReviewShapeSnapshot[] }> }): PresentationReviewSnapshot {
  return {
    slideCount: parsed.slides.length,
    slides: parsed.slides.map((slide) => ({
      index: slide.index,
      title: slide.title,
      role: slide.role,
      text: slide.text.slice(0, 1600),
      shapes: slide.shapes.slice(0, 80).map((shape) => ({
        id: shape.id,
        kind: shape.kind,
        text: shape.text.slice(0, 900),
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        fontSizePt: shape.fontSizePt,
      })),
    })),
  };
}

export async function inspectGeneratedPresentation(
  blob: Blob,
  template: ParsedTemplate,
  patients: PatientRecord[],
  focusPatientId?: string,
): Promise<{ review: PresentationReview; snapshot: PresentationReviewSnapshot }> {
  const parsed = await parsePptx(await blob.arrayBuffer(), "generated-koasis.pptx");
  const snapshot = buildPresentationReviewSnapshot(parsed);
  const issues: PresentationReviewIssue[] = [];
  const expectedCount = expectedSlideCount(template, patients.length, detailPatientCount(patients, focusPatientId));
  if (parsed.slides.length !== expectedCount) {
    issues.push({ severity: "error", title: "Jumlah slide tidak konsisten", detail: `Output memiliki ${parsed.slides.length} slide aktif, tetapi kontrak mengharapkan ${expectedCount}.` });
  }

  parsed.slides.forEach((slide) => {
    const textShapes = slide.shapes.filter((shape) => shape.kind === "text" && shape.text.trim());
    const repeatedTexts = new Map<string, ReviewShapeSnapshot[]>();
    textShapes.forEach((shape) => {
      const key = normalizedText(shape.text);
      if (clinicalText(shape.text)) repeatedTexts.set(key, [...(repeatedTexts.get(key) || []), shape]);
      if (INTERNAL_INSTRUCTION.test(shape.text)) {
        issues.push({ severity: "error", slideIndex: slide.index, title: "Instruksi template ikut terbawa", detail: `Slide ${slide.index + 1} masih memuat catatan internal/opsional: “${shape.text.slice(0, 180)}”.` });
      }
      if (SAMPLE_LEAK.test(shape.text)) {
        issues.push({ severity: "error", slideIndex: slide.index, title: "Contoh template belum terhapus", detail: `Slide ${slide.index + 1} masih memuat teks contoh: “${shape.text.slice(0, 180)}”.` });
      }
      if (estimateOverflow(shape)) {
        issues.push({ severity: "warning", slideIndex: slide.index, title: "Potensi teks terlalu padat", detail: `Shape ${shape.id} pada slide ${slide.index + 1} diperkirakan membutuhkan lebih banyak baris daripada ruang yang tersedia.` });
      }
    });
    repeatedTexts.forEach((shapes) => {
      if (shapes.length > 1) {
        issues.push({ severity: "error", slideIndex: slide.index, title: "Blok klinis terduplikasi", detail: `Teks klinis yang sama muncul di ${shapes.length} box pada slide ${slide.index + 1}; ini berisiko menghasilkan overlay.` });
      }
    });
  });

  const expectedSummarySlides = summaryPageCount(template, patients.length);
  const renderedSummarySlides = summaryOutputSlides(parsed);
  if (expectedSummarySlides > 0 && renderedSummarySlides.length < expectedSummarySlides) {
    issues.push({ severity: "error", title: "Tabel ringkasan pasien tidak lengkap", detail: `Output hanya memiliki ${renderedSummarySlides.length} slide ringkasan, sedangkan kontrak membutuhkan ${expectedSummarySlides}.` });
  }
  if (expectedSummarySlides > 0 && renderedSummarySlides.length > 0) {
    const summaryText = normalizedText(summaryOutputText(renderedSummarySlides));
    patientNames(patients).forEach((name) => {
      if (!summaryText.includes(normalizedText(name))) {
        issues.push({ severity: "error", title: "Pasien tidak masuk tabel ringkasan", detail: `Nama/inisial “${name}” tidak ditemukan pada tabel pasien baru. Output ditahan agar daftar pasien tidak hilang.` });
      }
    });
  }

  const allText = parsed.slides.flatMap((slide) => slide.shapes.map((shape) => shape.text)).join(" ");
  patientNames(patients).forEach((name) => {
    if (!allText.toLowerCase().includes(name.toLowerCase())) {
      issues.push({ severity: "warning", title: "Identitas pasien tidak terlihat di output", detail: `Nama/inisial “${name}” tidak ditemukan pada teks output; periksa binding identitas.` });
    }
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  const status: PresentationReviewStatus = errors.length ? "blocked" : issues.length ? "needs_review" : "pass";
  return {
    snapshot,
    review: {
      status,
      engine: "local",
      summary: errors.length
        ? `${errors.length} masalah struktural/kontekstual ditemukan sebelum download.`
        : issues.length
          ? `${issues.length} catatan perlu diperiksa sebelum output dianggap final.`
          : "Pemeriksaan struktur dan konteks lokal lulus.",
      issues: issues.slice(0, 24),
      checkedSlides: parsed.slides.length,
    },
  };
}

function compactPatientContext(patients: PatientRecord[], focusPatientId?: string): Array<Record<string, unknown>> {
  return patients.map((patient) => ({
    label: patient.displayName,
    scope: patient.id === focusPatientId ? "focus_patient" : "summary_only",
    name: patient.identifiers.name?.value || patient.identifiers.initials?.value || null,
    age: patient.demographics.age?.value || null,
    sex: patient.demographics.sex?.value || null,
    diagnosis: patient.assessment.workingDiagnosis?.value || [],
    imaging: patient.investigations.imaging?.value || [],
  }));
}

async function thumbnail(dataUrl: string): Promise<string> {
  if (typeof document === "undefined") return dataUrl;
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(dataUrl);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.62));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

export async function reviewPresentationWithAgent(
  snapshot: PresentationReviewSnapshot,
  patients: PatientRecord[],
  renderedSlides: string[],
  focusPatientId?: string,
): Promise<PresentationReview> {
  const candidateIndexes = Array.from(new Set([0, 1, Math.floor((renderedSlides.length - 1) / 2), renderedSlides.length - 1].filter((index) => index >= 0 && index < renderedSlides.length))).slice(0, 6);
  const visuals = await Promise.all(candidateIndexes.map(async (slideIndex) => ({ slideIndex, dataUrl: await thumbnail(renderedSlides[slideIndex]) })));
  const response = await fetch("/api/presentation/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snapshot, patients: compactPatientContext(patients, focusPatientId), focusPatientId, visuals }),
  });
  let payload: unknown = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : `Agent review gagal (HTTP ${response.status}).`;
    throw new Error(message);
  }
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const rawReview = record.review && typeof record.review === "object" ? record.review as Record<string, unknown> : record;
  const status = rawReview.status === "pass" || rawReview.status === "blocked" || rawReview.status === "needs_review" ? rawReview.status : "needs_review";
  const rawIssues = Array.isArray(rawReview.issues) ? rawReview.issues : [];
  const issues: PresentationReviewIssue[] = rawIssues.map((item) => {
    const issue = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      severity: issue.severity === "error" ? "error" as const : "warning" as const,
      slideIndex: typeof issue.slideIndex === "number" ? issue.slideIndex : undefined,
      title: typeof issue.title === "string" ? issue.title : "Catatan agent",
      detail: typeof issue.detail === "string" ? issue.detail : "Agent meminta pemeriksaan manual.",
    };
  }).slice(0, 24);
  return {
    status,
    engine: "agent",
    summary: typeof rawReview.summary === "string" ? rawReview.summary : "Agent selesai memeriksa slide visual dan konteks klinis.",
    issues,
    checkedSlides: snapshot.slideCount,
    model: typeof record.model === "string" ? record.model : undefined,
  };
}
