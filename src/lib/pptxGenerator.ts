import JSZip from "jszip";
import type {
  ClinicalField,
  InvestigationItem,
  OrganFinding,
  ParsedShape,
  ParsedSlide,
  ParsedTemplate,
  PatientAttachment,
  PatientRecord,
  SemanticField,
  ShiftDetails,
  TreatmentItem,
  TemplateBinding,
} from "../types";
import { decodeXml, escapeXml } from "./pptxParser";
import { formatFieldValue } from "./clinicalParser";
import { getTemplateProfile } from "./templateProfiles";

interface GeneratedPresentation {
  blob: Blob;
  fileName: string;
  slideCount: number;
}

const EMU_PER_INCH = 914400;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rawSlideRelationshipPath(slideFileName: string): string {
  const fileName = slideFileName.split("/").pop() ?? slideFileName;
  return `ppt/slides/_rels/${fileName}.rels`;
}

type GrowthChartKind = "lhfa" | "wfa" | "wfl";

const GROWTH_CHART_ASSETS: Record<GrowthChartKind, { girls: string; boys: string }> = {
  lhfa: { girls: "jamed-who-lhfa-girls.png", boys: "jamed-who-lhfa-boys.png" },
  wfa: { girls: "jamed-who-wfa-girls.png", boys: "jamed-who-wfa-boys.png" },
  wfl: { girls: "jamed-who-wfl-girls.png", boys: "jamed-who-wfl-boys.png" },
};

function isLapjagTemplate(template: ParsedTemplate): boolean {
  return template.profileId === "lapjag" || (template.slideCount >= 25 && /lapjag/i.test(`${template.name} ${template.fileName}`));
}

function growthChartKind(slide: ParsedSlide): GrowthChartKind | undefined {
  if (slide.index === 10) return "lhfa";
  if (slide.index === 11) return "wfa";
  if (slide.index === 12) return "wfl";
  return undefined;
}

function sexForChart(patient: PatientRecord): "girls" | "boys" | undefined {
  const value = String(patient.demographics.sex?.value ?? "").toLowerCase();
  if (/(laki|male|pria|boy)/.test(value)) return "boys";
  if (/(perempuan|female|wanita|girl)/.test(value)) return "girls";
  return undefined;
}

function ageInMonths(patient: PatientRecord): number | undefined {
  const value = String(patient.demographics.age?.value ?? "").toLowerCase().replace(/,/g, ".");
  if (!value.trim()) return undefined;
  const years = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:tahun|th|yr|years?)/);
  const months = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:bulan|bln|mo|months?)/);
  if (years || months) {
    return Math.round((years ? Number(years[1]) * 12 : 0) + (months ? Number(months[1]) : 0));
  }
  const numeric = Number(value.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
  return Number.isFinite(numeric) ? numeric : undefined;
}

type PictureBounds = { x: number; y: number; width: number; height: number };

function pictureBoundsList(xml: string): PictureBounds[] {
  return Array.from(xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)).flatMap((match) => {
    const picture = match[0];
    const off = picture.match(/<a:off\b[^>]*>/)?.[0] ?? "";
    const ext = picture.match(/<a:ext\b[^>]*>/)?.[0] ?? "";
    const values = ["x", "y", "cx", "cy"].map((name) => Number(readAttribute(name === "cx" || name === "cy" ? ext : off, name)));
    return values.some((value) => !Number.isFinite(value) || value <= 0)
      ? []
      : [{ x: values[0], y: values[1], width: values[2], height: values[3] }];
  });
}

function pictureBounds(xml: string): PictureBounds | undefined {
  return pictureBoundsList(xml)[0];
}

function growthChartPoint(patient: PatientRecord, kind: GrowthChartKind, bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number; size: number } | undefined {
  const age = ageInMonths(patient);
  const weight = rawFieldValue<number>(patient, "demographics.weightKg");
  const height = rawFieldValue<number>(patient, "demographics.heightCm");
  let xValue: number | undefined;
  let yValue: number | undefined;
  let xMin = 0;
  let xMax = 60;
  let yMin = 0;
  let yMax = 30;
  if (kind === "lhfa") {
    xValue = age;
    yValue = height;
    yMin = 45;
    yMax = 125;
  } else if (kind === "wfa") {
    xValue = age;
    yValue = weight;
    yMin = 0;
    yMax = 30;
  } else {
    xValue = height;
    yValue = weight;
    xMin = 45;
    xMax = 110;
    yMin = 0;
    yMax = 25;
  }
  if (![xValue, yValue].every((value) => typeof value === "number" && Number.isFinite(value))) return undefined;
  if (xValue! < xMin || xValue! > xMax || yValue! < yMin || yValue! > yMax) return undefined;
  // WHO chart plot area inside the official raster: the magenta frame and
  // labels remain untouched while the marker lands in the grid itself.
  const left = 0.132;
  const right = 0.881;
  const top = 0.181;
  const bottom = 0.859;
  const plottedX = Math.min(xMax - 0.5, Math.max(xMin + 0.5, xValue!));
  const plottedY = Math.min(yMax - 0.5, Math.max(yMin + 0.5, yValue!));
  return {
    x: bounds.x + bounds.width * (left + ((plottedX - xMin) / (xMax - xMin)) * (right - left)),
    y: bounds.y + bounds.height * (bottom - ((plottedY - yMin) / (yMax - yMin)) * (bottom - top)),
    size: Math.max(105000, Math.round(Math.min(bounds.width, bounds.height) * 0.018)),
  };
}

function replaceImageRelationshipTarget(xml: string, assetName: string): string {
  return xml.replace(/<Relationship\b[^>]*>/g, (tag) => {
    if (!/Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"/.test(tag)) return tag;
    return tag.replace(/Target="[^"]*"/, `Target="../../media/${assetName}"`);
  });
}

function appendPlotMarker(xml: string, point: { x: number; y: number; size: number }, name: string, fillColor = "C00000"): string {
  if (xml.includes(`name="${name}"`)) return xml;
  const id = maxNumericAttribute(xml, "id") + 1;
  const marker = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(point.x - point.size / 2)}" y="${Math.round(point.y - point.size / 2)}"/><a:ext cx="${point.size}" cy="${point.size}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fillColor}"/></a:solidFill><a:ln w="25400"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:prstDash val="solid"/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
  return xml.replace(/<\/p:spTree>/, `${marker}</p:spTree>`);
}

function appendGrowthPlotMarker(xml: string, point: { x: number; y: number; size: number }): string {
  return appendPlotMarker(xml, point, "JaMed WHO plot marker");
}

async function applyLapjagChartAssets(
  zip: JSZip,
  template: ParsedTemplate,
  slide: ParsedSlide,
  patient: PatientRecord,
  xml: string,
  relationshipPath: string,
): Promise<string> {
  if (!isLapjagTemplate(template)) return xml;
  const kind = growthChartKind(slide);
  if (!kind) return xml;
  const sex = sexForChart(patient);
  const assetName = GROWTH_CHART_ASSETS[kind][sex ?? "girls"];
  const assetPath = `ppt/media/${assetName}`;
  if (zip.file(assetPath)) {
    const relationshipsFile = zip.file(relationshipPath);
    if (relationshipsFile) {
      const relationships = await relationshipsFile.async("string");
      zip.file(relationshipPath, replaceImageRelationshipTarget(relationships, assetName));
    }
  }
  const bounds = pictureBounds(xml);
  const point = bounds && sex ? growthChartPoint(patient, kind, bounds) : undefined;
  return point ? appendGrowthPlotMarker(xml, point) : xml;
}

function numericMeasurement(patient: PatientRecord, path: string): number | undefined {
  const value = rawFieldValue<unknown>(patient, path);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").replace(/,/g, ".").match(/[-+]?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function gestationalAgeInWeeks(patient: PatientRecord): number | undefined {
  const raw = String(rawFieldValue<unknown>(patient, "templateData.gestationalAge") ?? "").toLowerCase().replace(/,/g, ".");
  const plusNotation = raw.match(/(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)/);
  if (plusNotation) return Number(plusNotation[1]) + Number(plusNotation[2]) / 7;
  const weeks = raw.match(/(\d+(?:\.\d+)?)\s*(?:minggu|mg|wk|weeks?)/);
  if (!weeks) return undefined;
  const days = raw.match(/(\d+(?:\.\d+)?)\s*(?:hari|hr|d)\b/);
  return Number(weeks[1]) + (days ? Number(days[1]) / 7 : 0);
}

