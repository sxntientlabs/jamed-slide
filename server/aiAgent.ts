import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import type { Plugin } from "vite";
import type {
  ClinicalField,
  ClinicalEvent,
  InvestigationItem,
  OrganFinding,
  PatientRecord,
  TreatmentItem,
} from "../src/types";

const MAX_REQUEST_BYTES = 12_000_000;
const MAX_MEDIA_ITEMS = 6;
const MAX_MEDIA_BYTES = 8_000_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 90_000;
const execFile = promisify(execFileCallback);

type Next = (error?: unknown) => void;

interface AgentSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ExtractRequest {
  sourceText?: string;
  sourceId?: string;
  patientLabel?: string;
  templateProfile?: string;
  templateInstructions?: string;
  templateContract?: {
    label?: unknown;
    patientInputHint?: unknown;
    extractionInstructions?: unknown;
    shiftFields?: unknown;
    slides?: unknown;
    fieldGroups?: unknown;
    bindings?: unknown;
    warnings?: unknown;
    confidence?: unknown;
  };
  media?: Array<{
    name: string;
    mimeType: string;
    kind: "image" | "pdf" | "audio";
    dataUrl: string;
  }>;
  shiftContext?: {
    title?: string;
    date?: string;
    department?: string;
    hospital?: string;
    team?: string;
    facilitator?: string;
    dpjp?: string;
    metadata?: Record<string, string>;
  };
}

interface TemplateAnalyzeRequest {
  name?: string;
  fileName?: string;
  snapshot?: unknown;
}

interface JsonObject {
  [key: string]: unknown;
}

const SYSTEM_PROMPT = `You are JaMed Clinical Extraction Agent for Indonesian medical clerkship notes.
Extract only information explicitly documented in the provided source. Do not diagnose, guess, normalize away uncertainty, or invent missing values. Return ONLY valid JSON, without Markdown fences or commentary.
The source can contain headings, prose, abbreviations, and mixed Indonesian clinical notation. Understand the clinical context before assigning a value. Keep each fact under its correct patient section. Do not copy values from a template or turn report metadata into patient identity. Do not write the literal phrase "Tidak tercantum" into JSON; use null or an empty array instead.

The JSON must have this exact top-level shape:
{
  "patient": {
    "identifiers": { "name": string|null, "initials": string|null, "medicalRecordNumber": string|null },
    "demographics": { "age": string|null, "sex": string|null, "weightKg": number|null, "heightCm": number|null },
    "admission": { "arrivalTime": string|null, "admissionDate": string|null, "referralSource": string|null },
    "chiefComplaint": string|null,
    "urgency": "T"|"F"|"true"|"false"|null,
    "history": { "presentIllness": string|null, "pastMedicalHistory": string|null, "medicationHistory": string|null, "allergyHistory": string|null, "birthHistory": string|null, "immunizationHistory": string|null, "familyHistory": string|null, "nutritionHistory": string|null, "socioeconomicHistory": string|null },
    "physicalExam": { "generalAppearance": string|null, "consciousness": string|null, "vitalSigns": { "bloodPressure": string|null, "heartRate": number|null, "respiratoryRate": number|null, "temperature": number|null, "spo2": number|null }, "findings": string|null, "organFindings": [{ "organ": string, "description": string }] },
    "investigations": { "laboratory": [{ "name": string, "result": string|null, "unit": string|null, "reference": string|null }], "imaging": [{ "name": string, "result": string|null, "unit": string|null, "reference": string|null }] },
    "assessment": { "workingDiagnosis": string[], "differentialDiagnosis": string[] },
    "management": { "medications": [{ "name": string, "dose": string|null, "route": string|null, "frequency": string|null, "notes": string|null }], "fluids": [{ "name": string, "dose": string|null, "route": string|null, "frequency": string|null, "notes": string|null }], "procedures": [{ "name": string, "dose": string|null, "route": string|null, "frequency": string|null, "notes": string|null }], "oxygenTherapy": [{ "name": string, "dose": string|null, "route": string|null, "frequency": string|null, "notes": string|null }] },
    "disposition": string|null,
    "timeline": [{ "timestamp": string|null, "category": string|null, "description": string }],
    "templateData": {
      "weightBeforeIllness": string|null,
      "patBehaviour": string|null, "patInteractiveness": string|null, "patConsolability": string|null, "patLookOrGaze": string|null,
      "patBreathing": string|null, "patRetraction": string|null, "patNasalFlaring": string|null, "patAddedBreathSounds": string|null, "patAbnormalPosition": string|null,
      "primarySurvey": string|null, "secondarySurvey": string|null, "organFindingsNote": string|null,
      "initialDiagnosis": string|null, "finalDiagnosis": string|null,
      "initialManagement": string|null, "finalManagement": string|null, "nutritionManagement": string|null,
      "<profile_specific_key>": string|null
    }
  }
}

Use null for missing scalar values and [] for missing lists. Keep clinical wording and units from the source. The source represents one patient, so return one patient record.

When a template profile and slide contract are provided, follow that contract as the source of truth: place each fact only in the named slide/field, keep repeated patient slides per patient, and preserve panel/table/timeline boundaries. For PERINA, preserve the neonatal resuscitation timepoints and S.T.A.B.L.E. sections. For RSCM and RSUI, keep PAT, primary/secondary survey, anthropometry, organ findings, investigations, initial/final diagnosis, and initial/final management separate. Populate templateData with every profile-specific key requested by the contract when the source explicitly supports it; missing keys remain null. When the template profile is Lapjag, preserve the template's clinical separation: do not merge PAT with ABCDE or AMPLE; keep RPS, RPD, birth, immunization, nutrition, and socioeconomic history in their own contexts; retain measurement units and the exact age/sex needed for WHO growth charts; keep initial/working diagnosis separate from documented final diagnosis when the source distinguishes them; and keep management actions and documented response separate. Mark urgency only when the source explicitly states Kegawatan T/F (or an unambiguous equivalent). Never infer an abnormal finding from a diagnosis alone.

For image/PDF/audio evidence, inspect the attachment itself and transcribe only what is legible or explicitly spoken. Keep the attachment as evidence; do not manufacture values for blurry, cropped, or inaudible regions. If an attached image is a photo of a table, preserve row/column context when extracting it.`;

