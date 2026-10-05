export type FieldStatus =
  | "documented"
  | "inferred"
  | "missing"
  | "conflicting"
  | "user_confirmed";

export interface SourceReference {
  sourceId: string;
  filename?: string;
  page?: number;
  textSnippet?: string;
  timestampStart?: number;
  timestampEnd?: number;
}

export interface ClinicalField<T = string> {
  value?: T;
  status: FieldStatus;
  confidence: number;
  sources: SourceReference[];
  alternatives?: T[];
}

export interface ClinicalEvent {
  id: string;
  timestamp?: string;
  category:
    | "presentation"
    | "assessment"
    | "investigation"
    | "treatment"
    | "consultation"
    | "response"
    | "disposition";
  description: string;
  sources: SourceReference[];
}

export interface InvestigationItem {
  name: string;
  result?: string;
  unit?: string;
  reference?: string;
}

export interface TreatmentItem {
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
  notes?: string;
}

export interface OrganFinding {
  organ: string;
  description: string;
}

export interface PatientRecord {
  id: string;
  displayName: string;
  /** Evidence uploaded for this patient and available to the PPTX renderer. */
  attachments?: PatientAttachment[];
  identifiers: {
    name?: ClinicalField<string>;
    initials?: ClinicalField<string>;
    medicalRecordNumber?: ClinicalField<string>;
  };
  demographics: {
    age?: ClinicalField<string>;
    sex?: ClinicalField<string>;
    weightKg?: ClinicalField<number>;
    heightCm?: ClinicalField<number>;
  };
  admission: {
    arrivalTime?: ClinicalField<string>;
    admissionDate?: ClinicalField<string>;
    referralSource?: ClinicalField<string>;
  };
  chiefComplaint?: ClinicalField<string>;
  urgency?: ClinicalField<string>;
  history: {
    presentIllness?: ClinicalField<string>;
    pastMedicalHistory?: ClinicalField<string>;
    medicationHistory?: ClinicalField<string>;
    allergyHistory?: ClinicalField<string>;
    birthHistory?: ClinicalField<string>;
    immunizationHistory?: ClinicalField<string>;
    familyHistory?: ClinicalField<string>;
    nutritionHistory?: ClinicalField<string>;
    socioeconomicHistory?: ClinicalField<string>;
  };
  physicalExam: {
    generalAppearance?: ClinicalField<string>;
    consciousness?: ClinicalField<string>;
    vitalSigns: {
      bloodPressure?: ClinicalField<string>;
      heartRate?: ClinicalField<number>;
      respiratoryRate?: ClinicalField<number>;
      temperature?: ClinicalField<number>;
      spo2?: ClinicalField<number>;
    };
    findings?: ClinicalField<string>;
    organFindings?: ClinicalField<OrganFinding[]>;
  };
  investigations: {
    laboratory?: ClinicalField<InvestigationItem[]>;
    imaging?: ClinicalField<InvestigationItem[]>;
    other?: ClinicalField<InvestigationItem[]>;
  };
  assessment: {
    workingDiagnosis?: ClinicalField<string[]>;
    differentialDiagnosis?: ClinicalField<string[]>;
  };
  /** Template-specific values that do not fit the generic clinical record. */
  templateData?: Record<string, ClinicalField<string>>;
  management: {
    medications?: ClinicalField<TreatmentItem[]>;
    fluids?: ClinicalField<TreatmentItem[]>;
    procedures?: ClinicalField<TreatmentItem[]>;
    oxygenTherapy?: ClinicalField<TreatmentItem[]>;
  };
  disposition?: ClinicalField<string>;
  timeline: ClinicalEvent[];
  sourceId: string;
}

export type TemplateProfileId =
  | "lapjag"
  | "perina-lapjag"
  | "perina-harkit"
  | "perina-rsab"
  | "rscm"
  | "rsui"
  | "generic";

export type PatientAttachmentKind = "image" | "pdf" | "audio";

export interface PatientAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: PatientAttachmentKind;
  sizeBytes: number;
  dataUrl: string;
}

