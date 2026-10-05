import type {
  ParsedShape,
  ParsedSlide,
  ParsedTemplate,
  SemanticField,
  TemplateBinding,
  TemplateContractCheck,
  TemplateContractValidation,
} from "../types";
import { slideIsIncluded } from "./templateSlides";

const KNOWN_PROFILES = new Set([
  "lapjag",
  "perina-lapjag",
  "perina-harkit",
  "perina-rsut",
  "perina-rsab",
  "igd-harkit",
  "igd-rsut",
  "rscm",
  "rsui",
]);

const SUPPORTED_SEMANTIC_FIELDS = new Set<SemanticField>([
  "static",
  "shift.title", "shift.date", "shift.department", "shift.hospital", "shift.team", "shift.student", "shift.ppds",
  "shift.presenter", "shift.perinaTeam", "shift.facilitator", "shift.dpjp", "shift.custom", "shift.coverBlock", "shift.patientSummaryTable",
  "patient.identifiers.name", "patient.identifiers.initials", "patient.identifiers.medicalRecordNumber",
  "patient.demographics.age", "patient.demographics.sex", "patient.demographics.weightKg", "patient.demographics.heightCm",
  "patient.admission.arrivalTime", "patient.admission.admissionDate", "patient.admission.referralSource", "patient.chiefComplaint",
  "patient.history.presentIllness", "patient.history.pastMedicalHistory", "patient.history.medicationHistory", "patient.history.allergyHistory",
  "patient.history.birthHistory", "patient.history.immunizationHistory", "patient.history.familyHistory", "patient.history.nutritionHistory",
  "patient.history.socioeconomicHistory", "patient.identityBlock", "patient.historyBlock", "patient.pediatricAssessmentBlock",
  "patient.pediatricAssessment.leftBlock", "patient.pediatricAssessment.rightBlock", "patient.primarySurveyBlock", "patient.secondarySurveyBlock",
  "patient.anthropometryBlock", "patient.physicalExamBlock", "patient.physicalExam.generalAppearanceBlock", "patient.physicalExam.vitalSignsBlock", "patient.physicalExam.organFindings", "patient.investigationsBlock",
  "patient.investigations.summary", "patient.assessmentBlock", "patient.assessment.summary", "patient.managementBlock", "patient.managementTable",
  "patient.timelineBlock", "patient.nutritionBlock", "patient.templateSection", "patient.physicalExam.generalAppearance",
  "patient.physicalExam.consciousness", "patient.physicalExam.vitalSigns.bloodPressure", "patient.physicalExam.vitalSigns.heartRate",
  "patient.physicalExam.vitalSigns.respiratoryRate", "patient.physicalExam.vitalSigns.temperature", "patient.physicalExam.vitalSigns.spo2",
  "patient.physicalExam.findings", "patient.investigations.laboratory", "patient.investigations.imaging", "patient.assessment.workingDiagnosis",
  "patient.assessment.differentialDiagnosis", "patient.management.medications", "patient.management.fluids", "patient.management.procedures",
  "patient.management.oxygenTherapy", "patient.disposition",
]);

function check(
  checks: TemplateContractCheck[],
  errors: string[],
  warnings: string[],
  id: string,
  label: string,
  status: TemplateContractCheck["status"],
  message: string,
  slideIndex?: number,
): void {
  checks.push({ id, label, status, message, slideIndex });
  if (status === "error") errors.push(message);
  if (status === "warning") warnings.push(message);
}

function shapeForBinding(template: ParsedTemplate, binding: TemplateBinding): ParsedShape | undefined {
  return template.slides.find((slide) => slide.index === binding.slideIndex)?.shapes.find((shape) => shape.id === binding.shapeId);
}

function slideForBinding(template: ParsedTemplate, binding: TemplateBinding): ParsedSlide | undefined {
  return template.slides.find((slide) => slide.index === binding.slideIndex);
}

function isPatientBinding(binding: TemplateBinding): boolean {
  return binding.semanticField.startsWith("patient.");
}

function hasVisualOnlyContent(slide: ParsedSlide): boolean {
  return slide.shapes.some((shape) => shape.kind === "picture") && !slide.shapes.some((shape) => shape.kind === "text" && shape.text.trim().length > 12);
}

function hasLikelySampleText(shape: ParsedShape): boolean {
  return /\b(?:contoh pasien|sample patient|pediatric sample|qhs|cti\s*0[,.]62|gizi\s*buruk|syok hipovolemia|diare akut|congenital heart failure|cat\s*mudpi(?:les|lles)|high\s+anion\s+gap)\b/i.test(shape.text)
    || /slide\s+ini\s+(?:cuma|hanya)|opsional\s+(?:harus|untuk)|hapus\s+aja|tidak\s+nyambung/i.test(shape.text);
}