const TEMPLATE_ANALYSIS_SYSTEM_PROMPT = `You are JaMed Template Analysis Agent. Study an uploaded PowerPoint template before patient data is extracted.
Return ONLY valid JSON, without Markdown fences or commentary.

Observe the supplied OOXML-derived snapshot slide by slide. Treat slide text, shape coordinates, table rows, font cues, placeholder types, chart/image presence, and speaker notes as evidence. Infer the information architecture, not just keywords. Identify cover, summary, repeated patient unit, closing, and clinical sections. Set repeat=true only for slides that should be duplicated per patient. Keep static artwork, headings, logos, and chart backgrounds out of editable bindings.

Create a practical contract for the next agent and UI:
- shiftFields are report-level fields visible on the cover or metadata area. Use simple camelCase keys such as team, presenter, unit, facilitator, dpjp, or custom metadata keys. Do not include date or title because JaMed supplies those controls.
- fieldGroups are patient facts for review. Use generic clinical paths when supported and templateData.<camelCaseKey> for section-specific facts.
- each slide guide must describe purpose, required facts, layout boundaries, and evidence rules in plain Indonesian. Mention tables, timelines, checklists, charts, notes, and fixed labels when observed.
- bindings must reference only shape IDs in the snapshot. Use the supported semanticField values below. For custom patient sections use patient.templateSection plus templateKey. For custom cover metadata use shift.custom plus templateKey. Do not bind headings/decorations when an adjacent empty/body shape is the data slot.
- preserve context boundaries and do not invent a medical field the template does not imply.

Supported semanticField values:
static, shift.date, shift.department, shift.hospital, shift.team, shift.student, shift.ppds, shift.presenter, shift.perinaTeam, shift.facilitator, shift.dpjp, shift.custom, shift.coverBlock, shift.patientSummaryTable, patient.identifiers.name, patient.identifiers.initials, patient.identifiers.medicalRecordNumber, patient.demographics.age, patient.demographics.sex, patient.demographics.weightKg, patient.demographics.heightCm, patient.chiefComplaint, patient.history.presentIllness, patient.history.pastMedicalHistory, patient.history.medicationHistory, patient.history.allergyHistory, patient.history.birthHistory, patient.history.immunizationHistory, patient.history.familyHistory, patient.history.nutritionHistory, patient.history.socioeconomicHistory, patient.identityBlock, patient.historyBlock, patient.pediatricAssessmentBlock, patient.pediatricAssessment.leftBlock, patient.pediatricAssessment.rightBlock, patient.primarySurveyBlock, patient.secondarySurveyBlock, patient.anthropometryBlock, patient.physicalExamBlock, patient.physicalExam.organFindings, patient.investigationsBlock, patient.investigations.summary, patient.assessmentBlock, patient.assessment.summary, patient.managementBlock, patient.managementTable, patient.timelineBlock, patient.nutritionBlock, patient.templateSection, patient.physicalExam.generalAppearance, patient.physicalExam.consciousness, patient.physicalExam.vitalSigns.bloodPressure, patient.physicalExam.vitalSigns.heartRate, patient.physicalExam.vitalSigns.respiratoryRate, patient.physicalExam.vitalSigns.temperature, patient.physicalExam.vitalSigns.spo2, patient.physicalExam.findings, patient.investigations.laboratory, patient.investigations.imaging, patient.assessment.workingDiagnosis, patient.assessment.differentialDiagnosis, patient.management.medications, patient.management.fluids, patient.management.procedures, patient.management.oxygenTherapy, patient.disposition.

Return exactly:
{
  "label": string,
  "description": string,
  "extractionInstructions": string,
  "patientInputHint": string,
  "shiftFields": [{"key": string, "label": string, "placeholder": string, "required": boolean}],
  "fieldGroups": [{"id": string, "label": string, "description": string, "fields": [{"key": string, "label": string, "placeholder": string, "multiline": boolean, "required": boolean}]}],
  "slides": [{"index": number, "label": string, "role": string, "repeat": boolean, "fields": string[], "instructions": string, "speakerNote": string}],
  "bindings": [{"slideIndex": number, "shapeId": string, "semanticField": string, "templateKey": string, "confidence": number}],
  "warnings": string[],
  "confidence": number
}

Be conservative. When a section is ambiguous, explain it in warnings and use patient.templateData instead of forcing a generic field. The result will be reviewed before generation.`;