export interface TemplateFieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  inputMode?: "text" | "numeric";
}

export interface TemplateFieldGroup {
  id: string;
  label: string;
  description: string;
  fields: TemplateFieldSpec[];
}

export interface TemplateShiftField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
}

/** How a slide should be treated when a report is generated. */
export type TemplateSlideInclusion = "routine" | "optional" | "example";
/** Which patient set a slide is allowed to consume. */
export type TemplateSlidePatientScope = "static" | "all_patients" | "focus_patient";

export interface TemplateSlideGuide {
  index: number;
  label: string;
  role: SlideRole;
  repeat: boolean;
  fields: string[];
  instructions: string;
  speakerNote?: string;
  /** Optional for backwards-compatible saved contracts. Defaults to routine. */
  inclusion?: TemplateSlideInclusion;
  /** Whether the slide is selected in the current mapping. Defaults to true. */
  include?: boolean;
  inclusionReason?: string;
  /** Summary slides use all patients; clinical repeat slides use the selected focus patient. */
  patientScope?: TemplateSlidePatientScope;
}

export type TemplateContractCheckStatus = "pass" | "warning" | "error";

export interface TemplateContractCheck {
  id: string;
  label: string;
  status: TemplateContractCheckStatus;
  message: string;
  slideIndex?: number;
}

export interface TemplateContractValidation {
  valid: boolean;
  score: number;
  checks: TemplateContractCheck[];
  errors: string[];
  warnings: string[];
}

export interface TemplateAnalysis {
  version: 1;
  label: string;
  description: string;
  extractionInstructions: string;
  patientInputHint: string;
  shiftFields: TemplateShiftField[];
  fieldGroups: TemplateFieldGroup[];
  slideGuides: TemplateSlideGuide[];
  bindings: TemplateBinding[];
  warnings: string[];
  confidence: number;
  source: "agent" | "local";
  model?: string;
  validation?: TemplateContractValidation;
  learningStatus?: "agent" | "trusted_profile" | "local_fallback";
}

export interface TemplateProfile {
  id: TemplateProfileId;
  label: string;
  description: string;
  extractionInstructions: string;
  fieldGroups: TemplateFieldGroup[];
  shiftFields: TemplateShiftField[];
  slideGuides: TemplateSlideGuide[];
  patientInputHint: string;
}

export type SlideRole =
  | "cover"
  | "shift_summary"
  | "patient_identity"
  | "anamnesis"
  | "history"
  | "pediatric_assessment"
  | "primary_survey"
  | "secondary_survey"
  | "anthropometry"
  | "physical_exam"
  | "investigation"
  | "diagnosis"
  | "management"
  | "timeline"
  | "patient_summary"
  | "consultation"
  | "delivery_preparation"
  | "resuscitation"
  | "stabilization"
  | "checklist"
  | "closing"
  | "unknown";

export type ShapeKind = "text" | "graphicFrame" | "picture" | "unknown";

export interface ParsedShape {
  id: string;
  name?: string;
  kind: ShapeKind;
  text: string;
  tableRows?: string[][];
  fontSizePt?: number;
  bold?: boolean;
  fillColor?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  placeholderType?: string;
  placeholderIndex?: string;
}

export interface ParsedSlide {
  index: number;
  fileName: string;
  relationshipId: string;
  title: string;
  text: string;
  role: SlideRole;
  repeat: boolean;
  speakerNotes?: string;
  shapes: ParsedShape[];
  /** Optional for backwards-compatible parsed templates. Defaults to routine. */
  inclusion?: TemplateSlideInclusion;
  /** Whether this slide is currently selected for output. Defaults to true. */
  include?: boolean;
  inclusionReason?: string;
  /** Summary slides use all patients; clinical repeat slides use the selected focus patient. */
  patientScope?: TemplateSlidePatientScope;
}