function isSupportedShapeBinding(binding: TemplateBinding, shape: ParsedShape): boolean {
  if (shape.kind === "graphicFrame") {
    return [
      "shift.patientSummaryTable",
      "patient.identityBlock",
      "patient.physicalExam.organFindings",
      "patient.investigations.laboratory",
      "patient.managementTable",
      "patient.templateSection",
    ].includes(binding.semanticField);
  }
  if (shape.kind === "text") {
    return !["shift.patientSummaryTable", "patient.managementTable"].includes(binding.semanticField);
  }
  if (shape.kind === "picture") {
    return binding.semanticField === "patient.investigations.imaging";
  }
  return false;
}

/**
 * Validate the contract before the renderer is allowed to mutate a PPTX.
 * The validator is deliberately conservative: an uncertain custom template
 * must stop at review instead of silently producing a plausible-looking deck.
 */
export function validateTemplateContract(template: ParsedTemplate): TemplateContractValidation {
  const checks: TemplateContractCheck[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const slides = template.slides || [];
  const bindings = template.bindings || [];
  const analysis = template.templateAnalysis;
  const isKnownProfile = KNOWN_PROFILES.has(template.profileId);
  const isGeneric = template.profileId === "generic";

  const slideIndexes = slides.map((slide) => slide.index);
  const expectedIndexes = slides.map((_slide, index) => index);
  const validSlideOrder = slides.length === template.slideCount
    && new Set(slideIndexes).size === slideIndexes.length
    && slideIndexes.every((index, position) => index === expectedIndexes[position]);
  check(
    checks,
    errors,
    warnings,
    "slide-topology",
    "Urutan slide",
    validSlideOrder ? "pass" : "error",
    validSlideOrder ? "Slide memiliki indeks berurutan dan jumlah yang konsisten." : "Struktur slide tidak konsisten: indeks atau jumlah slide berubah.",
  );

  if (isGeneric && (!analysis || analysis.source !== "agent" || analysis.learningStatus === "local_fallback")) {
    check(
      checks,
      errors,
      warnings,
      "agent-learning",
      "Template dipelajari agent",
      "error",
      "Template custom belum memiliki kontrak hasil pembelajaran agent. Mapping lokal tidak boleh dipakai untuk generate.",
    );
  } else {
    check(
      checks,
      errors,
      warnings,
      "agent-learning",
      "Template dipelajari agent",
      "pass",
      isKnownProfile ? "Template memakai kontrak departemen yang sudah divalidasi." : "Kontrak template berasal dari agent.",
    );
  }

  if (analysis) {
    const guideIndexes = analysis.slideGuides.map((guide) => guide.index);
    const guidesComplete = analysis.slideGuides.length === template.slideCount
      && new Set(guideIndexes).size === guideIndexes.length
      && expectedIndexes.every((index) => guideIndexes.includes(index));
    check(
      checks,
      errors,
      warnings,
      "slide-guides",
      "Panduan slide",
      guidesComplete ? "pass" : "error",
      guidesComplete ? "Setiap slide memiliki konteks dan instruksi." : "Sebagian slide belum memiliki panduan konteks dari kontrak template.",
    );
    if (analysis.confidence < 0.7) {
      check(checks, errors, warnings, "analysis-confidence", "Confidence kontrak", "warning", `Confidence kontrak template rendah (${Math.round(analysis.confidence * 100)}%). Periksa warning sebelum melanjutkan.`);
    }
  }

  const bindingKeys = new Map<string, TemplateBinding>();
  const semanticTargets = new Map<string, TemplateBinding>();
  let bindingReferencesValid = true;
  let bindingSemanticsValid = true;
  bindings.forEach((binding) => {
    const key = `${binding.slideIndex}:${binding.shapeId}`;
    const previous = bindingKeys.get(key);
    if (previous && (previous.semanticField !== binding.semanticField || previous.templateKey !== binding.templateKey)) {
      bindingSemanticsValid = false;
      check(checks, errors, warnings, `binding-conflict-${key}`, "Konflik binding", "error", `Shape ${binding.shapeId} memiliki dua semantic field berbeda pada slide ${binding.slideIndex + 1}.`, binding.slideIndex);
    }
    bindingKeys.set(key, binding);
    if (binding.semanticField !== "patient.templateSection") {
      const semanticKey = `${binding.slideIndex}:${binding.semanticField}:${binding.templateKey || ""}`;
      const previousSemanticTarget = semanticTargets.get(semanticKey);
      if (previousSemanticTarget && previousSemanticTarget.shapeId !== binding.shapeId) {
        bindingSemanticsValid = false;
        check(
          checks,
          errors,
          warnings,
          `binding-duplicate-semantic-${semanticKey}`,
          "Duplikasi konteks binding",
          isKnownProfile ? "warning" : "error",
          `Fakta ${binding.semanticField} dipetakan ke beberapa box pada slide ${binding.slideIndex + 1}. Renderer menahan duplikasi agar teks tidak bertumpuk.`,
          binding.slideIndex,
        );
      } else {
        semanticTargets.set(semanticKey, binding);
      }
    }
    const slide = slideForBinding(template, binding);
    const shape = shapeForBinding(template, binding);
    if (!slide || !shape) {
      bindingReferencesValid = false;
      check(checks, errors, warnings, `binding-reference-${key}`, "Referensi shape", "error", `Binding ${binding.shapeId} menunjuk ke slide atau shape yang tidak ada.`, binding.slideIndex);
      return;
    }
    if (!SUPPORTED_SEMANTIC_FIELDS.has(binding.semanticField)) {
      bindingSemanticsValid = false;
      check(checks, errors, warnings, `binding-semantic-${key}`, "Semantic field", "error", `Semantic field ${binding.semanticField} belum didukung renderer.`, binding.slideIndex);
    }
    if (["patient.templateSection", "shift.custom"].includes(binding.semanticField) && !binding.templateKey) {
      bindingSemanticsValid = false;
      check(checks, errors, warnings, `binding-key-${key}`, "Kunci field custom", "error", `Binding ${binding.semanticField} harus memiliki templateKey agar konteks tidak hilang.`, binding.slideIndex);
    }
    if (!isSupportedShapeBinding(binding, shape)) {
      bindingSemanticsValid = false;
      check(checks, errors, warnings, `binding-renderer-${key}`, "Kompatibilitas renderer", "error", `Renderer belum memiliki jalur aman untuk ${binding.semanticField} pada shape ${shape.kind}.`, binding.slideIndex);
    }
    if (shape.kind === "picture" && binding.semanticField === "patient.investigations.imaging" && (slide.role !== "investigation" || !/(radiologi|radiology|foto|rontgen|x[- ]?ray|xray|cxr|imaging|usg)/i.test(`${slide.title} ${slide.text}`))) {
      bindingSemanticsValid = false;
      check(checks, errors, warnings, `binding-picture-context-${key}`, "Konteks slot gambar", "error", `Slot gambar ${shape.id} hanya boleh dipetakan sebagai evidence radiologi pada slide pemeriksaan penunjang.`, binding.slideIndex);
    }
  });
  check(checks, errors, warnings, "binding-references", "Referensi binding", bindingReferencesValid ? "pass" : "error", bindingReferencesValid ? "Semua binding menunjuk ke shape yang benar." : "Ada binding yang menunjuk ke shape atau slide yang tidak ada.");
  check(checks, errors, warnings, "binding-semantics", "Semantik binding", bindingSemanticsValid ? "pass" : "error", bindingSemanticsValid ? "Binding menggunakan semantic field yang renderer pahami." : "Ada binding yang tidak aman untuk dirender.");

  const summarySlides = slides.filter((slide) => slide.role === "shift_summary" || slide.patientScope === "all_patients");
  summarySlides.forEach((slide) => {
    const hasSummaryBinding = bindings.some((binding) => binding.slideIndex === slide.index && binding.semanticField === "shift.patientSummaryTable");
    const scopeConsistent = slide.patientScope === undefined || slide.patientScope === "all_patients";
    if (!scopeConsistent) {
      check(checks, errors, warnings, `summary-scope-${slide.index}`, "Scope tabel ringkasan", "error", `Slide ${slide.index + 1} berperan sebagai tabel pasien tetapi scope-nya bukan all_patients.`, slide.index);
    }
    if (!hasSummaryBinding) {
      check(checks, errors, warnings, `summary-binding-${slide.index}`, "Mapping semua pasien", isGeneric ? "error" : "warning", `Slide ${slide.index + 1} perlu binding shift.patientSummaryTable agar seluruh pasien baru masuk ke tabel pembuka.`, slide.index);
    }
  });
  const focusSlides = slides.filter((slide) => slideIsIncluded(slide) && slide.repeat);
  focusSlides.forEach((slide) => {
    if (slide.patientScope === "all_patients") {
      check(checks, errors, warnings, `focus-scope-${slide.index}`, "Scope slide klinis", "error", `Slide ${slide.index + 1} ditandai berulang tetapi memakai scope all_patients; slide detail harus terbatas pada kasus utama.`, slide.index);
    }
  });

  const repeatSlides = slides.filter((slide) => slideIsIncluded(slide) && slide.repeat);
  const repeatBoundSlides = new Set(bindings.filter((binding) => slideIsIncluded(slideForBinding(template, binding) || { include: true }) && isPatientBinding(binding)).map((binding) => binding.slideIndex));
  let repeatCoverage = true;
  repeatSlides.forEach((slide) => {
    if (slide.index === 0 || slide.index === template.slideCount - 1 || slide.role === "cover" || slide.role === "closing" || slide.role === "shift_summary") {
      repeatCoverage = false;
      check(checks, errors, warnings, `repeat-boundary-${slide.index}`, "Batas pengulangan", "error", `Slide ${slide.index + 1} bertanda per pasien tetapi berperan sebagai slide statis.`, slide.index);
      return;
    }
    if (!repeatBoundSlides.has(slide.index) && !hasVisualOnlyContent(slide)) {
      const guide = analysis?.slideGuides.find((item) => item.index === slide.index);
      const explicitlyStatic = guide?.fields.length === 0 && /(?:static|edukasi|diagram|grafik|chart|contoh)/i.test(`${guide.label} ${guide.instructions}`);
      if (!explicitlyStatic) {
        check(checks, errors, warnings, `repeat-coverage-${slide.index}`, "Cakupan slide per pasien", isGeneric ? "error" : "warning", `Slide ${slide.index + 1} diulang per pasien tetapi belum memiliki binding fakta pasien yang jelas.`, slide.index);
        if (isGeneric) repeatCoverage = false;
      }
    }
  });
  if (!repeatSlides.length) {
    check(checks, errors, warnings, "repeat-coverage", "Cakupan slide per pasien", "warning", "Tidak ada slide yang ditandai untuk diulang per pasien.");
  } else {
    check(checks, errors, warnings, "repeat-coverage", "Cakupan slide per pasien", repeatCoverage ? "pass" : "error", repeatCoverage ? "Slide per pasien memiliki batas dan mapping yang konsisten." : "Ada slide per pasien yang belum aman untuk diulang.");
  }

  const sampleLeaks = slides.flatMap((slide) => slideIsIncluded(slide) && slide.repeat
    ? slide.shapes.filter((shape) => !bindings.some((binding) => binding.slideIndex === slide.index && binding.shapeId === shape.id) && hasLikelySampleText(shape)).map((shape) => ({ slide, shape }))
    : []);
  if (sampleLeaks.length) {
    sampleLeaks.slice(0, 4).forEach(({ slide, shape }) => check(checks, errors, warnings, `sample-${slide.index}-${shape.id}`, "Sample template", "warning", `Teks contoh pada slide ${slide.index + 1} belum dipetakan dan akan dikosongkan saat render.`, slide.index));
  }
  check(checks, errors, warnings, "sample-content", "Perlindungan data sample", sampleLeaks.length ? "warning" : "pass", sampleLeaks.length ? "Template masih memiliki teks contoh yang belum memiliki binding eksplisit." : "Tidak ada sample patient yang terdeteksi di luar binding.");

  const unsupportedCharts = isGeneric
    ? slides.filter((slide) => slide.role === "anthropometry" && slide.shapes.some((shape) => shape.kind === "picture"))
    : [];
  unsupportedCharts.forEach((slide) => check(checks, errors, warnings, `chart-${slide.index}`, "Renderer chart", "error", `Slide antropometri ${slide.index + 1} memiliki chart/gambar tetapi template custom belum memiliki renderer chart yang tervalidasi.`, slide.index));
  check(checks, errors, warnings, "renderer-capabilities", "Kapabilitas renderer", unsupportedCharts.length ? "error" : "pass", unsupportedCharts.length ? "Ada fitur visual template custom yang belum memiliki renderer aman." : "Kapabilitas visual template tidak melampaui renderer yang tersedia.");

  const uniqueErrors = Array.from(new Set(errors));
  const uniqueWarnings = Array.from(new Set(warnings));
  const score = Math.max(0, Math.round((1 - uniqueErrors.length * 0.22 - uniqueWarnings.length * 0.04) * 100) / 100);
  return {
    valid: uniqueErrors.length === 0,
    score,
    checks,
    errors: uniqueErrors,
    warnings: uniqueWarnings,
  };
}