const TEMPLATE_DATA_KEYS = [
  "weightBeforeIllness",
  "patBehaviour",
  "patInteractiveness",
  "patConsolability",
  "patLookOrGaze",
  "patBreathing",
  "patRetraction",
  "patNasalFlaring",
  "patAddedBreathSounds",
  "patAbnormalPosition",
  "primarySurvey",
  "secondarySurvey",
  "organFindingsNote",
  "initialDiagnosis",
  "finalDiagnosis",
  "initialManagement",
  "finalManagement",
  "nutritionManagement",
  "gestationalAge",
  "birthWeight",
  "address",
  "antenatalConsultation",
  "fetomaternalUltrasound",
  "previousDeliveries",
  "deliveryPreparation",
  "neonatalBirthProcess",
  "resuscitationTimeline",
  "stableStabilization",
  "stableConclusion",
  "headCircumference",
  "ballardScore",
  "neonatalAnthropometryConclusion",
  "neonatalVitals",
  "pregnancyBirth",
  "dateOfBirth",
  "weightForAge",
  "heightForAge",
  "weightForHeight",
  "heightAge",
  "rda",
  "nutritionConclusion",
  "supportingInvestigations",
  "emergencyManagement",
  "growthDevelopment",
  "muac",
  "radiology",
  "radiologyInterpretation",
  "otherExaminations",
  "bloodGasTable",
] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function valueAtPath(root: JsonObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, root);
}

function pick(root: JsonObject, paths: string[]): unknown {
  for (const path of paths) {
    const value = valueAtPath(root, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const raw = stringValue(value);
  if (!raw) return undefined;
  const match = raw.replace(/,/g, ".").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const text = stringValue(value);
  return text ? text.split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean) : [];
}

function sourceSnippet(sourceText: string, value: unknown): string {
  const needle = stringValue(value)?.toLowerCase();
  const lines = sourceText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const match = needle ? lines.find((line) => line.toLowerCase().includes(needle)) : undefined;
  return (match || lines[0] || sourceText).slice(0, 220);
}

function clinicalField<T>(value: T | undefined, sourceText: string, sourceId: string): ClinicalField<T> {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    return { status: "missing", confidence: 0, sources: [] };
  }
  return {
    value,
    status: "documented",
    confidence: 0.86,
    sources: [{ sourceId, textSnippet: sourceSnippet(sourceText, value) }],
  };
}

function stringField(root: JsonObject, paths: string[], sourceText: string, sourceId: string): ClinicalField<string> {
  return clinicalField(stringValue(pick(root, paths)), sourceText, sourceId);
}