export type SemanticField =
  | "static"
  | "shift.title"
  | "shift.date"
  | "shift.department"
  | "shift.hospital"
  | "shift.team"
  | "shift.student"
  | "shift.ppds"
  | "shift.presenter"
  | "shift.perinaTeam"
  | "shift.facilitator"
  | "shift.dpjp"
  | "shift.custom"
  | "shift.coverBlock"
  | "shift.patientSummaryTable"
  | "patient.identifiers.name"
  | "patient.identifiers.initials"
  | "patient.identifiers.medicalRecordNumber"
  | "patient.demographics.age"
  | "patient.demographics.sex"
  | "patient.demographics.weightKg"
  | "patient.demographics.heightCm"
  | "patient.admission.arrivalTime"
  | "patient.admission.admissionDate"
  | "patient.admission.referralSource"
  | "patient.chiefComplaint"
  | "patient.history.presentIllness"
  | "patient.history.pastMedicalHistory"
  | "patient.history.medicationHistory"
  | "patient.history.allergyHistory"
  | "patient.history.birthHistory"
  | "patient.history.immunizationHistory"
  | "patient.history.familyHistory"
  | "patient.history.nutritionHistory"
  | "patient.history.socioeconomicHistory"
  | "patient.identityBlock"
  | "patient.historyBlock"
  | "patient.pediatricAssessmentBlock"
  | "patient.pediatricAssessment.leftBlock"
  | "patient.pediatricAssessment.rightBlock"
  | "patient.primarySurveyBlock"
  | "patient.secondarySurveyBlock"
  | "patient.anthropometryBlock"
  | "patient.physicalExamBlock"
  | "patient.physicalExam.generalAppearanceBlock"
  | "patient.physicalExam.vitalSignsBlock"
  | "patient.physicalExam.organFindings"
  | "patient.investigationsBlock"
  | "patient.investigations.summary"
  | "patient.assessmentBlock"
  | "patient.assessment.summary"
  | "patient.managementBlock"
  | "patient.managementTable"
  | "patient.timelineBlock"
  | "patient.nutritionBlock"
  | "patient.templateSection"
  | "patient.physicalExam.generalAppearance"
  | "patient.physicalExam.consciousness"
  | "patient.physicalExam.vitalSigns.bloodPressure"
  | "patient.physicalExam.vitalSigns.heartRate"
  | "patient.physicalExam.vitalSigns.respiratoryRate"
  | "patient.physicalExam.vitalSigns.temperature"
  | "patient.physicalExam.vitalSigns.spo2"
  | "patient.physicalExam.findings"
  | "patient.investigations.laboratory"
  | "patient.investigations.imaging"
  | "patient.assessment.workingDiagnosis"
  | "patient.assessment.differentialDiagnosis"
  | "patient.management.medications"
  | "patient.management.fluids"
  | "patient.management.procedures"
  | "patient.management.oxygenTherapy"
  | "patient.disposition";

export interface TemplateBinding {
  slideIndex: number;
  shapeId: string;
  semanticField: SemanticField;
  templateKey?: string;
  confidence: number;
  source: "auto" | "agent" | "user";
}

export interface ParsedTemplate {
  id: string;
  name: string;
  fileName: string;
  slideCount: number;
  slides: ParsedSlide[];
  bindings: TemplateBinding[];
  raw: ArrayBuffer;
  profileId: TemplateProfileId;
  templateAnalysis?: TemplateAnalysis;
  templateValidation?: TemplateContractValidation;
  analysisStatus: "uploaded" | "analyzing" | "ready" | "needs_review";
}

export interface ShiftDetails {
  title: string;
  date: string;
  department: string;
  hospital: string;
  team: string;
  facilitator: string;
  dpjp: string;
  metadata?: Record<string, string>;
}

export interface SourceItem {
  id: string;
  name: string;
  type: "raw_text" | "txt" | "docx" | "pdf" | "image" | "audio";
  sizeLabel?: string;
  status: "ready" | "processing" | "unsupported";
  text?: string;
  patientId?: string;
  patientLabel?: string;
}

export interface PatientDraft {
  id: string;
  label: string;
  text: string;
  attachments: PatientAttachment[];
  /** A combined roster source is evidence for extraction, not patient-specific evidence for slide placement. */
  bulkSource?: boolean;
}