function neonatalChartPoint(
  bounds: PictureBounds,
  xValue: number | undefined,
  yValue: number | undefined,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  plot: { left: number; right: number; top: number; bottom: number },
): { x: number; y: number; size: number } | undefined {
  if (![xValue, yValue].every((value) => typeof value === "number" && Number.isFinite(value))) return undefined;
  if (xValue! < xMin || xValue! > xMax || yValue! < yMin || yValue! > yMax) return undefined;
  const x = plot.left + ((xValue! - xMin) / (xMax - xMin)) * (plot.right - plot.left);
  const y = plot.bottom - ((yValue! - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);
  return {
    x: bounds.x + bounds.width * x,
    y: bounds.y + bounds.height * y,
    size: Math.max(120000, Math.round(Math.min(bounds.width, bounds.height) * 0.035)),
  };
}

function applyPerinaChartAssets(template: ParsedTemplate, slide: ParsedSlide, patient: PatientRecord, xml: string): string {
  if (!["perina-lapjag", "perina-rsab"].includes(template.profileId) || slide.index !== 7) return xml;
  const pictures = pictureBoundsList(xml);
  if (pictures.length < 2) return xml;
  const gestationalAge = gestationalAgeInWeeks(patient);
  const weight = numericMeasurement(patient, "demographics.weightKg");
  const height = numericMeasurement(patient, "demographics.heightCm");
  const headCircumference = numericMeasurement(patient, "templateData.headCircumference");
  const points = [
    {
      name: "Koasis PERINA weight-for-gestational-age marker",
      point: neonatalChartPoint(pictures[0], gestationalAge, weight, 28, 64, 0, 12, { left: 0.105, right: 0.852, top: 0.028, bottom: 0.955 }),
    },
    {
      name: "Koasis PERINA length-for-gestational-age marker",
      point: neonatalChartPoint(pictures[1], gestationalAge, height, 28, 64, 24, 75, { left: 0.108, right: 0.87, top: 0.028, bottom: 0.718 }),
    },
    {
      name: "Koasis PERINA head-circumference marker",
      point: neonatalChartPoint(pictures[1], gestationalAge, headCircumference, 28, 64, 18, 38, { left: 0.108, right: 0.87, top: 0.797, bottom: 0.962 }),
    },
  ];
  return points.reduce((result, item) => item.point ? appendPlotMarker(result, item.point, item.name, "C00000") : result, xml);
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`));
  return match?.[1];
}

function valueAtPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, root);
}

function fieldValue(value: unknown): string {
  if (value && typeof value === "object" && "status" in value) {
    return formatFieldValue(value as ClinicalField<unknown>);
  }
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  return value === undefined || value === null || value === "" ? "Tidak tercantum" : String(value);
}

function rawFieldValue<T>(root: unknown, path: string): T | undefined {
  const value = valueAtPath(root, path);
  if (value && typeof value === "object" && "status" in value) {
    return (value as ClinicalField<T>).value;
  }
  return value as T | undefined;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function blockLine(label: string, value: string | undefined, maxLength = 320): string {
  const text = value?.trim() || "Tidak tercantum";
  return `${label}: ${compactText(text, maxLength)}`;
}

function optionalText(value: string | undefined): string {
  return value && value !== "Tidak tercantum" && value.trim() ? value.trim() : "";
}

function optionalBlockLine(label: string, value: string | undefined, maxLength = 320): string {
  const text = optionalText(value);
  return text ? `${label}: ${compactText(text, maxLength)}` : "";
}

function presentLines(lines: string[], fallback = "Tidak tercantum"): string {
  const present = lines.map((line) => line.trim()).filter(Boolean);
  return present.length ? present.join("\n") : fallback;
}

function pediatricSectionLines(rawValue: string, fields: Array<[string, string]>, maxLength = 180): string[] {
  const raw = rawValue === "Tidak tercantum" ? "" : rawValue;
  const boundary = fields.map(([, pattern]) => pattern).join("|");
  const values = fields.map(([label, pattern]) => {
    const match = raw.match(new RegExp(`${pattern}\\s*[:：-]?\\s*(.*?)(?=\\s+(?:${boundary})\\s*[:：-]?|$)`, "i"));
    return [label, match?.[1]?.trim() || "Tidak tercantum"] as const;
  });
  if (raw && values.every(([, value]) => value === "Tidak tercantum")) values[0] = [values[0][0], raw];
  return values.map(([label, value]) => optionalBlockLine(label, value, maxLength)).filter(Boolean);
}

function patientText(patient: PatientRecord, path: string, maxLength = 320): string {
  return compactText(fieldValue(valueAtPath(patient, path)), maxLength);
}

function neonatalBallardScore(patient: PatientRecord): string {
  const value = patientText(patient, "templateData.ballardScore", 120);
  const score = value.match(/\d+(?:[.,]\d+)?/)?.[0];
  return score || value;
}

function treatmentLines(patient: PatientRecord, path: string): string[] {
  const values = rawFieldValue<TreatmentItem[]>(patient, path) ?? [];
  if (!values.length) return ["Tidak tercantum"];
  return values.map((item) => [item.name, item.dose, item.route, item.frequency].filter(Boolean).join(" · "));
}

function investigationLines(patient: PatientRecord, path: string): string[] {
  const values = rawFieldValue<InvestigationItem[]>(patient, path) ?? [];
  if (!values.length) return ["Tidak tercantum"];
  return values.map((item) => [item.name, item.result, item.unit].filter(Boolean).join(" · "));
}

function imagingEvidenceLines(patient: PatientRecord): string[] {
  const lines = investigationLines(patient, "investigations.imaging");
  if (!(lines.length === 1 && lines[0] === "Tidak tercantum")) return lines;
  const attachments = (patient.attachments ?? []).filter((attachment) => attachment.kind === "image");
  return attachments.length ? attachments.map((attachment) => `Evidence gambar: ${attachment.name}`) : lines;
}

function organFindingLines(patient: PatientRecord): string[] {
  const values = rawFieldValue<OrganFinding[]>(patient, "physicalExam.organFindings") ?? [];
  if (!values.length) return [patientText(patient, "templateData.organFindingsNote", 1100) === "Tidak tercantum" ? patientText(patient, "physicalExam.findings", 1100) : patientText(patient, "templateData.organFindingsNote", 1100)];
  return values.map((item) => `${item.organ}: ${compactText(item.description, 230)}`);
}

function templateHasValue(patient: PatientRecord, paths: string[]): boolean {
  return paths.some((path) => {
    const value = rawFieldValue<string>(patient, path);
    return typeof value === "string" && value.trim().length > 0;
  });
}

function textList(value: string): string[] {
  return value.split(/\n|[,;]/).map((item) => item.trim()).filter(Boolean);
}

function patientSummaryIdentity(patient: PatientRecord): string {
  const identity = rawFieldValue<string>(patient, "identifiers.initials") || rawFieldValue<string>(patient, "identifiers.name") || patient.displayName;
  const sex = rawFieldValue<string>(patient, "demographics.sex");
  const age = rawFieldValue<string>(patient, "demographics.age");
  return [identity, sex, age].filter(Boolean).join(" / ") || "Tidak tercantum";
}

function patientUrgency(patient: PatientRecord, asBooleanWords = false): string {
  const value = String(rawFieldValue<string>(patient, "urgency") ?? "").trim().toLowerCase();
  if (["t", "true"].includes(value)) return asBooleanWords ? "True" : "T";
  if (["f", "false"].includes(value)) return asBooleanWords ? "False" : "F";
  return "Tidak tercantum";
}

function shiftMetadataValue(shift: ShiftDetails, key: string): string {
  if (key === "student") return shift.metadata?.student || "";
  if (key === "ppds") return shift.metadata?.ppds || "";
  if (key === "presenter") return shift.metadata?.presenter || "";
  if (key === "perinaTeam") return shift.metadata?.perinaTeam || "";
  if (key === "team" || key === "department" || key === "hospital" || key === "facilitator" || key === "dpjp") {
    return String((shift as unknown as Record<string, unknown>)[key] ?? "");
  }
  return shift.metadata?.[key] || "";
}

function formatShiftCover(shift: ShiftDetails, template?: ParsedTemplate): string {
  const profileId = template?.profileId;
  if (template?.templateAnalysis) {
    const profile = getTemplateProfile(template);
    if (profile.shiftFields.length) {
      return profile.shiftFields.map((fieldSpec) => blockLine(fieldSpec.label, shiftMetadataValue(shift, fieldSpec.key))).join("\n");
    }
  }
  if (profileId === "lapjag") {
    return [
      blockLine("Tim mahasiswa jaga", shift.team),
      blockLine("Fasilitator Laporan Jaga", shift.facilitator),
      blockLine("DPJP Jaga", shift.dpjp),
    ].join("\n");
  }
  if (profileId === "perina-lapjag") {
    return [
      blockLine("Mahasiswa", shiftMetadataValue(shift, "student")),
      blockLine("Tim Jaga Perinatologi", shiftMetadataValue(shift, "perinaTeam")),
      blockLine("DPJP Perinatologi", shift.dpjp),
    ].join("\n");
  }
  if (profileId === "perina-rsab") {
    return [
      blockLine("Mahasiswa", shiftMetadataValue(shift, "student")),
      blockLine("DPJP IGD", shift.dpjp),
    ].join("\n");
  }
  if (profileId === "rscm") {
    return [
      blockLine("Tim mahasiswa jaga", shift.team),
      blockLine("Tim PPDS Jaga", shiftMetadataValue(shift, "ppds")),
      blockLine("DPJP Jaga", shift.dpjp),
    ].join("\n");
  }
  if (profileId === "rsui") {
    return [
      blockLine("Nama penyaji", shiftMetadataValue(shift, "presenter")),
      blockLine("Tanggal", coverDateLabel(shift.date)),
    ].join("\n");
  }
  return [
    blockLine("Tim mahasiswa jaga", shift.team),
    blockLine("Departemen", shift.department),
    blockLine("Rumah sakit", shift.hospital),
  ].join("\n");
}

function formatPatientBlock(semanticField: SemanticField, patient: PatientRecord): string {
  switch (semanticField) {
    case "patient.identityBlock":
      return presentLines([
        optionalBlockLine("Nama", patientText(patient, "identifiers.name")),
        optionalBlockLine("Usia", patientText(patient, "demographics.age")),
        optionalBlockLine("Jenis kelamin", patientText(patient, "demographics.sex")),
        optionalBlockLine("No. RM", patientText(patient, "identifiers.medicalRecordNumber")),
        optionalBlockLine("Tanggal lahir", patientText(patient, "templateData.dateOfBirth")),
        optionalBlockLine("Alamat", patientText(patient, "templateData.address", 260)),
      ]);
    case "patient.historyBlock":
      return presentLines([
        optionalBlockLine("RPS", patientText(patient, "history.presentIllness", 560)),
        optionalBlockLine("RPD", patientText(patient, "history.pastMedicalHistory", 360)),
        optionalBlockLine("Alergi", patientText(patient, "history.allergyHistory", 220)),
        optionalBlockLine("Riwayat obat", patientText(patient, "history.medicationHistory", 300)),
        optionalBlockLine("Riwayat lahir", patientText(patient, "history.birthHistory", 360)),
        optionalBlockLine("Riwayat keluarga", patientText(patient, "history.familyHistory", 300)),
        optionalBlockLine("Riwayat nutrisi", patientText(patient, "history.nutritionHistory", 300)),
        optionalBlockLine("Sosioekonomi", patientText(patient, "history.socioeconomicHistory", 260)),
      ]);
    case "patient.pediatricAssessmentBlock":
      return presentLines([
        optionalBlockLine("Behaviour", patientText(patient, templateHasValue(patient, ["templateData.patBehaviour"]) ? "templateData.patBehaviour" : "physicalExam.generalAppearance", 220)),
        optionalBlockLine("Breathing", patientText(patient, templateHasValue(patient, ["templateData.patBreathing"]) ? "templateData.patBreathing" : "physicalExam.findings", 520)),
        optionalBlockLine("Kesimpulan", patientText(patient, "assessment.workingDiagnosis", 300)),
      ]);
    case "patient.pediatricAssessment.leftBlock":
      if (templateHasValue(patient, ["templateData.patBehaviour", "templateData.patInteractiveness", "templateData.patConsolability", "templateData.patLookOrGaze"])) {
        return presentLines([
          optionalBlockLine("Behaviour / Tonus", patientText(patient, "templateData.patBehaviour", 180)),
          optionalBlockLine("Interactiveness", patientText(patient, "templateData.patInteractiveness", 180)),
          optionalBlockLine("Consolability", patientText(patient, "templateData.patConsolability", 180)),
          optionalBlockLine("Look or gaze", patientText(patient, "templateData.patLookOrGaze", 180)),
        ]);
      }
      return presentLines(pediatricSectionLines(patientText(patient, "physicalExam.generalAppearance", 900), [
        ["Behaviour / Tonus", "behaviour\\s*[/ ]?\\s*tonus|behaviourtonus|tonus"],
        ["Interactiveness", "interactiveness"],
        ["Consolability", "consolability"],
        ["Look or gaze", "look\\s+or\\s+gaze"],
      ]));
    case "patient.pediatricAssessment.rightBlock":
      if (templateHasValue(patient, ["templateData.patBreathing", "templateData.patRetraction", "templateData.patNasalFlaring", "templateData.patAddedBreathSounds", "templateData.patAbnormalPosition"])) {
        return presentLines([
          optionalBlockLine("Breathing", patientText(patient, "templateData.patBreathing", 180)),
          optionalBlockLine("Retraksi", patientText(patient, "templateData.patRetraction", 180)),
          optionalBlockLine("Nafas cuping hidung", patientText(patient, "templateData.patNasalFlaring", 180)),
          optionalBlockLine("Suara nafas tambahan", patientText(patient, "templateData.patAddedBreathSounds", 180)),
          optionalBlockLine("Posisi abnormal", patientText(patient, "templateData.patAbnormalPosition", 180)),
        ]);
      }
      return presentLines(pediatricSectionLines(patientText(patient, "physicalExam.findings", 1000), [
        ["Breathing", "breathing"],
        ["Retraksi", "retraksi"],
        ["Nafas cuping hidung", "nafas\\s+cuping\\s+hidung|cuping\\s+hidung"],
        ["Suara nafas tambahan", "suara\\s+nafas\\s+tambahan"],
        ["Posisi abnormal", "posisi\\s+abnormal"],
      ]));
    case "patient.primarySurveyBlock":
      if (templateHasValue(patient, ["templateData.primarySurvey"])) return patientText(patient, "templateData.primarySurvey", 1100);
      return presentLines([
        optionalBlockLine("Airway", patientText(patient, "templateData.airway", 220)),
        optionalBlockLine("Breathing", patientText(patient, "physicalExam.vitalSigns.respiratoryRate", 120)),
        optionalBlockLine("Circulation", [optionalText(patientText(patient, "physicalExam.vitalSigns.bloodPressure", 120)), optionalText(`HR ${patientText(patient, "physicalExam.vitalSigns.heartRate", 80)}`)].filter((value) => value && value !== "HR ").join(" · ")),
        optionalBlockLine("Disability", patientText(patient, "physicalExam.consciousness", 180)),
        optionalBlockLine("Exposure", patientText(patient, "templateData.exposure", 420)),
      ]);
    case "patient.secondarySurveyBlock":
      if (templateHasValue(patient, ["templateData.secondarySurvey"])) return patientText(patient, "templateData.secondarySurvey", 1100);
      return presentLines([
        optionalBlockLine("Allergy", patientText(patient, "history.allergyHistory", 240)),
        optionalBlockLine("Medication history", patientText(patient, "history.medicationHistory", 360)),
        optionalBlockLine("Past illness", patientText(patient, "history.pastMedicalHistory", 420)),
        optionalBlockLine("Last meal", patientText(patient, "templateData.lastMeal", 220)),
        optionalBlockLine("Event", patientText(patient, "templateData.event", 360)),
      ]);
    case "patient.anthropometryBlock":
      return presentLines([
        optionalBlockLine("BB", patientText(patient, "demographics.weightKg", 80)),
        optionalBlockLine("TB", patientText(patient, "demographics.heightCm", 80)),
        optionalBlockLine("LK", patientText(patient, "templateData.headCircumference", 80)),
        optionalBlockLine("LiLA", patientText(patient, "templateData.muac", 80)),
        optionalBlockLine("Usia gestasi", patientText(patient, "templateData.gestationalAge", 100)),
        optionalBlockLine("BB/U", patientText(patient, "templateData.weightForAge", 100)),
        optionalBlockLine("TB/U", patientText(patient, "templateData.heightForAge", 100)),
        optionalBlockLine("BB/TB", patientText(patient, "templateData.weightForHeight", 100)),
        optionalBlockLine("Height age", patientText(patient, "templateData.heightAge", 100)),
        optionalBlockLine("RDA", patientText(patient, "templateData.rda", 100)),
        optionalBlockLine("Ballard score", patientText(patient, "templateData.ballardScore", 100)),
        optionalBlockLine("Usia", patientText(patient, "demographics.age", 100)),
        optionalBlockLine("BB sebelum sakit", patientText(patient, "templateData.weightBeforeIllness", 100)),
        optionalBlockLine("Kesan gizi", patientText(patient, "templateData.nutritionConclusion", 300)),
      ]);
    case "patient.physicalExamBlock":
      return presentLines([
        optionalBlockLine("Keadaan umum", patientText(patient, "physicalExam.generalAppearance", 220)),
        optionalBlockLine("Kesadaran", patientText(patient, "physicalExam.consciousness", 180)),
        optionalBlockLine("Tekanan darah", patientText(patient, "physicalExam.vitalSigns.bloodPressure", 90)),
        optionalBlockLine("Nadi", patientText(patient, "physicalExam.vitalSigns.heartRate", 90)),
        optionalBlockLine("Laju napas", patientText(patient, "physicalExam.vitalSigns.respiratoryRate", 90)),
        optionalBlockLine("Suhu", patientText(patient, "physicalExam.vitalSigns.temperature", 90)),
        optionalBlockLine("SpO₂", patientText(patient, "physicalExam.vitalSigns.spo2", 90)),
        rawFieldValue<OrganFinding[]>(patient, "physicalExam.organFindings")?.length ? "" : optionalBlockLine("Temuan", patientText(patient, "physicalExam.findings", 600)),
      ]);
    case "patient.investigationsBlock":
      return presentLines([
        rawFieldValue<InvestigationItem[]>(patient, "investigations.laboratory")?.length ? "Laboratorium:" : "",
        ...((rawFieldValue<InvestigationItem[]>(patient, "investigations.laboratory") || []).map((item) => [item.name, item.result, item.unit].filter(Boolean).join(" · "))),
        rawFieldValue<InvestigationItem[]>(patient, "investigations.imaging")?.length ? "Radiologi:" : "",
        ...((rawFieldValue<InvestigationItem[]>(patient, "investigations.imaging") || []).map((item) => [item.name, item.result, item.unit].filter(Boolean).join(" · "))),
      ]);
    case "patient.investigations.summary":
      return investigationLines(patient, "investigations.laboratory").join("; ");
    case "patient.assessmentBlock":
      return presentLines([
        optionalBlockLine("Diagnosis awal", patientText(patient, "templateData.initialDiagnosis", 420)),
        optionalBlockLine("Diagnosis kerja", patientText(patient, "assessment.workingDiagnosis", 520)),
        optionalBlockLine("Diagnosis banding", patientText(patient, "assessment.differentialDiagnosis", 420)),
        optionalBlockLine("Diagnosis final", patientText(patient, "templateData.finalDiagnosis", 420)),
      ]);
    case "patient.assessment.summary":
      return patientText(patient, "assessment.workingDiagnosis", 360);
    case "patient.managementBlock":
      return presentLines([
        optionalBlockLine("Tata laksana awal", patientText(patient, "templateData.initialManagement", 520)),
        (rawFieldValue<TreatmentItem[]>(patient, "management.medications") || []).length ? `Obat: ${treatmentLines(patient, "management.medications").join("; ")}` : "",
        (rawFieldValue<TreatmentItem[]>(patient, "management.fluids") || []).length ? `Cairan: ${treatmentLines(patient, "management.fluids").join("; ")}` : "",
        (rawFieldValue<TreatmentItem[]>(patient, "management.procedures") || []).length ? `Tindakan: ${treatmentLines(patient, "management.procedures").join("; ")}` : "",
        (rawFieldValue<TreatmentItem[]>(patient, "management.oxygenTherapy") || []).length ? `Oksigen: ${treatmentLines(patient, "management.oxygenTherapy").join("; ")}` : "",
      ]);
    case "patient.timelineBlock": {
      const timeline = patient.timeline.map((event) => [event.timestamp, event.description].filter(Boolean).join(" · "));
      return timeline.length ? timeline.map((item) => compactText(item, 260)).join("\n") : "Tidak tercantum";
    }
    case "patient.nutritionBlock":
      return presentLines([
        optionalBlockLine("Riwayat nutrisi", patientText(patient, "history.nutritionHistory", 560)),
        optionalBlockLine("BB", patientText(patient, "demographics.weightKg", 80)),
        optionalBlockLine("TB", patientText(patient, "demographics.heightCm", 80)),
        optionalBlockLine("Kesan gizi", patientText(patient, "templateData.nutritionConclusion", 320)),
        optionalBlockLine("Tata laksana nutrisi", patientText(patient, "templateData.nutritionManagement", 420)),
      ]);
    case "patient.physicalExam.organFindings":
      return organFindingLines(patient).join("\n");
    case "patient.investigations.laboratory":
      return investigationLines(patient, "investigations.laboratory").join("\n");
    default:
      return fieldValue(valueAtPath(patient, semanticField.replace(/^patient\./, "")));
  }
}

function templateSectionText(patient: PatientRecord, key: string): string {
  const direct = patientText(patient, `templateData.${key}`, 1400);
  if (direct !== "Tidak tercantum") return direct;
  switch (key) {
    case "previousDeliveries": return patientText(patient, "history.birthHistory", 1100);
    case "pregnancyBirth": return patientText(patient, "history.birthHistory", 1100);
    case "initialDiagnosis": return "Tidak tercantum";
    case "finalDiagnosis": return "Tidak tercantum";
    case "initialManagement": return formatPatientBlock("patient.managementBlock", patient);
    case "finalManagement": return "Tidak tercantum";
    case "neonatalVitals":
      return presentLines([
        optionalBlockLine("Denyut jantung", patientText(patient, "physicalExam.vitalSigns.heartRate", 90)),
        optionalBlockLine("Laju napas", patientText(patient, "physicalExam.vitalSigns.respiratoryRate", 90)),
        optionalBlockLine("Suhu", patientText(patient, "physicalExam.vitalSigns.temperature", 90)),
        optionalBlockLine("Saturasi O₂", patientText(patient, "physicalExam.vitalSigns.spo2", 90)),
      ]);
    case "stableStabilization": return "Tidak tercantum";
    case "neonatalManagement": return "Tidak tercantum";
    case "neonatalAnthropometryConclusion": {
      const neonatalConclusion = patientText(patient, "templateData.neonatalAnthropometryConclusion", 600);
      return neonatalConclusion === "Tidak tercantum" ? patientText(patient, "templateData.nutritionConclusion", 600) : neonatalConclusion;
    }
    case "supportingInvestigations": return formatPatientBlock("patient.investigationsBlock", patient);
    case "radiology": return imagingEvidenceLines(patient).join("\n");
    case "otherExaminations": return investigationLines(patient, "investigations.other").join("\n");
    case "emergencyManagement": return formatPatientBlock("patient.managementBlock", patient);
    case "growthDevelopment": return patientText(patient, "templateData.growthDevelopment", 1000);
    default: return "Tidak tercantum";
  }
}

function templateAnthropometryText(patient: PatientRecord, template?: ParsedTemplate): string {
  if (template?.profileId === "perina-lapjag" || template?.profileId === "perina-rsab") {
    return [
      blockLine("BB", patientText(patient, "demographics.weightKg", 80)),
      blockLine("TB", patientText(patient, "demographics.heightCm", 80)),
      blockLine("LK", patientText(patient, "templateData.headCircumference", 80)),
      blockLine("Ballard score", neonatalBallardScore(patient), 40),
    ].join("\n");
  }
  if (template?.profileId === "rscm") {
    return presentLines([
      optionalBlockLine("BB", patientText(patient, "demographics.weightKg", 80)),
      optionalBlockLine("TB", patientText(patient, "demographics.heightCm", 80)),
      optionalBlockLine("BB/U", patientText(patient, "templateData.weightForAge", 100)),
      optionalBlockLine("TB/U", patientText(patient, "templateData.heightForAge", 100)),
      optionalBlockLine("BB/TB", patientText(patient, "templateData.weightForHeight", 100)),
      optionalBlockLine("Height age", patientText(patient, "templateData.heightAge", 100)),
      optionalBlockLine("RDA", patientText(patient, "templateData.rda", 100)),
      optionalBlockLine("Kesan gizi", patientText(patient, "templateData.nutritionConclusion", 280)),
    ]);
  }
  if (template?.profileId === "rsui") {
    return presentLines([
      optionalBlockLine("BB", patientText(patient, "demographics.weightKg", 80)),
      optionalBlockLine("TB", patientText(patient, "demographics.heightCm", 80)),
      optionalBlockLine("Lingkar kepala", patientText(patient, "templateData.headCircumference", 100)),
      optionalBlockLine("LiLA", patientText(patient, "templateData.muac", 100)),
      optionalBlockLine("BB/U", patientText(patient, "templateData.weightForAge", 100)),
      optionalBlockLine("TB/U", patientText(patient, "templateData.heightForAge", 100)),
      optionalBlockLine("BB/TB", patientText(patient, "templateData.weightForHeight", 100)),
      optionalBlockLine("Kesan gizi", patientText(patient, "templateData.nutritionConclusion", 280)),
    ]);
  }
  return formatPatientBlock("patient.anthropometryBlock", patient);
}

interface RenderContext {
  slide?: ParsedSlide;
  shapeText?: string;
}

function inferTemplateKey(context?: RenderContext): string | undefined {
  const text = `${context?.slide?.title || ""} ${context?.shapeText || ""}`.toLowerCase();
  if (context?.slide?.role === "anthropometry" || /^kesan\s*[:：]/.test(context?.shapeText || "")) return "nutritionConclusion";
  if (context?.slide?.role === "diagnosis" && /(?:akhir|final)/.test(text)) return "finalDiagnosis";
  if (context?.slide?.role === "diagnosis") return "initialDiagnosis";
  if (context?.slide?.role === "management" && /(?:gizi|nutrisi)/.test(text)) return "nutritionManagement";
  if (context?.slide?.role === "management" && /(?:akhir|final)/.test(text)) return "finalManagement";
  if (context?.slide?.role === "management") return "initialManagement";
  if (context?.slide?.role === "investigation") return "supportingInvestigations";
  return undefined;
}

function contentForField(
  semanticField: SemanticField,
  patient: PatientRecord | undefined,
  shift: ShiftDetails,
  template?: ParsedTemplate,
  templateKey?: string,
  context?: RenderContext,
): string | undefined {
  if (semanticField === "static") return undefined;
  if (semanticField === "shift.coverBlock") return formatShiftCover(shift, template);
  if (semanticField === "shift.patientSummaryTable") return undefined;
  if (semanticField === "shift.student") return shiftMetadataValue(shift, "student") || "Tidak tercantum";
  if (semanticField === "shift.ppds") return shiftMetadataValue(shift, "ppds") || "Tidak tercantum";
  if (semanticField === "shift.presenter") return [blockLine("Nama penyaji", shiftMetadataValue(shift, "presenter")), blockLine("Tanggal", coverDateLabel(shift.date))].join("\n");
  if (semanticField === "shift.perinaTeam") return shiftMetadataValue(shift, "perinaTeam") || "Tidak tercantum";
  if (semanticField === "shift.custom") return shiftMetadataValue(shift, templateKey || "") || "Tidak tercantum";
  if (semanticField.startsWith("shift.")) return fieldValue(valueAtPath(shift, semanticField.slice("shift.".length)));
  if (!patient || !semanticField.startsWith("patient.")) return "Tidak tercantum";
  if (semanticField === "patient.templateSection") return templateSectionText(patient, templateKey || inferTemplateKey(context) || "");
  if (semanticField === "patient.anthropometryBlock") return templateAnthropometryText(patient, template);
  if (semanticField === "patient.assessment.summary" && context?.slide?.role === "anthropometry") return templateSectionText(patient, "nutritionConclusion");
  if (semanticField === "patient.assessment.summary" && context?.slide?.role === "diagnosis" && /(?:akhir|final)/i.test(`${context.slide.title} ${context.shapeText || ""}`)) return templateSectionText(patient, "finalDiagnosis");
  if (semanticField === "patient.investigations.imaging") return imagingEvidenceLines(patient).join("\n");
  if (semanticField.includes("Block") || semanticField.endsWith("summary") || semanticField === "patient.physicalExam.organFindings" || semanticField === "patient.investigations.laboratory") {
    return formatPatientBlock(semanticField, patient);
  }
  if (semanticField === "patient.managementTable") return undefined;
  return fieldValue(valueAtPath(patient, semanticField.slice("patient.".length)));
}

function contextualReplacement(original: string, replacement: string): string {
  const trimmed = original.trim();
  const colon = trimmed.search(/[:：]/);
  if (colon >= 0 && !/^[:：]/.test(trimmed)) {
    return `${trimmed.slice(0, colon + 1)} ${replacement}`;
  }
  return replacement;
}

function ensureTextAutoFit(block: string): string {
  const autoFit = '<a:normAutofit fontScale="65000" lnSpcReduction="20000"/>';
  if (/<a:normAutofit\b/.test(block)) return block.replace(/<a:normAutofit\b[^>]*\/>/, autoFit);
  if (/<a:(?:spAutoFit|noAutofit)\s*\/>/.test(block)) return block.replace(/<a:(?:spAutoFit|noAutofit)\s*\/>/, autoFit);
  if (/<a:bodyPr\b[^>]*\/>/.test(block)) return block.replace(/<a:bodyPr\b([^>]*)\/>/, `<a:bodyPr$1>${autoFit}</a:bodyPr>`);
  return block.replace(/<\/a:bodyPr>/, `${autoFit}</a:bodyPr>`);
}

function isAbnormalClinicalLine(line: string): boolean {
  if (/(?:tidak tercantum|tidak ada|tidak ditemukan|tanpa|normal|negatif|disangkal)/i.test(line)) return false;
  return /(abnormal|distres|distress|retraksi|sianosis|cyanosis|stridor|wheez|ronki|mengi|apnea|hipotensi|takikardi|bradikardi|demam|hipotermia|edema|pucat|kejang|penurunan kesadaran)/i.test(line);
}

function highlightedRunProperties(runProperties: string): string {
  const highlight = '<a:highlight><a:srgbClr val="F4CCCC"/></a:highlight>';
  if (runProperties.includes("</a:rPr>")) return runProperties.replace("</a:rPr>", `${highlight}</a:rPr>`);
  if (runProperties.endsWith("/>") || runProperties.endsWith(" />")) return runProperties.replace(/\s*\/\>\s*$/, `>${highlight}</a:rPr>`);
  return `<a:rPr>${highlight}</a:rPr>`;
}

function replaceTextBody(block: string, replacement: string, autoFit = false, highlightAbnormal = false): string {
  const paragraphMatcher = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/g;
  let firstParagraph = true;
  const replaced = block.replace(paragraphMatcher, (paragraph) => {
    if (!firstParagraph) return "";
    firstParagraph = false;
    const paragraphProperties = paragraph.match(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/)?.[0] ?? "";
    const runProperties = paragraph.match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/)?.[0] ?? "";
    const endParagraphProperties = paragraph.match(/<a:endParaRPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/)?.[0] ?? "";
    return replacement.split(/\r?\n/).map((line) => `<a:p>${paragraphProperties}<a:r>${highlightAbnormal && isAbnormalClinicalLine(line) ? highlightedRunProperties(runProperties) : runProperties}<a:t>${escapeXml(line)}</a:t></a:r>${endParagraphProperties}</a:p>`).join("");
  });
  return autoFit ? ensureTextAutoFit(replaced) : replaced;
}

function replaceShapeText(xml: string, shapeId: string, replacement: string, preservePrefix = true, highlightAbnormal = false): string {
  const shapeMatcher = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  return xml.replace(shapeMatcher, (block) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    if (readAttribute(cNvPr, "id") !== shapeId) return block;
    const originalText = Array.from(block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map((match) => decodeXml(match[1])).join("");
    const next = preservePrefix ? contextualReplacement(originalText, replacement) : replacement;
    return replaceTextBody(block, next, true, highlightAbnormal);
  });
}

function appendShapeText(xml: string, shapeId: string, replacement: string, highlightAbnormal = false): string {
  const shapeMatcher = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  return xml.replace(shapeMatcher, (block) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    if (readAttribute(cNvPr, "id") !== shapeId) return block;
    const originalText = Array.from(block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map((match) => decodeXml(match[1])).join("").trim();
    const next = originalText ? `${originalText}\n${replacement}` : replacement;
    return replaceTextBody(block, next, true, highlightAbnormal);
  });
}

function appendEditableTextBox(xml: string, text: string, bounds: { x: number; y: number; width: number; height: number }, name: string): string {
  if (xml.includes(`name="${name}"`)) return xml;
  const id = maxNumericAttribute(xml, "id") + 1;
  const toEmu = (value: number) => Math.round(value * EMU_PER_INCH);
  const paragraphs = text.split(/\r?\n/).map((line) => `<a:p><a:r><a:rPr lang="en-US" sz="1500"/><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="en-US" sz="1500"/></a:p>`).join("");
  const shape = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${toEmu(bounds.x)}" y="${toEmu(bounds.y)}"/><a:ext cx="${toEmu(bounds.width)}" cy="${toEmu(bounds.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit fontScale="65000" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
  return xml.replace(/<\/p:spTree>/, `${shape}</p:spTree>`);
}

function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } | undefined {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match || typeof atob !== "function") return undefined;
  try {
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { bytes, mimeType: match[1].toLowerCase() };
  } catch {
    return undefined;
  }
}

function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  if (mimeType === "image/png" && bytes.length >= 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) break;
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + segmentLength;
    }
  }
  return undefined;
}

function imageFileExtension(attachment: PatientAttachment, mimeType: string): "png" | "jpg" | undefined {
  if (mimeType === "image/png" || /\.png$/i.test(attachment.name)) return "png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg" || /\.jpe?g$/i.test(attachment.name)) return "jpg";
  return undefined;
}

function fitImageToSlot(shape: ParsedShape, dimensions: { width: number; height: number } | undefined): PictureBounds | undefined {
  if ([shape.x, shape.y, shape.width, shape.height].some((value) => typeof value !== "number" || value <= 0)) return undefined;
  const slot = {
    x: shape.x! + 0.12,
    y: shape.y! + 0.48,
    width: Math.max(0.2, shape.width! - 0.24),
    height: Math.max(0.2, shape.height! - 0.60),
  };
  if (!dimensions || !dimensions.width || !dimensions.height) return slot;
  const sourceRatio = dimensions.width / dimensions.height;
  const slotRatio = slot.width / slot.height;
  if (sourceRatio > slotRatio) {
    const height = slot.width / sourceRatio;
    return { ...slot, y: slot.y + (slot.height - height) / 2, height };
  }
  const width = slot.height * sourceRatio;
  return { ...slot, x: slot.x + (slot.width - width) / 2, width };
}

function appendEvidencePicture(xml: string, relationshipId: string, bounds: PictureBounds, name: string): string {
  const id = maxNumericAttribute(xml, "id") + 1;
  const toEmu = (value: number) => Math.round(value * EMU_PER_INCH);
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvPicPr preferRelativeResize="0"/><p:nvPr/></p:nvPicPr><p:blipFill rotWithShape="1"><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${toEmu(bounds.x)}" y="${toEmu(bounds.y)}"/><a:ext cx="${toEmu(bounds.width)}" cy="${toEmu(bounds.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
  return xml.replace(/<\/p:spTree>/, `${picture}</p:spTree>`);
}

function coverDateLabel(date: string): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function replaceLapjagCoverDate(xml: string, slide: ParsedSlide, shift: ShiftDetails): string {
  const titleShape = slide.shapes.find((shape) => shape.placeholderType === "title" || shape.placeholderType === "ctrTitle");
  const nextDate = coverDateLabel(shift.date);
  if (!titleShape || !nextDate) return xml;
  const shapeMatcher = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  return xml.replace(shapeMatcher, (block) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    if (readAttribute(cNvPr, "id") !== titleShape.id) return block;
    const originalText = Array.from(block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map((match) => decodeXml(match[1])).join("");
    const datePartPattern = /\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}/i;
    const textTags = Array.from(block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g));
    const dateTagIndex = textTags.findIndex((match) => datePartPattern.test(decodeXml(match[1])));
    if (dateTagIndex < 0) return block;
    let cursor = 0;
    let updated = "";
    textTags.forEach((match, index) => {
      const start = match.index ?? 0;
      const tag = match[0];
      updated += block.slice(cursor, start);
      const text = decodeXml(match[1]);
      if (index === dateTagIndex) {
        updated += tag.replace(match[1], escapeXml(nextDate));
      } else if (index < dateTagIndex && dateTagIndex - index <= 2 && (/^(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)$/i.test(text.trim()) || /^\s*,\s*$/.test(text))) {
        updated += tag.replace(match[1], "");
      } else {
        updated += tag;
      }
      cursor = start + tag.length;
    });
    return updated + block.slice(cursor);
  });
}

function replaceTemplateCoverDate(xml: string, slide: ParsedSlide, shift: ShiftDetails, template: ParsedTemplate): string {
  const nextDate = coverDateLabel(shift.date);
  if (!nextDate) return xml;
  const titleShape = slide.shapes.find((shape) => shape.placeholderType === "title" || shape.placeholderType === "ctrTitle") || slide.shapes.find((shape) => shape.text.length > 20);
  if (!titleShape) return xml;
  const original = titleShape.text;
  let replacement = original;
  if (/hari.{0,20}tanggal/i.test(original) || /hari\s*[.…]+\s*,?\s*tanggal/i.test(original)) {
    replacement = original.replace(/hari.{0,20}tanggal\s*[.…]*/i, ` ${nextDate}`);
    replacement = replacement.replace(/HARI\s*,?\s*TANGGAL/i, ` ${nextDate}`);
  } else if (/\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}/i.test(original)) {
    replacement = original.replace(/\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}/i, nextDate);
  }
  if (replacement === original) return xml;
  return replaceShapeText(xml, titleShape.id, replacement, false);
}

function replacePatientCountTitle(xml: string, slide: ParsedSlide, patientCount: number): string {
  const titleShape = slide.shapes.find((shape) => /pasien baru/.test(shape.text.toLowerCase()));
  if (!titleShape) return xml;
  const replacement = titleShape.text.replace(/pasien baru\s*:\s*.*?\s+pasien/i, `PASIEN BARU: ${patientCount} PASIEN`);
  return replaceShapeText(xml, titleShape.id, replacement, false);
}

function replaceRscmPatientCount(xml: string, slide: ParsedSlide, patientCount: number): string {
  return replacePatientCountTitle(xml, slide, patientCount);
}

function replaceStaleNutritionTitle(xml: string, slide: ParsedSlide, patient: PatientRecord): string {
  const conclusion = patientText(patient, "templateData.nutritionConclusion", 260).toLowerCase();
  if (/gizi\s*buruk/.test(conclusion)) return xml;
  return slide.shapes.reduce((result, shape) => {
    if (!/gizi\s*buruk/i.test(shape.text) || shape.text.length > 120) return result;
    const replacement = shape.text.replace(/gizi\s*buruk/ig, "NUTRISI");
    return replaceShapeText(result, shape.id, replacement, false);
  }, xml);
}

function isLikelySamplePatientText(shape: ParsedShape, slide: ParsedSlide): boolean {
  if (shape.kind !== "text" || !shape.text.trim()) return false;
  if (shape.placeholderType === "title" || shape.placeholderType === "ctrTitle" || shape.text.trim() === slide.title.trim()) return false;
  const text = shape.text.trim();
  if (/\b(?:qhs|pediatric sample|contoh pasien|sample patient|cti\s*0[,.]62|pjb|gizi\s*buruk|diare|shock|congenital heart failure|causes of high|uremia)\b/i.test(text)) return true;
  if (!slide.repeat || text.length < 120) return false;
  if (/(?:nama|usia|umur|diagnosis|diagnosa|kesan|hasil|interpretasi|jantung|paru|radiologi|laboratorium|tata laksana|obat|pasien)\s*[:：]/i.test(text)) return true;
  return Boolean(shape.fontSizePt && shape.fontSizePt <= 18);
}

function clearUnboundSamplePatientText(xml: string, slide: ParsedSlide, bindings: TemplateBinding[]): string {
  if (!slide.repeat) return xml;
  const boundShapeIds = new Set(bindings.filter((binding) => binding.slideIndex === slide.index && binding.semanticField !== "static").map((binding) => binding.shapeId));
  const shapeMatcher = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  return xml.replace(shapeMatcher, (block) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    const id = readAttribute(cNvPr, "id");
    const shape = id ? slide.shapes.find((item) => item.id === id) : undefined;
    if (!shape || boundShapeIds.has(shape.id) || !isLikelySamplePatientText(shape, slide)) return block;
    return replaceTextBody(block, "", true);
  });
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function cellText(cell: string): string {
  return Array.from(cell.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)).map((match) => decodeXml(match[1])).join("").replace(/\s+/g, " ").trim();
}

function replaceCellText(cell: string, value: string): string {
  let replaced = false;
  return cell.replace(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g, (tag, originalText: string) => {
    const closeStart = tag.lastIndexOf("</a:t>");
    const openEnd = tag.indexOf(">");
    if (closeStart < 0 || openEnd < 0) return tag;
    if (replaced) return `${tag.slice(0, openEnd + 1)}${tag.slice(closeStart)}`;
    replaced = true;
    return `${tag.slice(0, openEnd + 1)}${escapeXml(value)}${tag.slice(closeStart)}`;
  });
}

function tableRows(block: string): string[] {
  return Array.from(block.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)).map((match) => match[0]);
}

function tableCells(row: string): string[] {
  return Array.from(row.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)).map((match) => match[0]);
}

function replaceTableRowCells(row: string, replacements: Map<number, string>): string {
  const cells = tableCells(row);
  let result = row;
  cells.forEach((cell, index) => {
    const replacement = replacements.get(index);
    if (replacement === undefined) return;
    result = result.replace(cell, ensureTextAutoFit(replaceCellText(cell, compactText(replacement, 360))));
  });
  return result;
}

function canonicalInvestigationLabel(label: string): string {
  const value = normalizeLookup(label);
  if (/^(?:hb|hemoglobin)$/.test(value)) return "hb";
  if (/^(?:ht|hct|hematokrit|hematocrit)$/.test(value)) return "hct";
  if (/^(?:wbc|leukosit|leukocyte|leukocytes)$/.test(value)) return "wbc";
  if (/^(?:plt|platelet|platelets|trombosit)$/.test(value)) return "platelet";
  if (/neutro/.test(value)) return "neutrophil";
  if (/lymph|limfosit/.test(value)) return "lymphocyte";
  if (/mono/.test(value)) return "monocyte";
  if (/eosino/.test(value)) return "eosinophil";
  if (value === "crp" || value.includes("creactiveprotein")) return "crp";
  if (value === "ph") return "ph";
  if (value.includes("pco2") || value.includes("paco2")) return "pco2";
  if (value.includes("po2") || value.includes("pao2")) return "po2";
  if (value === "hco3" || value.includes("bikarbonat")) return "hco3";
  if (value === "be" || value.includes("baseexcess")) return "be";
  if (value.includes("laktat") || value.includes("lactate")) return "lactate";
  if (value === "na" || value.includes("natrium") || value.includes("sodium")) return "sodium";
  if (value === "k" || value.includes("kalium") || value.includes("potassium")) return "potassium";
  if (value === "cl" || value.includes("klorida") || value.includes("chloride")) return "chloride";
  if (/^(?:cxr|rontgen|radiologi|fototoraks|toraks|thoraks)/.test(value)) return "chestxray";
  return value;
}

function findInvestigation(items: InvestigationItem[], label: string): InvestigationItem | undefined {
  const target = canonicalInvestigationLabel(label);
  return items.find((item) => {
    const name = canonicalInvestigationLabel(item.name);
    return name === target || name.includes(target) || target.includes(name);
  });
}

function genericTemplateTableParts(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (/[|\t]/.test(trimmed)) return trimmed.split(/\s*[|\t]\s*/).map((part) => part.trim());
  const colon = trimmed.match(/^([^:：]{1,90})\s*[:：]\s*(.+)$/);
  return colon ? [colon[1].trim(), colon[2].trim()] : [trimmed];
}

function replaceGenericTemplateTable(
  result: string,
  rows: string[],
  patient: PatientRecord,
  templateKey: string,
): string {
  const raw = patientText(patient, `templateData.${templateKey}`, 5200);
  if (raw === "Tidak tercantum") {
    rows.slice(1).forEach((row) => {
      const cells = tableCells(row);
      const replacements = new Map<number, string>();
      cells.forEach((_, index) => replacements.set(index === 0 && cells.length > 1 ? 0 : index, ""));
      result = result.replace(row, replaceTableRowCells(row, replacements));
    });
    return result;
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return result;
  const firstDataRow = lines.length >= rows.length ? 0 : (rows.length > 1 ? 1 : 0);
  rows.slice(firstDataRow).forEach((row, rowOffset) => {
    const line = lines[rowOffset];
    if (!line) return;
    const cells = tableCells(row);
    if (!cells.length) return;
    const parts = genericTemplateTableParts(line);
    const replacements = new Map<number, string>();
    const isDelimited = /[|\t]/.test(line);
    if (!isDelimited && parts.length === 2 && cells.length > 1) {
      const label = normalizeLookup(parts[0]);
      const labelIndex = cells.findIndex((cell) => normalizeLookup(cellText(cell)) === label);
      replacements.set(labelIndex >= 0 && labelIndex < cells.length - 1 ? labelIndex + 1 : cells.length - 1, parts[1]);
    } else if (parts.length > 1 && parts.length <= cells.length) {
      const start = parts.length === cells.length ? 0 : Math.max(0, cells.length - parts.length);
      parts.forEach((part, index) => replacements.set(start + index, part));
    } else {
      replacements.set(cells.length - 1, parts[0] || "Tidak tercantum");
    }
    result = result.replace(row, replaceTableRowCells(row, replacements));
  });
  rows.slice(firstDataRow + lines.length).forEach((row) => {
    const cells = tableCells(row);
    const replacements = new Map<number, string>();
    cells.forEach((_, index) => replacements.set(index, ""));
    result = result.replace(row, replaceTableRowCells(row, replacements));
  });
  return result;
}

function replaceTableBinding(
  xml: string,
  shapeId: string,
  semanticField: SemanticField,
  patient: PatientRecord | undefined,
  patients: PatientRecord[],
  template?: ParsedTemplate,
  templateKey?: string,
): string {
  const shapeMatcher = /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g;
  return xml.replace(shapeMatcher, (block) => {
    const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    if (readAttribute(cNvPr, "id") !== shapeId) return block;
    const rows = tableRows(block);
    if (!rows.length) return block;
    let result = block;
    if (semanticField === "shift.patientSummaryTable") {
      const capacity = Math.max(0, rows.length - 1);
      const visiblePatients = patients.slice(0, Math.max(0, capacity - (patients.length > capacity ? 1 : 0)));
      visiblePatients.forEach((item, index) => {
        const diagnosis = rawFieldValue<string[]>(item, "assessment.workingDiagnosis")?.join(", ") || "Tidak tercantum";
        const row = rows[index + 1];
        if (!row) return;
        result = result.replace(row, replaceTableRowCells(row, new Map([[0, String(index + 1)], [1, patientSummaryIdentity(item)], [2, diagnosis], [3, patientUrgency(item, template?.profileId === "rscm")]])));
      });
      if (patients.length > capacity && capacity > 0) {
        const warningRow = rows[capacity];
        result = result.replace(warningRow, replaceTableRowCells(warningRow, new Map([[0, "!"], [1, `+${patients.length - visiblePatients.length} pasien lainnya`], [2, "Overflow: tambah slide/manual"], [3, "Tidak tercantum"]])));
      }
      const usedRows = Math.min(capacity, visiblePatients.length + (patients.length > capacity ? 1 : 0));
      rows.slice(1 + usedRows).forEach((row) => {
        result = result.replace(row, replaceTableRowCells(row, new Map([[0, ""], [1, ""], [2, ""], [3, ""]])));
      });
      return result;
    }
    if (!patient) return result;
    if (semanticField === "patient.templateSection" && templateKey && !["resuscitationTimeline", "bloodGasTable"].includes(templateKey)) {
      return replaceGenericTemplateTable(result, rows, patient, templateKey);
    }
    if (semanticField === "patient.templateSection" && templateKey === "resuscitationTimeline") {
      const raw = patientText(patient, "templateData.resuscitationTimeline", 4200);
      const entries = new Map<string, string[]>();
      raw.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*(0|1|3|5|10|15)\s*(?:mnt|menit)?\s*[:|-]\s*(.*)$/i);
        if (!match) return;
        entries.set(match[1], match[2].split(/\s*\|\s*|\s*;\s*/).map((item) => item.trim()));
      });
      rows.slice(1).forEach((row) => {
        const cells = tableCells(row);
        const time = cellText(cells[0] ?? "").match(/0|1|3|5|10|15/)?.[0];
        const values = time ? entries.get(time) : undefined;
        if (!values?.length) {
          const blank = new Map<number, string>();
          cells.forEach((_, index) => { if (index > 0) blank.set(index, ""); });
          result = result.replace(row, replaceTableRowCells(row, blank));
          return;
        }
        const replacements = new Map<number, string>();
        values.slice(0, Math.max(0, cells.length - 1)).forEach((value, index) => replacements.set(index + 1, value));
        result = result.replace(row, replaceTableRowCells(row, replacements));
      });
      return result;
    }
    if (semanticField === "patient.templateSection" && templateKey === "bloodGasTable") {
      const items = rawFieldValue<InvestigationItem[]>(patient, "investigations.laboratory") ?? [];
      const headers = tableCells(rows[0]).map(cellText).map(normalizeLookup);
      const nameIndex = Math.max(0, headers.findIndex((header) => /(pemeriksaan|test|parameter|agd)/.test(header)));
      const resultHeaderIndex = headers.findIndex((header) => /(hasil|result|value)/.test(header));
      const resultIndex = resultHeaderIndex >= 0 ? resultHeaderIndex : (tableCells(rows[0]).length > 1 ? 1 : 0);
      const unitHeaderIndex = headers.findIndex((header) => /(unit|satuan)/.test(header));
      rows.slice(1).forEach((row) => {
        const cells = tableCells(row);
        const label = cellText(cells[nameIndex] ?? "");
        const item = findInvestigation(items, label);
        const replacements = new Map<number, string>([[resultIndex, item?.result || "—"]]);
        if (unitHeaderIndex >= 0 && item?.unit) replacements.set(unitHeaderIndex, item.unit);
        result = result.replace(row, replaceTableRowCells(row, replacements));
      });
      return result;
    }
    if (semanticField === "patient.identityBlock") {
      rows.forEach((row) => {
        const cells = tableCells(row);
        const label = normalizeLookup(cellText(cells[0] ?? ""));
        if (!label) return;
        let value = "";
        if (label.includes("nama")) value = patientText(patient, "identifiers.initials", 140) === "Tidak tercantum" ? patient.displayName : patientText(patient, "identifiers.initials", 140);
        else if (label.includes("jeniskelamin") || label.includes("gender")) value = patientText(patient, "demographics.sex", 140);
        else if (label.includes("usiaperawatan") || label === "usia" || label.includes("umur")) value = patientText(patient, "demographics.age", 140);
        else if (label.includes("usiagestasi") || label.includes("gestasi")) value = patientText(patient, "templateData.gestationalAge", 140);
        else if (label.includes("beratlahir")) value = patientText(patient, "templateData.birthWeight", 140);
        else if (label.includes("nrm") || label.includes("medicalrecord")) value = patientText(patient, "identifiers.medicalRecordNumber", 140);
        else if (label.includes("alamat")) value = patientText(patient, "templateData.address", 220);
        result = result.replace(row, replaceTableRowCells(row, new Map([[1, value]])));
      });
      return result;
    }
    if (semanticField === "patient.physicalExam.organFindings") {
      const findings = rawFieldValue<OrganFinding[]>(patient, "physicalExam.organFindings") ?? [];
      const organKey = (value: string): string => {
        const normalized = normalizeLookup(value);
        if (/thoraks|dada|paru|chest|lung/.test(normalized)) return "thorax";
        if (/jantung|heart|kardi/.test(normalized)) return "heart";
        if (/abdomen|perut/.test(normalized)) return "abdomen";
        if (/ekstremitas|extremit|tangan|kaki/.test(normalized)) return "extremities";
        if (/neurolog|saraf/.test(normalized)) return "neurologic";
        return normalized;
      };
      rows.slice(1).forEach((row) => {
        const cells = tableCells(row);
        const organ = cellText(cells[0] ?? "");
        const targetOrgan = organKey(organ);
        const match = findings.find((item) => {
          const sourceOrgan = organKey(item.organ);
          return sourceOrgan === targetOrgan || sourceOrgan.includes(targetOrgan) || targetOrgan.includes(sourceOrgan);
        });
        result = result.replace(row, replaceTableRowCells(row, new Map([[1, match?.description || ""]])));
      });
      return result;
    }
    if (semanticField === "patient.investigations.laboratory") {
      const headers = tableCells(rows[0]).map(cellText).map(normalizeLookup);
      const nameIndex = Math.max(0, headers.findIndex((header) => /(pemeriksaan|test|parameter|organ)/.test(header)));
      const resultHeaderIndex = headers.findIndex((header) => /(hasil|result|value)/.test(header));
      const resultIndex = resultHeaderIndex >= 0 ? resultHeaderIndex : (tableCells(rows[0]).length > 1 ? 1 : 0);
      const unitIndex = headers.findIndex((header) => /(unit|satuan)/.test(header));
      const items = rawFieldValue<InvestigationItem[]>(patient, "investigations.laboratory") ?? [];
      rows.slice(1).forEach((row) => {
        const cells = tableCells(row);
        const label = cellText(cells[nameIndex] ?? "");
        if (!label) return;
        const item = findInvestigation(items, label);
        const replacements = new Map<number, string>([[resultIndex, item?.result || "—"]]);
        if (unitIndex >= 0 && item?.unit) replacements.set(unitIndex, item.unit);
        result = result.replace(row, replaceTableRowCells(row, replacements));
      });
      return result;
    }
    if (semanticField === "patient.managementTable") {
      const finalMode = /(?:final|akhir)/i.test(templateKey || "");
      const diagnoses = finalMode ? textList(patientText(patient, "templateData.finalDiagnosis", 600)) : (rawFieldValue<string[]>(patient, "assessment.workingDiagnosis") ?? []);
      const treatments = finalMode ? [] : [
        ...(rawFieldValue<TreatmentItem[]>(patient, "management.medications") ?? []),
        ...(rawFieldValue<TreatmentItem[]>(patient, "management.fluids") ?? []),
        ...(rawFieldValue<TreatmentItem[]>(patient, "management.procedures") ?? []),
        ...(rawFieldValue<TreatmentItem[]>(patient, "management.oxygenTherapy") ?? []),
      ];
      rows.slice(1).forEach((row, index) => {
        const treatment = treatments[index];
        const action = treatment ? [treatment.name, treatment.dose, treatment.route, treatment.frequency].filter(Boolean).join(" · ") : "";
        const target = treatment?.notes || "";
        result = result.replace(row, replaceTableRowCells(row, new Map([[0, diagnoses[index] || ""], [1, target], [2, action]])));
      });
      return result;
    }
    return result;
  });
}

function isWholeShapeBinding(semanticField: SemanticField): boolean {
  return semanticField.includes("Block") || semanticField === "shift.coverBlock" || [
    "patient.investigations.imaging",
    "patient.investigations.laboratory",
    "patient.physicalExam.organFindings",
    "patient.timelineBlock",
  ].includes(semanticField);
}

function applyBindings(
  xml: string,
  slide: ParsedSlide,
  bindings: TemplateBinding[],
  patient: PatientRecord | undefined,
  shift: ShiftDetails,
  patients: PatientRecord[],
  template: ParsedTemplate,
): string {
  let result = xml;
  if (slide.role === "cover") {
    result = template.profileId === "lapjag" ? replaceLapjagCoverDate(result, slide, shift) : replaceTemplateCoverDate(result, slide, shift, template);
  }
  if (slide.role === "shift_summary") result = replacePatientCountTitle(result, slide, patients.length);
  if (patient && slide.role === "management") result = replaceStaleNutritionTitle(result, slide, patient);
  result = clearUnboundSamplePatientText(result, slide, bindings);
  const imagingBindings = bindings
    .filter((binding) => binding.slideIndex === slide.index && binding.semanticField === "patient.investigations.imaging")
    .sort((left, right) => (slide.shapes.find((shape) => shape.id === left.shapeId)?.x ?? 0) - (slide.shapes.find((shape) => shape.id === right.shapeId)?.x ?? 0));
  const hasDedicatedRadiologyImageColumn = Boolean(
    patient
    && (patient.attachments ?? []).filter((attachment) => attachment.kind === "image").length === 1
    && imagingBindings.length >= 2,
  );
  bindings
    .filter((binding) => binding.slideIndex === slide.index && binding.semanticField !== "static")
    .forEach((binding) => {
      const shape = slide.shapes.find((item) => item.id === binding.shapeId);
      if (shape?.kind === "graphicFrame" || binding.semanticField.includes("Table") || binding.semanticField === "patient.physicalExam.organFindings" || binding.semanticField === "patient.investigations.laboratory") {
        result = replaceTableBinding(result, binding.shapeId, binding.semanticField, patient, patients, template, binding.templateKey);
        return;
      }
      let content = contentForField(binding.semanticField, patient, shift, template, binding.templateKey, { slide, shapeText: shape?.text });
      if (hasDedicatedRadiologyImageColumn && binding.semanticField === "patient.investigations.imaging" && binding.shapeId !== imagingBindings[0]?.shapeId) {
        content = " ";
      }
      if (content !== undefined) {
        const highlightAbnormal = ["patient.pediatricAssessmentBlock", "patient.pediatricAssessment.leftBlock", "patient.pediatricAssessment.rightBlock", "patient.primarySurveyBlock", "patient.physicalExamBlock"].includes(binding.semanticField);
        const replaceWholeTemplateSection = binding.semanticField === "patient.templateSection";
        const headingOnly = Boolean(shape?.text && shape.text.trim().length < 100 && !/[:：…]|\t/.test(shape.text));
        if (binding.semanticField === "patient.templateSection" && (binding.templateKey === "neonatalBirthProcess" || (headingOnly && shape?.text?.trim() !== "."))) {
          result = appendShapeText(result, binding.shapeId, content, highlightAbnormal);
        } else if (binding.semanticField === "patient.chiefComplaint" && shape?.text && /keluhan utama|chief complaint/i.test(shape.text) && !/[:：]/.test(shape.text)) {
          result = appendShapeText(result, binding.shapeId, content, highlightAbnormal);
        } else if (binding.semanticField === "shift.presenter" && shape?.text) {
          result = replaceShapeText(result, binding.shapeId, content, false, highlightAbnormal);
        } else if (binding.semanticField === "patient.investigations.summary" && shape?.text && /kesimpulan/i.test(shape.text) && !/[:：]/.test(shape.text)) {
          result = replaceShapeText(result, binding.shapeId, `Kesimpulan: ${content}`, false, highlightAbnormal);
        } else {
          result = replaceShapeText(result, binding.shapeId, content, replaceWholeTemplateSection ? false : !isWholeShapeBinding(binding.semanticField), highlightAbnormal);
        }
      }
    });
  if (template.profileId === "rscm" && slide.index === 5 && patient) {
    result = appendEditableTextBox(result, contentForField("patient.secondarySurveyBlock", patient, shift, template) || "Tidak tercantum", { x: 0.8, y: 1.25, width: 8.4, height: 3.75 }, "JaMed RSCM secondary survey");
  }
  return result;
}

function maxNumericAttribute(xml: string, attribute: string): number {
  const values = Array.from(xml.matchAll(new RegExp(`\\b${attribute}="(\\d+)"`, "g"))).map((match) => Number(match[1]));
  return values.reduce((max, value) => Math.max(max, value), 0);
}

function maxRelationshipNumber(xml: string): number {
  const values = Array.from(xml.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]));
  return values.reduce((max, value) => Math.max(max, value), 0);
}

function addRelationship(xml: string, id: string, target: string): string {
  const relationship = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${target}"/>`;
  return xml.replace(/<\/Relationships>/, `${relationship}</Relationships>`);
}

function addImageRelationship(xml: string, id: string, target: string): string {
  const relationship = `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
  return xml.replace(/<\/Relationships>/, `${relationship}</Relationships>`);
}

function addContentType(xml: string, fileName: string): string {
  const partName = `/${fileName}`;
  if (xml.includes(`PartName="${partName}"`)) return xml;
  const override = `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
  return xml.replace(/<\/Types>/, `${override}</Types>`);
}

function updateSlideList(xml: string, order: Array<{ slideId: string; relationshipId: string }>): string {
  const content = order
    .map(({ slideId, relationshipId }) => `<p:sldId id="${slideId}" r:id="${relationshipId}"/>`)
    .join("");
  return xml.replace(/<p:sldIdLst\b[^>]*>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${content}</p:sldIdLst>`);
}

function contiguousRepeatGroups(slides: ParsedSlide[]): Array<ParsedSlide[]> {
  const groups: Array<ParsedSlide[]> = [];
  let current: ParsedSlide[] = [];
  slides.forEach((slide) => {
    if (slide.repeat) {
      current.push(slide);
    } else if (current.length) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length) groups.push(current);
  return groups;
}

function isRadiologySlide(slide: ParsedSlide): boolean {
  return slide.role === "investigation" && /radiologi|radiology|foto\s+toraks|imaging|usg/i.test(`${slide.title} ${slide.text}`);
}

async function applyPatientEvidenceImages(
  zip: JSZip,
  slide: ParsedSlide,
  patient: PatientRecord,
  xml: string,
  relationshipPath: string,
  patientIndex: number,
): Promise<string> {
  if (!isRadiologySlide(slide)) return xml;
  const imageAttachments = (patient.attachments ?? []).filter((attachment) => attachment.kind === "image");
  if (!imageAttachments.length) return xml;
  const slots = slide.shapes
    .filter((shape) => shape.kind === "text" && shape.placeholderType === "body" && shape.x !== undefined && shape.y !== undefined && shape.width !== undefined && shape.height !== undefined)
    .sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  if (!slots.length) return xml;
  const relationshipsFile = zip.file(relationshipPath);
  if (!relationshipsFile) return xml;
  const useDedicatedImageColumn = imageAttachments.length === 1 && slots.length >= 2;
  const imageSlots = useDedicatedImageColumn ? [slots[slots.length - 1]] : slots.slice(0, imageAttachments.length);
  let relationships = await relationshipsFile.async("string");
  let result = xml;
  for (const [imageIndex, attachment] of imageAttachments.slice(0, imageSlots.length).entries()) {
    const decoded = decodeImageDataUrl(attachment.dataUrl);
    if (!decoded) continue;
    const extension = imageFileExtension(attachment, decoded.mimeType);
    if (!extension) continue;
    const bounds = fitImageToSlot(imageSlots[imageIndex], imageDimensions(decoded.bytes, decoded.mimeType));
    if (!bounds) continue;
    const assetName = `koasis-radiology-${patientIndex + 1}-${imageIndex + 1}.${extension}`;
    const relationshipId = `rId${maxRelationshipNumber(relationships) + 1}`;
    // Relationship targets are resolved from the slide part (ppt/slides),
    // matching the media links already present in the supplied templates.
    relationships = addImageRelationship(relationships, relationshipId, `../media/${assetName}`);
    zip.file(`ppt/media/${assetName}`, decoded.bytes);
    result = appendEvidencePicture(result, relationshipId, bounds, `Koasis radiology evidence ${patientIndex + 1}-${imageIndex + 1}`);
  }
  zip.file(relationshipPath, relationships);
  return result;
}

export async function generatePresentation(
  template: ParsedTemplate,
  patients: PatientRecord[],
  bindings: TemplateBinding[],
  shift: ShiftDetails,
): Promise<GeneratedPresentation> {
  if (!patients.length) throw new Error("Tambahkan minimal satu pasien sebelum membuat laporan.");
  const zip = await JSZip.loadAsync(template.raw);
  const presentationFile = zip.file("ppt/presentation.xml");
  const relsFile = zip.file("ppt/_rels/presentation.xml.rels");
  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!presentationFile || !relsFile || !contentTypesFile) {
    throw new Error("Struktur PPTX tidak lengkap: presentation.xml atau relasi tidak ditemukan.");
  }

  let presentationXml = await presentationFile.async("string");
  let presentationRels = await relsFile.async("string");
  let contentTypesXml = await contentTypesFile.async("string");
  const originalSlideIds = Array.from(presentationXml.matchAll(/<p:sldId\b[^>]*>/g)).map((match) => readAttribute(match[0], "id") ?? "");
  const originalSlideXml = new Map<number, string>();
  for (const slide of template.slides) {
    const file = zip.file(slide.fileName);
    if (file) originalSlideXml.set(slide.index, await file.async("string"));
  }

  let nextSlideFileNumber = template.slides.reduce((max, slide) => {
    const number = Number(slide.fileName.match(/slide(\d+)\.xml/)?.[1] ?? 0);
    return Math.max(max, number);
  }, 0);
  let nextSlideId = Math.max(255, maxNumericAttribute(presentationXml, "id"));
  let nextRelationshipId = maxRelationshipNumber(presentationRels);
  const slideOrder: Array<{ slideId: string; relationshipId: string }> = [];
  const groups = contiguousRepeatGroups(template.slides);
  const groupStarts = new Map(groups.map((group) => [group[0].index, group]));
  const consumed = new Set<number>();

  const createClone = async (slide: ParsedSlide, patient: PatientRecord, patientIndex: number) => {
    const originalXml = originalSlideXml.get(slide.index) ?? "";
    const generatedXml = applyBindings(originalXml, slide, bindings, patient, shift, patients, template);
    nextSlideFileNumber += 1;
    nextSlideId += 1;
    nextRelationshipId += 1;
    const newSlideFile = `ppt/slides/slide${nextSlideFileNumber}.xml`;
    const newRelationshipId = `rId${nextRelationshipId}`;
    const originalRelsPath = rawSlideRelationshipPath(slide.fileName);
    const originalRels = zip.file(originalRelsPath);
    const newRelsPath = `ppt/slides/_rels/slide${nextSlideFileNumber}.xml.rels`;
    if (originalRels) {
      zip.file(newRelsPath, await originalRels.async("string"));
    }
    const chartXml = await applyLapjagChartAssets(zip, template, slide, patient, generatedXml, newRelsPath);
    const finalXml = applyPerinaChartAssets(template, slide, patient, chartXml);
    const evidenceXml = await applyPatientEvidenceImages(zip, slide, patient, finalXml, newRelsPath, patientIndex);
    zip.file(newSlideFile, evidenceXml);
    presentationRels = addRelationship(presentationRels, newRelationshipId, `slides/slide${nextSlideFileNumber}.xml`);
    contentTypesXml = addContentType(contentTypesXml, newSlideFile);
    return { slideId: String(nextSlideId), relationshipId: newRelationshipId, patientIndex };
  };

  for (let index = 0; index < template.slides.length; index += 1) {
    const slide = template.slides[index];
    if (consumed.has(slide.index)) continue;
    const group = groupStarts.get(slide.index);
    if (group) {
      group.forEach((item) => consumed.add(item.index));
      for (let patientIndex = 0; patientIndex < patients.length; patientIndex += 1) {
        for (const item of group) {
          if (patientIndex === 0) {
            const original = originalSlideXml.get(item.index) ?? "";
            const generatedXml = applyBindings(original, item, bindings, patients[patientIndex], shift, patients, template);
            const relationshipPath = rawSlideRelationshipPath(item.fileName);
            const chartXml = await applyLapjagChartAssets(zip, template, item, patients[patientIndex], generatedXml, relationshipPath);
            const finalXml = applyPerinaChartAssets(template, item, patients[patientIndex], chartXml);
            const evidenceXml = await applyPatientEvidenceImages(zip, item, patients[patientIndex], finalXml, relationshipPath, patientIndex);
            zip.file(item.fileName, evidenceXml);
            slideOrder.push({
              slideId: originalSlideIds[item.index] ?? String(256 + item.index),
              relationshipId: item.relationshipId,
            });
          } else {
            const clone = await createClone(item, patients[patientIndex], patientIndex);
            slideOrder.push({ slideId: clone.slideId, relationshipId: clone.relationshipId });
          }
        }
      }
    } else {
      const original = originalSlideXml.get(slide.index) ?? "";
      zip.file(slide.fileName, applyBindings(original, slide, bindings, undefined, shift, patients, template));
      slideOrder.push({
        slideId: originalSlideIds[slide.index] ?? String(256 + slide.index),
        relationshipId: slide.relationshipId,
      });
    }
  }

  presentationXml = updateSlideList(presentationXml, slideOrder);
  zip.file("ppt/presentation.xml", presentationXml);
  zip.file("ppt/_rels/presentation.xml.rels", presentationRels);
  zip.file("[Content_Types].xml", contentTypesXml);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const validationZip = await JSZip.loadAsync(blob);
  const slideCount = Object.keys(validationZip.files).filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file)).length;
  return {
    blob,
    fileName: `${shift.title || "laporan-jaga"}.pptx`.replace(/[\\/:*?"<>|]+/g, "-") || "laporan-jaga.pptx",
    slideCount,
  };
}
