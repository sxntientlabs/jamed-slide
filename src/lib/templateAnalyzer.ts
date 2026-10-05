import type {
  ParsedTemplate,
  SemanticField,
  SlideRole,
  TemplateAnalysis,
  TemplateBinding,
  TemplateFieldGroup,
  TemplateFieldSpec,
  TemplateShiftField,
  TemplateSlideGuide,
  TemplateSlidePatientScope,
} from "../types";
import { buildLocalTemplateAnalysis } from "./templateProfiles";
import { validateTemplateContract } from "./templateContract";
import { guideIsIncluded, inferPatientScope, inferSlideInclusion, normalizePatientScope, normalizeSlideInclusion } from "./templateSlides";

export { buildLocalTemplateAnalysis } from "./templateProfiles";
export { validateTemplateContract } from "./templateContract";

type JsonObject = Record<string, unknown>;

export interface TemplateSnapshot {
  name: string;
  fileName: string;
  slideCount: number;
  slides: Array<{
    index: number;
    slideNumber: number;
    title: string;
    role: SlideRole;
    repeatCandidate: boolean;
    patientScope: TemplateSlidePatientScope;
    inclusion: string;
    includeByDefault: boolean;
    inclusionReason?: string;
    speakerNotes?: string;
    text: string;
    shapes: Array<{
      id: string;
      name?: string;
      kind: string;
      text: string;
      tableRows?: string[][];
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      placeholderType?: string;
      fontSizePt?: number;
      bold?: boolean;
      fillColor?: string;
    }>;
  }>;
}

const ROLES: SlideRole[] = [
  "cover", "shift_summary", "patient_identity", "anamnesis", "history", "pediatric_assessment",
  "primary_survey", "secondary_survey", "anthropometry", "physical_exam", "investigation", "diagnosis",
  "management", "timeline", "patient_summary", "consultation", "delivery_preparation", "resuscitation",
  "stabilization", "checklist", "closing", "unknown",
];

const SEMANTIC_FIELDS: SemanticField[] = [
  "static", "shift.title", "shift.date", "shift.department", "shift.hospital", "shift.team", "shift.student",
  "shift.ppds", "shift.presenter", "shift.perinaTeam", "shift.facilitator", "shift.dpjp", "shift.custom",
  "shift.coverBlock", "shift.patientSummaryTable", "patient.identifiers.name", "patient.identifiers.initials",
  "patient.identifiers.medicalRecordNumber", "patient.demographics.age", "patient.demographics.sex",
  "patient.demographics.weightKg", "patient.demographics.heightCm", "patient.chiefComplaint",
  "patient.history.presentIllness", "patient.history.pastMedicalHistory", "patient.history.medicationHistory",
  "patient.history.allergyHistory", "patient.history.birthHistory", "patient.history.immunizationHistory",
  "patient.history.familyHistory", "patient.history.nutritionHistory", "patient.history.socioeconomicHistory",
  "patient.identityBlock", "patient.historyBlock", "patient.pediatricAssessmentBlock",
  "patient.pediatricAssessment.leftBlock", "patient.pediatricAssessment.rightBlock", "patient.primarySurveyBlock",
  "patient.secondarySurveyBlock", "patient.anthropometryBlock", "patient.physicalExamBlock", "patient.physicalExam.generalAppearanceBlock", "patient.physicalExam.vitalSignsBlock",
  "patient.physicalExam.organFindings", "patient.investigationsBlock", "patient.investigations.summary",
  "patient.assessmentBlock", "patient.assessment.summary", "patient.managementBlock", "patient.managementTable",
  "patient.timelineBlock", "patient.nutritionBlock", "patient.templateSection", "patient.physicalExam.generalAppearance",
  "patient.physicalExam.consciousness", "patient.physicalExam.vitalSigns.bloodPressure",
  "patient.physicalExam.vitalSigns.heartRate", "patient.physicalExam.vitalSigns.respiratoryRate",
  "patient.physicalExam.vitalSigns.temperature", "patient.physicalExam.vitalSigns.spo2", "patient.physicalExam.findings",
  "patient.investigations.laboratory", "patient.investigations.imaging", "patient.assessment.workingDiagnosis",
  "patient.assessment.differentialDiagnosis", "patient.management.medications", "patient.management.fluids",
  "patient.management.procedures", "patient.management.oxygenTherapy", "patient.disposition",
];

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function text(value: unknown, fallback = ""): string {
  return stringValue(value) || fallback;
}