function templateValue(value: unknown): string | undefined {
  const scalar = stringValue(value);
  if (scalar) return scalar;
  if (Array.isArray(value)) {
    const values = value.map((item) => templateValue(item)).filter(Boolean);
    return values.length ? values.join("\n") : undefined;
  }
  if (isRecord(value)) {
    const lines = Object.entries(value)
      .map(([key, item]) => {
        const rendered = templateValue(item);
        return rendered ? `${key}: ${rendered}` : "";
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n") : undefined;
  }
  return undefined;
}

function templateDataField(root: JsonObject, key: string, sourceText: string, sourceId: string): ClinicalField<string> {
  const value = pick(root, [`templateData.${key}`, `template_data.${key}`, `lapjag.${key}`, key]);
  return clinicalField(templateValue(value), sourceText, sourceId);
}

function numberField(root: JsonObject, paths: string[], sourceText: string, sourceId: string): ClinicalField<number> {
  return clinicalField(numberValue(pick(root, paths)), sourceText, sourceId);
}

function stringArrayField(root: JsonObject, paths: string[], sourceText: string, sourceId: string): ClinicalField<string[]> {
  const values = arrayValue(pick(root, paths)).map(stringValue).filter((value): value is string => Boolean(value));
  return clinicalField(values.length ? values : undefined, sourceText, sourceId);
}

function normalizeInvestigation(value: unknown): InvestigationItem[] {
  return arrayValue(value).map((item) => {
    if (typeof item === "string" || typeof item === "number") return { name: String(item) };
    const record = asRecord(item);
    return {
      name: stringValue(record.name) || stringValue(record.test) || "Pemeriksaan",
      result: stringValue(record.result),
      unit: stringValue(record.unit),
      reference: stringValue(record.reference),
    };
  });
}

function normalizeOrganFindings(value: unknown): OrganFinding[] {
  return arrayValue(value).map((item) => {
    if (typeof item === "string" || typeof item === "number") return { organ: "Temuan", description: String(item) };
    const record = asRecord(item);
    return {
      organ: stringValue(record.organ) || stringValue(record.name) || "Temuan",
      description: stringValue(record.description) || stringValue(record.finding) || "Tidak tercantum",
    };
  });
}

function investigationField(root: JsonObject, paths: string[], sourceText: string, sourceId: string): ClinicalField<InvestigationItem[]> {
  const values = normalizeInvestigation(pick(root, paths));
  return clinicalField(values.length ? values : undefined, sourceText, sourceId);
}

function normalizeTreatment(value: unknown): TreatmentItem[] {
  return arrayValue(value).map((item) => {
    if (typeof item === "string" || typeof item === "number") return { name: String(item) };
    const record = asRecord(item);
    return {
      name: stringValue(record.name) || stringValue(record.medication) || stringValue(record.procedure) || "Tindakan",
      dose: stringValue(record.dose),
      route: stringValue(record.route),
      frequency: stringValue(record.frequency),
      notes: stringValue(record.notes),
    };
  });
}

function treatmentField(root: JsonObject, paths: string[], sourceText: string, sourceId: string): ClinicalField<TreatmentItem[]> {
  const values = normalizeTreatment(pick(root, paths));
  return clinicalField(values.length ? values : undefined, sourceText, sourceId);
}

function normalizeTemplateData(root: JsonObject, sourceText: string, sourceId: string): Record<string, ClinicalField<string>> {
  const raw = asRecord(pick(root, ["templateData", "template_data"]));
  const keys = Array.from(new Set([...TEMPLATE_DATA_KEYS, ...Object.keys(raw)]));
  return Object.fromEntries(keys.map((key) => [key, templateDataField(root, key, sourceText, sourceId)]));
}

type EventCategory = ClinicalEvent["category"];

function inferredEventCategory(description: string): EventCategory {
  const value = description.toLowerCase();
  if (/(datang|masuk|presentasi)/.test(value)) return "presentation";
  if (/(lab|radiologi|usg|pemeriksaan)/.test(value)) return "investigation";
  if (/(obat|terapi|oksigen|nebul|tindakan|cairan)/.test(value)) return "treatment";
  if (/(konsul|konsultasi)/.test(value)) return "consultation";
  if (/(membaik|memburuk|respon|saturasi)/.test(value)) return "response";
  if (/(pulang|rawat|rujuk|disposisi)/.test(value)) return "disposition";
  return "assessment";
}

function normalizeTimeline(value: unknown, sourceText: string, sourceId: string): ClinicalEvent[] {
  return arrayValue(value).map((item, index) => {
    const record = asRecord(item);
    const description = stringValue(record.description) || stringValue(item) || "Catatan klinis";
    const categoryValue = stringValue(record.category)?.toLowerCase();
    const validCategories: EventCategory[] = ["presentation", "assessment", "investigation", "treatment", "consultation", "response", "disposition"];
    const category = validCategories.includes(categoryValue as EventCategory) ? categoryValue as EventCategory : inferredEventCategory(description);
    return {
      id: `${sourceId}-event-${index}`,
      timestamp: stringValue(record.timestamp),
      category,
      description,
      sources: [{ sourceId, textSnippet: sourceSnippet(sourceText, description) }],
    };
  });
}

function plausiblePatientName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value)) return undefined;
  if (/^\d{1,2}[\s/-]+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i.test(value)) return undefined;
  return value.slice(0, 120);
}

function normalizePatient(raw: unknown, sourceText: string, sourceId: string, patientLabel?: string, index = 0): PatientRecord {
  const root = asRecord(raw);
  const name = clinicalField(plausiblePatientName(stringValue(pick(root, ["identifiers.name", "name"]))), sourceText, sourceId);
  const initials = stringField(root, ["identifiers.initials", "initials"], sourceText, sourceId);
  const medicalRecordNumber = stringField(root, ["identifiers.medicalRecordNumber", "identifiers.medical_record_number", "medicalRecordNumber", "medical_record_number", "noRm", "no_rm"], sourceText, sourceId);
  const displayName = name.value || initials.value || stringValue(pick(root, ["displayName", "display_name"])) || patientLabel || `Pasien ${index + 1}`;

  return {
    id: `${sourceId}-patient-${index + 1}`,
    displayName,
    identifiers: { name, initials, medicalRecordNumber },
    demographics: {
      age: stringField(root, ["demographics.age", "age", "usia", "umur"], sourceText, sourceId),
      sex: stringField(root, ["demographics.sex", "sex", "gender", "jenisKelamin", "jenis_kelamin"], sourceText, sourceId),
      weightKg: numberField(root, ["demographics.weightKg", "demographics.weight_kg", "weightKg", "weight_kg", "weight", "bb", "beratBadan"], sourceText, sourceId),
      heightCm: numberField(root, ["demographics.heightCm", "demographics.height_cm", "heightCm", "height_cm", "height", "tb", "tinggiBadan"], sourceText, sourceId),
    },
    admission: {
      arrivalTime: stringField(root, ["admission.arrivalTime", "admission.arrival_time", "arrivalTime", "arrival_time", "jamDatang"], sourceText, sourceId),
      admissionDate: stringField(root, ["admission.admissionDate", "admission.admission_date", "admissionDate", "admission_date", "tanggalMasuk"], sourceText, sourceId),
      referralSource: stringField(root, ["admission.referralSource", "admission.referral_source", "referralSource", "referral_source", "rujukan"], sourceText, sourceId),
    },
    chiefComplaint: stringField(root, ["chiefComplaint", "chief_complaint", "keluhanUtama", "keluhan_utama"], sourceText, sourceId),
    urgency: stringField(root, ["urgency", "kegawatan", "emergency", "urgent"], sourceText, sourceId),
    history: {
      presentIllness: stringField(root, ["history.presentIllness", "history.present_illness", "presentIllness", "present_illness", "rps"], sourceText, sourceId),
      pastMedicalHistory: stringField(root, ["history.pastMedicalHistory", "history.past_medical_history", "pastMedicalHistory", "past_medical_history", "rpd"], sourceText, sourceId),
      medicationHistory: stringField(root, ["history.medicationHistory", "history.medication_history", "medicationHistory", "medication_history", "riwayatObat"], sourceText, sourceId),
      allergyHistory: stringField(root, ["history.allergyHistory", "history.allergy_history", "allergyHistory", "allergy_history", "alergi"], sourceText, sourceId),
      birthHistory: stringField(root, ["history.birthHistory", "history.birth_history", "birthHistory", "birth_history", "riwayatLahir"], sourceText, sourceId),
      immunizationHistory: stringField(root, ["history.immunizationHistory", "history.immunization_history", "immunizationHistory", "immunization_history", "imunisasi"], sourceText, sourceId),
      familyHistory: stringField(root, ["history.familyHistory", "history.family_history", "familyHistory", "family_history", "riwayatKeluarga"], sourceText, sourceId),
      nutritionHistory: stringField(root, ["history.nutritionHistory", "history.nutrition_history", "nutritionHistory", "nutrition_history", "riwayatNutrisi", "nutrisi"], sourceText, sourceId),
      socioeconomicHistory: stringField(root, ["history.socioeconomicHistory", "history.socioeconomic_history", "socioeconomicHistory", "socioeconomic_history", "riwayatSosioekonomi", "sosioekonomi"], sourceText, sourceId),
    },
    physicalExam: {
      generalAppearance: stringField(root, ["physicalExam.generalAppearance", "physicalExam.general_appearance", "generalAppearance", "general_appearance", "keadaanUmum"], sourceText, sourceId),
      consciousness: stringField(root, ["physicalExam.consciousness", "kesadaran", "gcs"], sourceText, sourceId),
      vitalSigns: {
        bloodPressure: stringField(root, ["physicalExam.vitalSigns.bloodPressure", "physicalExam.vital_signs.blood_pressure", "vitalSigns.bloodPressure", "vital_signs.blood_pressure", "bloodPressure", "blood_pressure", "td"], sourceText, sourceId),
        heartRate: numberField(root, ["physicalExam.vitalSigns.heartRate", "physicalExam.vital_signs.heart_rate", "vitalSigns.heartRate", "vital_signs.heart_rate", "heartRate", "heart_rate", "nadi", "hr"], sourceText, sourceId),
        respiratoryRate: numberField(root, ["physicalExam.vitalSigns.respiratoryRate", "physicalExam.vital_signs.respiratory_rate", "vitalSigns.respiratoryRate", "vital_signs.respiratory_rate", "respiratoryRate", "respiratory_rate", "lajuNapas", "rr"], sourceText, sourceId),
        temperature: numberField(root, ["physicalExam.vitalSigns.temperature", "physicalExam.vital_signs.temperature", "vitalSigns.temperature", "temperature", "suhu"], sourceText, sourceId),
        spo2: numberField(root, ["physicalExam.vitalSigns.spo2", "physicalExam.vital_signs.spo2", "vitalSigns.spo2", "spo2", "saturasi"], sourceText, sourceId),
      },
      findings: stringField(root, ["physicalExam.findings", "physicalExam.temuan", "findings", "temuanPemeriksaan"], sourceText, sourceId),
      organFindings: clinicalField(
        (() => {
          const values = normalizeOrganFindings(pick(root, ["physicalExam.organFindings", "physicalExam.organ_findings", "organFindings", "organ_findings"]));
          return values.length ? values : undefined;
        })(),
        sourceText,
        sourceId,
      ),
    },
    investigations: {
      laboratory: investigationField(root, ["investigations.laboratory", "investigations.lab", "laboratory", "lab", "hasilLab"], sourceText, sourceId),
      imaging: investigationField(root, ["investigations.imaging", "imaging", "radiology", "radiologi", "usg"], sourceText, sourceId),
      other: clinicalField<InvestigationItem[]>(undefined, sourceText, sourceId),
    },
    assessment: {
      workingDiagnosis: stringArrayField(root, ["assessment.workingDiagnosis", "assessment.working_diagnosis", "workingDiagnosis", "working_diagnosis", "diagnosis", "diagnosa"], sourceText, sourceId),
      differentialDiagnosis: stringArrayField(root, ["assessment.differentialDiagnosis", "assessment.differential_diagnosis", "differentialDiagnosis", "differential_diagnosis", "diagnosisBanding", "diagnosis_banding"], sourceText, sourceId),
    },
    templateData: normalizeTemplateData(root, sourceText, sourceId),
    management: {
      medications: treatmentField(root, ["management.medications", "medications", "medication", "obat"], sourceText, sourceId),
      fluids: treatmentField(root, ["management.fluids", "fluids", "cairan"], sourceText, sourceId),
      procedures: treatmentField(root, ["management.procedures", "procedures", "tindakan", "prosedur"], sourceText, sourceId),
      oxygenTherapy: treatmentField(root, ["management.oxygenTherapy", "management.oxygen_therapy", "oxygenTherapy", "oxygen_therapy", "terapiOksigen"], sourceText, sourceId),
    },
    disposition: stringField(root, ["disposition", "disposisi"], sourceText, sourceId),
    timeline: normalizeTimeline(pick(root, ["timeline", "kronologi", "events"]), sourceText, sourceId),
    sourceId,
  };
}