function clamp(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function compact(value: string, max = 800): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}…`;
}

function camelCase(value: string): string {
  const words = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.map((word, index) => index === 0 ? word : `${word[0]?.toUpperCase() || ""}${word.slice(1)}`).join("") || "customField";
}

function safeTemplateKey(value: unknown, fallback: string): string {
  const raw = stringValue(value) || fallback;
  const normalized = raw.replace(/^patient\.templateData\./, "").replace(/^templateData\./, "").replace(/^shift\.metadata\./, "");
  return camelCase(normalized);
}

function normalizeFieldKey(value: unknown, fallback: string): string {
  const raw = stringValue(value) || fallback;
  if (/^(?:templateData|history|demographics|identifiers|physicalExam|investigations|assessment|management|admission|chiefComplaint|urgency|disposition)\./.test(raw)) return raw;
  if (/^patient\./.test(raw)) return raw.replace(/^patient\./, "");
  const known = new Set([
    "chiefComplaint", "urgency", "displayName", "identifiers.name", "identifiers.initials", "identifiers.medicalRecordNumber",
    "demographics.age", "demographics.sex", "demographics.weightKg", "demographics.heightCm", "history.presentIllness",
    "history.pastMedicalHistory", "history.medicationHistory", "history.allergyHistory", "history.birthHistory",
    "history.immunizationHistory", "history.familyHistory", "history.nutritionHistory", "history.socioeconomicHistory",
    "physicalExam.generalAppearance", "physicalExam.consciousness", "physicalExam.findings", "investigations.laboratory",
    "investigations.imaging", "assessment.workingDiagnosis", "assessment.differentialDiagnosis", "disposition",
  ]);
  return known.has(raw) ? raw : `templateData.${camelCase(raw)}`;
}

function normalizeShiftFields(raw: unknown, fallback: TemplateShiftField[]): TemplateShiftField[] {
  if (!Array.isArray(raw)) return fallback;
  const fields = raw.map((item, index): TemplateShiftField | undefined => {
    const record = isRecord(item) ? item : {};
    const label = text(record.label, `Metadata ${index + 1}`);
    const rawKey = stringValue(record.key) || label;
    const key = safeTemplateKey(rawKey, `metadata${index + 1}`);
    if (["date", "title"].includes(key)) return undefined;
    return {
      key,
      label,
      placeholder: text(record.placeholder, `Isi ${label.toLowerCase()}`),
      required: Boolean(record.required),
    } satisfies TemplateShiftField;
  }).filter((field): field is TemplateShiftField => Boolean(field));
  return Array.from(new Map(fields.map((field) => [field.key, field])).values()).slice(0, 16);
}

function normalizeFields(raw: unknown, fallback: TemplateFieldSpec[] = []): TemplateFieldSpec[] {
  if (!Array.isArray(raw)) return fallback;
  return raw.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const label = text(record.label, `Field ${index + 1}`);
    return {
      key: normalizeFieldKey(record.key, label),
      label,
      placeholder: text(record.placeholder, "Isi bila tersedia dari source pasien"),
      multiline: record.multiline === undefined ? true : Boolean(record.multiline),
      required: Boolean(record.required),
      inputMode: record.inputMode === "numeric" ? "numeric" : "text",
    } satisfies TemplateFieldSpec;
  }).slice(0, 80);
}

function normalizeGroups(raw: unknown, fallback: TemplateFieldGroup[]): TemplateFieldGroup[] {
  if (!Array.isArray(raw)) return fallback;
  const groups = raw.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const label = text(record.label, `Bagian ${index + 1}`);
    return {
      id: safeTemplateKey(record.id, `section${index + 1}`),
      label,
      description: text(record.description, `Field yang dibutuhkan untuk ${label}.`),
      fields: normalizeFields(record.fields),
    } satisfies TemplateFieldGroup;
  }).filter((group) => group.fields.length);
  return groups.length ? groups.slice(0, 20) : fallback;
}

function normalizedSlideIndex(value: unknown, slideCount: number): number | undefined {
  const index = Number(value);
  if (!Number.isInteger(index)) return undefined;
  if (index >= 0 && index < slideCount) return index;
  if (index >= 1 && index <= slideCount) return index - 1;
  return undefined;
}

function normalizeGuides(raw: unknown, template: ParsedTemplate, fallback: TemplateSlideGuide[]): TemplateSlideGuide[] {
  const items = Array.isArray(raw) ? raw : [];
  const byIndex = new Map<number, JsonObject>();
  items.forEach((item) => {
    if (!isRecord(item)) return;
    const index = normalizedSlideIndex(item.index ?? item.slideIndex ?? item.slideNumber, template.slideCount);
    if (index !== undefined && !byIndex.has(index)) byIndex.set(index, item);
  });
  return template.slides.map((slide) => {
    const source = byIndex.get(slide.index);
    const local = fallback.find((guide) => guide.index === slide.index);
    const roleValue = text(source?.role, local?.role || slide.role) as SlideRole;
    const role = ROLES.includes(roleValue) ? roleValue : (local?.role || slide.role);
    const fields = Array.isArray(source?.fields) ? source.fields.map((field) => text(field)).filter(Boolean).slice(0, 24) : (local?.fields || []);
    // Notes explain how to present a slide; they are not proof that the
    // slide itself is optional. The agent still receives notes in the full
    // snapshot and can classify them explicitly when the template says so.
    const inferred = inferSlideInclusion(`${slide.title} ${slide.text}`, role, slide.index, template.profileId);
    const sourceHasInclusion = source?.inclusion !== undefined || source?.mode !== undefined || source?.classification !== undefined;
    const inclusion = !sourceHasInclusion
      ? (local?.inclusion || slide.inclusion || inferred.inclusion)
      : normalizeSlideInclusion(source?.inclusion ?? source?.mode ?? source?.classification, local?.inclusion || inferred.inclusion);
    const include = source?.include === undefined && source?.includeByDefault === undefined
      ? (sourceHasInclusion && inclusion !== "routine" ? false : local?.include ?? slide.include ?? inferred.include)
      : Boolean(source?.include ?? source?.includeByDefault);
    const fallbackScope = local?.patientScope || slide.patientScope || inferPatientScope(role, local?.repeat ?? slide.repeat);
    const patientScope = normalizePatientScope(source?.patientScope ?? source?.scope, fallbackScope);
    const repeat = patientScope === "focus_patient"
      && (source?.repeat === undefined ? (local?.repeat ?? slide.repeat) : Boolean(source.repeat));
    return {
      index: slide.index,
      label: text(source?.label, local?.label || slide.title || `Slide ${slide.index + 1}`),
      role,
      repeat,
      fields,
      instructions: text(source?.instructions, local?.instructions || `Pertahankan konteks slide ${slide.index + 1}.`),
      speakerNote: text(source?.speakerNote, slide.speakerNotes || local?.speakerNote || undefined) || undefined,
      inclusion,
      include,
      inclusionReason: text(source?.inclusionReason, local?.inclusionReason || (inclusion !== "routine" ? inferred.reason : undefined)) || undefined,
      patientScope,
    } satisfies TemplateSlideGuide;
  });
}

function normalizeSemantic(value: unknown): { semanticField: SemanticField; templateKey?: string } | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  if (/^shift\.metadata\./.test(raw)) return { semanticField: "shift.custom", templateKey: safeTemplateKey(raw, "metadata") };
  if (/^patient\.templateData\./.test(raw)) return { semanticField: "patient.templateSection", templateKey: safeTemplateKey(raw, "customSection") };
  const semanticField = (SEMANTIC_FIELDS.includes(raw as SemanticField) ? raw : undefined) as SemanticField | undefined;
  return semanticField ? { semanticField } : undefined;
}

function normalizeBindings(raw: unknown, template: ParsedTemplate): TemplateBinding[] {
  if (!Array.isArray(raw)) return [];
  const bindings: TemplateBinding[] = [];
  raw.forEach((item) => {
    if (!isRecord(item)) return;
    const slideIndex = normalizedSlideIndex(item.slideIndex ?? item.index ?? item.slideNumber, template.slideCount);
    const shapeId = stringValue(item.shapeId);
    if (slideIndex === undefined || !shapeId) return;
    const slide = template.slides[slideIndex];
    if (!slide?.shapes.some((shape) => shape.id === shapeId)) return;
    const semantic = normalizeSemantic(item.semanticField ?? item.field);
    if (!semantic || semantic.semanticField === "static") return;
    const templateKey = semantic.templateKey || (stringValue(item.templateKey) ? safeTemplateKey(item.templateKey, "customSection") : undefined);
    bindings.push({
      slideIndex,
      shapeId,
      semanticField: semantic.semanticField,
      templateKey,
      confidence: clamp(item.confidence, 0.78),
      source: "agent",
    });
  });
  return Array.from(new Map(bindings.map((binding) => [`${binding.slideIndex}:${binding.shapeId}`, binding])).values());
}

function mergeBindings(template: ParsedTemplate, agentBindings: TemplateBinding[]): TemplateBinding[] {
  // The agent is the source of truth for a fresh custom upload. Preserve only
  // explicit user corrections, not the provisional filename/keyword mapping
  // produced before the agent saw the whole template.
  const merged = new Map(template.bindings
    .filter((binding) => binding.source === "user")
    .map((binding) => [`${binding.slideIndex}:${binding.shapeId}`, binding]));
  agentBindings.forEach((binding) => {
    const key = `${binding.slideIndex}:${binding.shapeId}`;
    if (!merged.has(key)) merged.set(key, binding);
  });
  return Array.from(merged.values());
}

function mergeKnownProfileBindings(template: ParsedTemplate, agentBindings: TemplateBinding[]): TemplateBinding[] {
  const merged = new Map(template.bindings.map((binding) => [`${binding.slideIndex}:${binding.shapeId}`, binding]));
  agentBindings.forEach((binding) => {
    const key = `${binding.slideIndex}:${binding.shapeId}`;
    // Built-in profiles contain an explicit clinical contract. The template
    // agent may add a previously unknown editable shape, but it must not
    // replace a known profile mapping with a looser keyword guess.
    if (!merged.has(key)) merged.set(key, binding);
  });
  return Array.from(merged.values());
}

export function buildTemplateSnapshot(template: ParsedTemplate): TemplateSnapshot {
  return {
    name: template.name,
    fileName: template.fileName,
    slideCount: template.slideCount,
    slides: template.slides.map((slide) => ({
      index: slide.index,
      slideNumber: slide.index + 1,
      title: compact(slide.title, 180),
      role: slide.role,
      repeatCandidate: slide.repeat,
      patientScope: slide.patientScope || inferPatientScope(slide.role, slide.repeat),
      inclusion: slide.inclusion || "routine",
      includeByDefault: slide.include !== false,
      inclusionReason: slide.inclusionReason,
      speakerNotes: slide.speakerNotes ? compact(slide.speakerNotes, 1800) : undefined,
      text: compact(slide.text, 2800),
      shapes: slide.shapes.slice(0, 80).map((shape) => ({
        id: shape.id,
        name: shape.name,
        kind: shape.kind,
        text: compact(shape.text, 600),
        tableRows: shape.tableRows?.slice(0, 25).map((row) => row.slice(0, 16).map((cell) => compact(cell, 180))),
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
        placeholderType: shape.placeholderType,
        fontSizePt: shape.fontSizePt,
        bold: shape.bold,
        fillColor: shape.fillColor,
      })),
    })),
  };
}

export function applyTemplateAnalysis(template: ParsedTemplate, raw: unknown, source: "agent" | "local", model?: string): ParsedTemplate {
  const local = buildLocalTemplateAnalysis(template);
  const root = isRecord(raw) && isRecord(raw.analysis) ? raw.analysis : (isRecord(raw) ? raw : {});
  const guides = normalizeGuides(root.slides ?? root.slideGuides, template, local.slideGuides);
  const agentBindings = normalizeBindings(root.bindings, template);
  const knownProfile = template.profileId !== "generic";
  const bindings = source === "agent"
    ? (knownProfile
      ? (agentBindings.length ? mergeKnownProfileBindings(template, agentBindings) : local.bindings)
      : (agentBindings.length ? mergeBindings(template, agentBindings) : template.bindings.filter((binding) => binding.source === "user")))
    : local.bindings;
  const fieldGroups = normalizeGroups(root.fieldGroups, local.fieldGroups);
  const shiftFields = normalizeShiftFields(root.shiftFields, local.shiftFields);
  const warnings = Array.isArray(root.warnings) ? root.warnings.map((warning) => text(warning)).filter(Boolean).slice(0, 12) : [];
  const rawAgentGuides = root.slides ?? root.slideGuides;
  const agentGuideIndexes = Array.isArray(rawAgentGuides)
    ? rawAgentGuides.map((item) => isRecord(item) ? normalizedSlideIndex(item.index ?? item.slideIndex ?? item.slideNumber, template.slideCount) : undefined).filter((index): index is number => index !== undefined)
    : [];
  const agentProvidedGuides = Array.isArray(rawAgentGuides)
    && rawAgentGuides.length === template.slideCount
    && new Set(agentGuideIndexes).size === template.slideCount;
  const learningStatus = source === "agent"
    ? (agentBindings.length && agentProvidedGuides ? "agent" : "local_fallback")
    : (knownProfile ? "trusted_profile" : "local_fallback");
  const analysis: TemplateAnalysis = {
    version: 1,
    label: text(root.label, source === "agent" ? `Template custom · ${template.name}` : local.label),
    description: text(root.description, local.description),
    extractionInstructions: text(root.extractionInstructions, local.extractionInstructions),
    patientInputHint: text(root.patientInputHint, local.patientInputHint),
    shiftFields,
    fieldGroups,
    slideGuides: guides,
    bindings,
    warnings: source === "local" ? Array.from(new Set([...local.warnings.filter((warning) => !knownProfile), ...warnings])) : warnings,
    confidence: clamp(root.confidence, source === "agent" ? 0.84 : local.confidence),
    source,
    model,
    learningStatus,
  };
  const candidate: ParsedTemplate = {
    ...template,
    profileId: knownProfile ? template.profileId : "generic",
    slides: template.slides.map((slide) => {
      const guide = guides.find((item) => item.index === slide.index);
      if (!guide) return slide;
      const include = guideIsIncluded(guide);
      return {
        ...slide,
        role: guide.role,
        repeat: include && guide.repeat,
        inclusion: guide.inclusion || slide.inclusion,
        include,
        inclusionReason: guide.inclusionReason || slide.inclusionReason,
        patientScope: guide.patientScope || inferPatientScope(guide.role, include && guide.repeat),
      };
    }),
    bindings,
    templateAnalysis: analysis,
    analysisStatus: "needs_review",
  };
  const validation = validateTemplateContract(candidate);
  const mergedWarnings = Array.from(new Set([...analysis.warnings, ...validation.warnings]));
  const finalizedAnalysis: TemplateAnalysis = { ...analysis, warnings: mergedWarnings, validation };
  return {
    ...candidate,
    templateAnalysis: finalizedAnalysis,
    templateValidation: validation,
    analysisStatus: validation.valid ? "ready" : "needs_review",
  };
}

export async function analyzeTemplateWithAi(template: ParsedTemplate): Promise<{ template: ParsedTemplate; analysis: TemplateAnalysis; error?: string }> {
  const local = buildLocalTemplateAnalysis(template);
  try {
    const response = await fetch("/api/template/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: template.name,
        fileName: template.fileName,
        snapshot: buildTemplateSnapshot(template),
      }),
    });
    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) throw new Error(isRecord(payload) ? text(payload.error, `Template agent gagal (HTTP ${response.status}).`) : `Template agent gagal (HTTP ${response.status}).`);
    const analyzed = applyTemplateAnalysis(template, payload, "agent", isRecord(payload) ? text(payload.model) : undefined);
    return { template: analyzed, analysis: analyzed.templateAnalysis! };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Template agent tidak merespons.";
    const fallback = applyTemplateAnalysis(template, { ...local, warnings: [...local.warnings, `Agent template tidak tersedia: ${reason}`] }, "local");
    return { template: fallback, analysis: fallback.templateAnalysis!, error: reason };
  }
}