function parseJsonContent(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    for (let start = 0; start < cleaned.length; start += 1) {
      if (cleaned[start] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < cleaned.length; index += 1) {
        const character = cleaned[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') {
          inString = true;
          continue;
        }
        if (character === "{") depth += 1;
        if (character === "}") depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
    throw new Error("AI agent mengembalikan format JSON yang tidak valid.");
  }
}

function messageContent(response: unknown): string {
  const root = asRecord(response);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : stringValue(asRecord(item).text) || "").join("");
  }
  throw new Error("AI agent tidak mengembalikan isi jawaban.");
}

function safeErrorMessage(responseText: string, status: number): string {
  const compact = responseText.replace(/\s+/g, " ").trim().slice(0, 320);
  return compact ? `AI backend HTTP ${status}: ${compact}` : `AI backend HTTP ${status}.`;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveModel(settings: AgentSettings): Promise<string> {
  if (settings.model) return settings.model;
  const response = await fetchWithTimeout(`${settings.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${settings.apiKey}` },
  }, MODEL_DISCOVERY_TIMEOUT_MS);
  if (!response.ok) throw new Error(safeErrorMessage(await response.text(), response.status));
  const payload = asRecord(await response.json());
  const models = Array.isArray(payload.data) ? payload.data : [];
  const model = stringValue(asRecord(models[0]).id);
  if (!model) throw new Error("AI backend tidak mengirim model yang bisa digunakan.");
  return model;
}

function decodeDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/i);
  if (!match) throw new Error("Attachment memiliki data URL yang tidak valid.");
  const mimeType = match[1] || "application/octet-stream";
  const encoded = match[2];
  const isBase64 = /;base64,/i.test(dataUrl.slice(0, dataUrl.indexOf(",") + 1));
  return {
    mimeType,
    buffer: isBase64 ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded), "utf8"),
  };
}

function dataUrlFromBuffer(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function pdfToImageParts(dataUrl: string, fileName: string): Promise<Array<{ type: "image_url"; image_url: { url: string; detail: "high" } }>> {
  const { buffer } = decodeDataUrl(dataUrl);
  const directory = await mkdtemp(join(tmpdir(), "jamed-pdf-"));
  const inputPath = join(directory, "input.pdf");
  const outputPrefix = join(directory, "page");
  try {
    await writeFile(inputPath, buffer);
    await execFile("pdftoppm", ["-png", "-r", "144", "-f", "1", "-l", "4", inputPath, outputPrefix], { timeout: 30_000 });
    const pages = (await readdir(directory))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    if (!pages.length) throw new Error(`PDF ${fileName} tidak menghasilkan halaman gambar.`);
    return (await Promise.all(pages.map(async (page) => ({
      type: "image_url" as const,
      image_url: { url: dataUrlFromBuffer(await readFile(join(directory, page)), "image/png"), detail: "high" as const },
    }))));
  } catch (error) {
    if (error instanceof Error && /ENOENT/.test(error.message)) {
      throw new Error("PDF membutuhkan pdftoppm/Poppler di server lokal agar bisa dibaca sebagai gambar.");
    }
    throw new Error(`PDF ${fileName} tidak bisa diproses sebagai gambar.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function audioFormat(mimeType: string): string {
  if (/wav/i.test(mimeType)) return "wav";
  if (/mpeg|mp3/i.test(mimeType)) return "mp3";
  if (/mp4|m4a/i.test(mimeType)) return "mp4";
  return "mp3";
}

async function mediaMessageParts(media: ExtractRequest["media"]): Promise<unknown[]> {
  const parts: unknown[] = [];
  for (const item of media ?? []) {
    if (item.kind === "pdf" || /application\/pdf/i.test(item.mimeType)) {
      parts.push(...await pdfToImageParts(item.dataUrl, item.name));
      continue;
    }
    if (item.kind === "image" || /^image\//i.test(item.mimeType)) {
      parts.push({ type: "image_url", image_url: { url: item.dataUrl, detail: "high" } });
      continue;
    }
    if (item.kind === "audio" || /^audio\//i.test(item.mimeType)) {
      const { buffer } = decodeDataUrl(item.dataUrl);
      parts.push({ type: "input_audio", input_audio: { data: buffer.toString("base64"), format: audioFormat(item.mimeType) } });
    }
  }
  return parts;
}

async function callChatCompletion(
  settings: AgentSettings,
  sourceText: string,
  patientLabel?: string,
  shiftContext?: ExtractRequest["shiftContext"],
  templateProfile?: string,
  templateInstructions?: string,
  templateContract?: ExtractRequest["templateContract"],
  media?: ExtractRequest["media"],
): Promise<{ content: string; model: string }> {
  const model = await resolveModel(settings);
  const url = `${settings.baseUrl}/chat/completions`;
  const prompt = `Template profile: ${templateProfile || "generic"}
Template extraction contract: ${templateInstructions || "Use the generic clinical schema and the selected template's mapped slide context."}
Template slide/field contract (JSON): ${JSON.stringify(templateContract || {})}
Workspace context (metadata only, never patient facts): ${JSON.stringify(shiftContext || {})}
Patient input card: ${patientLabel || "Pasien"}

Extract the patient record from this source exactly as documented. Do not use the workspace date, title, hospital, department, team, template profile, or card label as the patient's name or clinical value unless the source explicitly repeats it as patient data.
If structured form values and free text disagree, preserve the conflict in the most relevant field rather than silently choosing a value.

SOURCE:
${sourceText || "(Tidak ada teks; gunakan evidence multimodal yang dilampirkan.)"}`;
  const attachmentParts = await mediaMessageParts(media);
  const userContent = attachmentParts.length ? [{ type: "text", text: prompt }, ...attachmentParts] : prompt;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  const basePayload = { model, temperature: 0, messages, max_tokens: 5000 };
  const request = (withJsonMode: boolean) => fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(withJsonMode ? { ...basePayload, response_format: { type: "json_object" } } : basePayload),
  }, CHAT_TIMEOUT_MS);

  let response = await request(true);
  if (!response.ok && response.status === 400) response = await request(false);
  if (!response.ok) throw new Error(safeErrorMessage(await response.text(), response.status));
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = parseJsonContent(responseText);
  }
  return { content: messageContent(payload), model };
}

async function callTemplateAnalysis(
  settings: AgentSettings,
  body: TemplateAnalyzeRequest,
): Promise<{ content: string; model: string }> {
  const model = await resolveModel(settings);
  const url = `${settings.baseUrl}/chat/completions`;
  const snapshotJson = JSON.stringify(body.snapshot || {});
  const prompt = `Template name: ${body.name || "Template custom"}
Template file: ${body.fileName || "template.pptx"}

Analyze this complete template snapshot. Slide indexes are zero-based and shape IDs must be copied exactly when creating bindings.

TEMPLATE SNAPSHOT:
${snapshotJson}`;
  const messages = [
    { role: "system", content: TEMPLATE_ANALYSIS_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];
  const basePayload = { model, temperature: 0, messages, max_tokens: 8000 };
  const request = (withJsonMode: boolean) => fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(withJsonMode ? { ...basePayload, response_format: { type: "json_object" } } : basePayload),
  }, CHAT_TIMEOUT_MS);

  let response = await request(true);
  if (!response.ok && response.status === 400) response = await request(false);
  if (!response.ok) throw new Error(safeErrorMessage(await response.text(), response.status));
  const responseText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = parseJsonContent(responseText);
  }
  return { content: messageContent(payload), model };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error("Request data terlalu besar."));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Body request bukan JSON yang valid."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function handleExtraction(request: IncomingMessage, response: ServerResponse, settings: AgentSettings): Promise<void> {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Gunakan POST /api/clinical/extract." });
    return;
  }
  if (!settings.baseUrl || !settings.apiKey) {
    sendJson(response, 503, { error: "Konfigurasi AI backend belum lengkap di .env.local." });
    return;
  }
  try {
    const body = asRecord(await readJsonBody(request)) as unknown as ExtractRequest;
    const sourceText = typeof body.sourceText === "string" ? body.sourceText : "";
    const media = Array.isArray(body.media) ? body.media : [];
    if (!sourceText.trim() && !media.length) {
      sendJson(response, 400, { error: "Isi teks, form terstruktur, atau minimal satu attachment multimodal." });
      return;
    }
    if (media.length > MAX_MEDIA_ITEMS) {
      sendJson(response, 413, { error: `Maksimal ${MAX_MEDIA_ITEMS} attachment per pasien.` });
      return;
    }
    const validMedia = media.filter((item) => item && typeof item.dataUrl === "string" && item.dataUrl.length <= MAX_MEDIA_BYTES);
    if (validMedia.length !== media.length) {
      sendJson(response, 413, { error: `Ukuran setiap attachment maksimal ${Math.floor(MAX_MEDIA_BYTES / 1_000_000)} MB.` });
      return;
    }
    const sourceId = typeof body.sourceId === "string" && body.sourceId.trim() ? body.sourceId : `ai-source-${Date.now()}`;
    const result = await callChatCompletion(settings, sourceText, body.patientLabel, body.shiftContext, body.templateProfile, body.templateInstructions, body.templateContract, validMedia);
    const parsed = asRecord(parseJsonContent(result.content));
    const rawPatients = Array.isArray(parsed.patients)
      ? parsed.patients
      : [parsed.patient ?? parsed];
    const patients = rawPatients.map((patient, index) => normalizePatient(patient, sourceText, sourceId, body.patientLabel, index));
    sendJson(response, 200, { engine: "ai", model: result.model, patients });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI agent gagal memproses data klinis.";
    sendJson(response, 502, { error: message });
  }
}

async function handleTemplateAnalysis(request: IncomingMessage, response: ServerResponse, settings: AgentSettings): Promise<void> {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Gunakan POST /api/template/analyze." });
    return;
  }
  if (!settings.baseUrl || !settings.apiKey) {
    sendJson(response, 503, { error: "Konfigurasi AI backend belum lengkap di .env.local." });
    return;
  }
  try {
    const body = asRecord(await readJsonBody(request)) as unknown as TemplateAnalyzeRequest;
    if (!isRecord(body.snapshot)) {
      sendJson(response, 400, { error: "Snapshot template tidak tersedia." });
      return;
    }
    const snapshotSize = JSON.stringify(body.snapshot).length;
    if (snapshotSize > 2_500_000) {
      sendJson(response, 413, { error: "Snapshot template terlalu besar untuk dianalisis." });
      return;
    }
    const result = await callTemplateAnalysis(settings, body);
    const analysis = parseJsonContent(result.content);
    sendJson(response, 200, { engine: "ai", model: result.model, analysis });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Template agent gagal mempelajari template.";
    sendJson(response, 502, { error: message });
  }
}

export function createAiAgentPlugin(env: Record<string, string>): Plugin {
  const settings: AgentSettings = {
    baseUrl: (env.JAMED_AI_BASE_URL || "").replace(/\/$/, ""),
    apiKey: env.JAMED_AI_API_KEY || "",
    model: env.JAMED_AI_MODEL || "",
  };
  const middleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleExtraction(request, response, settings);
  };
  const templateMiddleware = (request: IncomingMessage, response: ServerResponse, _next: Next) => {
    void handleTemplateAnalysis(request, response, settings);
  };

  return {
    name: "jamed-ai-agent",
    configureServer(server) {
      server.middlewares.use("/api/clinical/extract", middleware);
      server.middlewares.use("/api/template/analyze", templateMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/clinical/extract", middleware);
      server.middlewares.use("/api/template/analyze", templateMiddleware);
    },
  };
}
