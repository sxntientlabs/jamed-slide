import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Download,
  Eye,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ClinicalField,
  FieldStatus,
  ParsedSlide,
  ParsedTemplate,
  PatientAttachment,
  PatientRecord,
  PatientDraft,
  ShiftDetails,
  SourceItem,
} from "./types";
import type { BuiltInTemplateEntry } from "./lib/builtInTemplates";
import { loadBuiltInTemplate, loadBuiltInTemplateCatalog } from "./lib/builtInTemplates";
import { KoasisIcon, type KoasisIconName } from "./components/KoasisIcon";
import { AuthGate, useAuth, userInitial } from "./components/AuthGate";
import { extractPatientsWithAi } from "./lib/aiClinicalClient";
import { extractPatients, formatFieldValue, splitPatientSections } from "./lib/clinicalParser";
import { extractDocxText } from "./lib/docxParser";
import { generatePresentation } from "./lib/pptxGenerator";
import { parsePptx } from "./lib/pptxParser";
import { renderPresentationForPreview } from "./lib/presentationRenderer";
import { inspectGeneratedPresentation, reviewPresentationWithAgent, type PresentationReview } from "./lib/presentationReview";
import { analyzeTemplateWithAi, applyTemplateAnalysis, buildLocalTemplateAnalysis, validateTemplateContract } from "./lib/templateAnalyzer";
import { getTemplateProfile } from "./lib/templateProfiles";
import { loadWorkspaceMetadata, saveWorkspaceMetadata, type FirebaseUser, type WorkspaceMetadata } from "./lib/firebase";
import { slideInclusion, slideIsIncluded } from "./lib/templateSlides";
import "./styles.css";

type View = "dashboard" | "new-shift" | "template" | "inbox" | "review" | "generate" | "preview";
type ReviewTab = "identity" | "history" | "exam" | "assessment" | "template";
type GeneratedArtifact = {
  blob: Blob;
  fileName: string;
  slideCount: number;
  previewSlides: string[];
  previewEngine: string;
  previewError: string;
  review?: PresentationReview;
};

type GenerationStage = "idle" | "building" | "rendering";
type PaymentStatus = "unpaid" | "paid";

// Temporary demo switch. Keep the real payment state and backend gate intact
// so this can be flipped off when the payment gateway is connected.
const DEMO_DOWNLOAD_MODE = true;

const EMPTY_SHIFT: ShiftDetails = {
  title: "Laporan Jaga Baru",
  date: new Date().toISOString().slice(0, 10),
  department: "",
  hospital: "",
  team: "",
  facilitator: "",
  dpjp: "",
  metadata: {},
};

function shiftFieldValue(shift: ShiftDetails, key: string): string {
  if (key.startsWith("metadata.")) return shift.metadata?.[key.slice("metadata.".length)] || "";
  if (!["title", "date", "department", "hospital", "team", "facilitator", "dpjp"].includes(key)) return shift.metadata?.[key] || "";
  return String((shift as unknown as Record<string, unknown>)[key] ?? "");
}

function setShiftFieldValue(shift: ShiftDetails, key: string, value: string): ShiftDetails {
  if (!["title", "date", "department", "hospital", "team", "facilitator", "dpjp"].includes(key) || key.startsWith("metadata.")) {
    const metadataKey = key.startsWith("metadata.") ? key.slice("metadata.".length) : key;
    return { ...shift, metadata: { ...(shift.metadata || {}), [metadataKey]: value } };
  }
  return { ...shift, [key]: value } as ShiftDetails;
}

const createInitialPatientDrafts = (): PatientDraft[] => [{ id: "draft-1", label: "Pasien 1", text: "", attachments: [] }];

function patientDraftLine(label: string, field?: ClinicalField<unknown>): string {
  const value = formatFieldValue(field);
  return value === "Tidak tercantum" ? "" : `${label}: ${value}`;
}

function patientRecordToDraftText(patient: PatientRecord): string {
  const lines = [
    patientDraftLine("Nama", patient.identifiers.name || patient.identifiers.initials),
    patientDraftLine("Usia", patient.demographics.age),
    patientDraftLine("Jenis kelamin", patient.demographics.sex),
    patientDraftLine("Keluhan utama", patient.chiefComplaint),
    patientDraftLine("Kegawatan", patient.urgency),
    patientDraftLine("Riwayat penyakit dahulu", patient.history.pastMedicalHistory),
    patientDraftLine("Riwayat penyakit keluarga", patient.history.familyHistory),
    patientDraftLine("Pemeriksaan fisik", patient.physicalExam.findings),
    patientDraftLine("Tanda vital", patient.physicalExam.vitalSigns.bloodPressure),
    patientDraftLine("Diagnosis", patient.assessment.workingDiagnosis),
    patientDraftLine("Pemeriksaan penunjang", patient.investigations.laboratory),
    patientDraftLine("Tata laksana", patient.management.medications),
    ...Object.entries(patient.templateData ?? {}).map(([key, field]) => patientDraftLine(key, field)),
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : `Nama: ${patient.displayName}`;
}

function fileSizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File tidak bisa dibaca."));
    reader.onerror = () => reject(reader.error ?? new Error("File tidak bisa dibaca."));
    reader.readAsDataURL(file);
  });
}

function attachmentKind(file: File): PatientAttachment["kind"] | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("audio/")) return "audio";
  return undefined;
}

function attachmentIcon(kind: PatientAttachment["kind"]): KoasisIconName {
  return kind === "image" ? "radiology" : kind === "audio" ? "audio" : kind === "pdf" ? "evidence" : "file";
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: KoasisIconName; hint?: string }> = [
  { id: "dashboard", label: "Overview", icon: "overview" },
  { id: "new-shift", label: "Laporan baru", icon: "report" },
  { id: "inbox", label: "Data pasien", icon: "patient", hint: "01" },
  { id: "review", label: "Review klinis", icon: "review", hint: "02" },
  { id: "template", label: "Struktur template", icon: "template", hint: "03" },
  { id: "generate", label: "Generate laporan", icon: "generate", hint: "04" },
];

const STATUS_META: Record<FieldStatus, { label: string; className: string; icon: typeof Check }> = {
  documented: { label: "Documented", className: "status-documented", icon: Check },
  inferred: { label: "Inferred", className: "status-inferred", icon: Sparkles },
  missing: { label: "Missing", className: "status-missing", icon: CircleDashed },
  conflicting: { label: "Conflict", className: "status-conflicting", icon: AlertTriangle },
  user_confirmed: { label: "Confirmed", className: "status-confirmed", icon: CircleCheck },
};

function toIndonesianDate(date: string): string {
  if (!date) return "Tanggal belum diatur";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T00:00:00`),
  );
}

function statusMeta(status?: FieldStatus) {
  return STATUS_META[status ?? "missing"];
}

function fieldAt(patient: PatientRecord, path: string): ClinicalField<unknown> | undefined {
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, patient);
  return value && typeof value === "object" && "status" in value ? (value as ClinicalField<unknown>) : undefined;
}

function clonePatient(patient: PatientRecord): PatientRecord {
  return JSON.parse(JSON.stringify(patient)) as PatientRecord;
}

function setFieldValue(patient: PatientRecord, path: string, rawValue: string): PatientRecord {
  const next = clonePatient(patient);
  const segments = path.split(".");
  const last = segments.pop();
  if (!last) return next;
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
  segments.forEach((segment) => {
    if (!target[segment] || typeof target[segment] !== "object") target[segment] = {};
    target = target[segment] as Record<string, unknown>;
  });
  const current = target[last] as ClinicalField<unknown> | undefined;
  let value: unknown = rawValue;
  if (path.endsWith("weightKg") || path.endsWith("heightCm") || path.endsWith("heartRate") || path.endsWith("respiratoryRate") || path.endsWith("temperature") || path.endsWith("spo2") || path.endsWith("headCircumference") || path.endsWith("birthWeight") || path.endsWith("muac")) {
    const parsed = Number(rawValue.replace(",", "."));
    value = Number.isFinite(parsed) ? parsed : undefined;
  }
  if (path.endsWith("workingDiagnosis") || path.endsWith("differentialDiagnosis")) {
    value = rawValue
      .split(/\n|[,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (path.startsWith("investigations.")) {
    value = rawValue
      .split(/\n|[;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ name: item }));
  }
  if (path.includes("management.")) {
    value = rawValue
      .split(/\n|[,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
  }
  target[last] = {
    ...(current ?? { confidence: 1, sources: [] }),
    value,
    status: "user_confirmed",
    confidence: 1,
  } satisfies ClinicalField<unknown>;
  if ((path === "identifiers.name" || path === "identifiers.initials") && rawValue.trim()) next.displayName = rawValue.trim();
  return next;
}

function slideRoleLabel(role: ParsedSlide["role"]): string {
  const labels: Record<ParsedSlide["role"], string> = {
    cover: "Cover",
    shift_summary: "Ringkasan jaga",
    patient_identity: "Identitas pasien",
    anamnesis: "Anamnesis",
    history: "Riwayat pasien",
    pediatric_assessment: "Pediatric assessment",
    primary_survey: "Primary survey",
    secondary_survey: "Secondary survey",
    anthropometry: "Antropometri",
    physical_exam: "Pemeriksaan fisik",
    investigation: "Pemeriksaan penunjang",
    diagnosis: "Diagnosis",
    management: "Tata laksana",
    timeline: "Timeline",
    patient_summary: "Ringkasan pasien",
    consultation: "Konsultasi",
    delivery_preparation: "Persiapan persalinan",
    resuscitation: "Resusitasi neonatus",
    stabilization: "Stabilisasi S.T.A.B.L.E.",
    checklist: "Checklist klinis",
    closing: "Penutup",
    unknown: "Belum terklasifikasi",
  };
  return labels[role];
}

function StatusBadge({ status, compact = false }: { status?: FieldStatus; compact?: boolean }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <span className={`status-badge ${meta.className} ${compact ? "compact" : ""}`}>
      <Icon size={compact ? 12 : 13} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function ProgressSteps({ active }: { active: number }) {
  const steps = ["Data laporan", "Pasien", "Review", "Template", "Hasil"];
  return (
    <div className="progress-steps">
      {steps.map((step, index) => (
        <Fragment key={step}>
          <div className={`progress-step ${index < active ? "done" : ""} ${index === active ? "active" : ""}`}>
            <span className="progress-dot">{index < active ? <Check size={13} /> : index + 1}</span>
            <span>{step}</span>
          </div>
          {index < steps.length - 1 && <span className="progress-line" />}
        </Fragment>
      ))}
    </div>
  );
}

function UploadDropzone({ accept, label, hint, onFile, busy = false, className = "" }: { accept: string; label: string; hint: string; onFile: (file: File) => void; busy?: boolean; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`upload-dropzone ${className} ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (busy) return;
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} />
      <div className="upload-icon"><KoasisIcon name="upload" size={22} /></div>
      <div className="upload-copy">
        <strong>{busy ? "Menganalisis file…" : label}</strong>
        <span>{hint}</span>
      </div>
      <button type="button" className="button button-ghost button-small" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>
        Pilih file
      </button>
    </div>
  );
}

function BulkPatientIntake({ onDetect, busy }: { onDetect: (text: string, label: string, attachments: PatientAttachment[]) => Promise<void>; busy: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [fileLabel, setFileLabel] = useState("");
  const [attachment, setAttachment] = useState<PatientAttachment | undefined>();
  const [error, setError] = useState("");

  const readBulkFile = async (file: File) => {
    setExpanded(true);
    setError("");
    if (file.size > 8 * 1024 * 1024) {
      setError(`${file.name} terlalu besar. Batas file daftar pasien adalah 8 MB.`);
      return;
    }
    try {
      const isDocx = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name);
      const isText = file.type.startsWith("text/") || /\.(?:txt|csv|tsv)$/i.test(file.name);
      if (isDocx || isText) {
        const content = isDocx ? await extractDocxText(file) : await file.text();
        setText(content);
        setAttachment(undefined);
        setFileLabel(file.name);
        return;
      }
      const kind = attachmentKind(file);
      if (!kind) {
        setError("Gunakan TXT, DOCX, CSV, TSV, PDF, gambar, atau audio untuk daftar pasien gabungan.");
        return;
      }
      setText("");
      setAttachment({ id: `bulk-attachment-${Date.now()}`, name: file.name, mimeType: file.type || `${kind}/*`, kind, sizeBytes: file.size, dataUrl: await readFileAsDataUrl(file) });
      setFileLabel(file.name);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : `${file.name} tidak bisa dibaca.`);
    }
  };

  const detectPatients = async () => {
    if (!text.trim() && !attachment) {
      setError("Tempel atau pilih file daftar pasien terlebih dahulu.");
      return;
    }
    try {
      await onDetect(text, fileLabel || "Daftar pasien gabungan", attachment ? [attachment] : []);
      setText("");
      setFileLabel("");
      setAttachment(undefined);
      setError("");
      setExpanded(false);
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : "Daftar pasien belum bisa dipisahkan.");
    }
  };

  return <section className={`panel bulk-intake-panel ${expanded ? "is-expanded" : "is-collapsed"} ${busy ? "is-processing" : ""}`} aria-busy={busy}>
    <div className="bulk-intake-header">
      <div className="bulk-intake-header-mark"><KoasisIcon name="patient" size={19} /></div>
      <div className="bulk-intake-header-copy"><div className="bulk-intake-eyebrow"><span className="eyebrow">Input cepat</span><span className="bulk-intake-badge">BULK</span></div><h3>Tambah banyak pasien sekaligus</h3><p>{expanded ? "Tempel daftar catatan, tabel, atau roster. Koasis akan mendeteksi batas tiap pasien dan memisahkannya menjadi record terpisah." : "Masukkan satu daftar pasien dan biarkan Koasis memisahkan recordnya otomatis."}</p></div>
      <button type="button" className="bulk-intake-toggle" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} disabled={busy}><span>{busy ? "Memproses…" : expanded ? "Tutup" : "Buka input massal"}</span>{busy ? <RefreshCw size={15} className="spin" /> : <ChevronRight size={15} />}</button>
    </div>
    {!expanded && <div className="bulk-intake-collapsed-meta"><span><KoasisIcon name="insight" size={13} /> Paste tabel atau tarik file daftar pasien</span><span className="bulk-intake-format-badge">TXT · DOCX · CSV · PDF</span></div>}
    {expanded && <>
      <div className="bulk-intake-grid">
        <div className="bulk-intake-editor"><textarea className="clinical-textarea bulk-patient-textarea" value={text} onChange={(event) => { setText(event.target.value); setAttachment(undefined); setFileLabel(""); setError(""); }} disabled={busy} placeholder={'Contoh:\nPASIEN BARU: 3 PASIEN\n1. QHS / 15 tahun | Syok hipovolemia e.c. diare akut | T\n2. ... / 15 tahun | Pucat e.c. AIHA | T'} /><div className="bulk-intake-hint"><KoasisIcon name="insight" size={14} /><span>Nomor baris, nama, usia, diagnosis, kegawatan, dan format tabel akan dibaca sesuai konteks—tidak perlu menata ulang secara manual.</span></div></div>
        <UploadDropzone className="bulk-patient-dropzone" accept=".txt,.docx,.csv,.tsv,.pdf,text/plain,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,audio/*" label={fileLabel || "Tarik file daftar pasien"} hint="TXT, DOCX, CSV, TSV, PDF, gambar, atau audio" onFile={(file) => { void readBulkFile(file); }} busy={busy} />
      </div>
      {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
      <div className="bulk-intake-footer"><span className={busy ? "is-processing" : ""} aria-live="polite">{busy ? <><RefreshCw size={14} className="spin" /> AI sedang membaca daftar dan menyiapkan kartu pasien…</> : <><KoasisIcon name="safety" size={14} /> Agent akan membaca daftar ini lalu membuat kartu terpisah untuk setiap pasien.</>}</span><button type="button" className="button button-dark" onClick={() => { void detectPatients(); }} disabled={busy || (!text.trim() && !attachment)} aria-busy={busy}>{busy ? <><RefreshCw size={15} className="spin" /> AI sedang membaca…</> : <><KoasisIcon name="insight" size={15} /> Deteksi per pasien</>}</button></div>
    </>}
  </section>;
}

function BuiltInTemplateList({ templates, loading, activeName, onSelect, compact = false }: { templates: BuiltInTemplateEntry[]; loading: boolean; activeName?: string; onSelect: (entry: BuiltInTemplateEntry) => void; compact?: boolean }) {
  if (loading) return <div className="built-in-loading"><RefreshCw size={14} className="spin" /> Memuat template bawaan…</div>;
  if (!templates.length) return <div className="built-in-empty"><KoasisIcon name="archive" size={15} /> Arsip template bawaan belum tersedia.</div>;
  return <div className={`built-in-list ${compact ? "compact" : ""}`}>{templates.map((entry) => <button className={`built-in-template-row ${activeName === entry.label ? "selected" : ""}`} key={entry.archivePath} onClick={() => onSelect(entry)}><span className="built-in-mini-icon"><KoasisIcon name="archive" size={15} /></span><span className="built-in-template-copy"><strong>{entry.label}</strong><small>Template bawaan · PPTX editable</small></span>{activeName === entry.label ? <Check size={14} className="built-in-selected" /> : <ChevronRight size={14} className="built-in-arrow" />}</button>)}</div>;
}

function EmptyState({ icon, title, description, action }: { icon: KoasisIconName; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><KoasisIcon name={icon} size={26} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function ProcessingState({ variant, icon, eyebrow, title, description, steps, activeStep = 0 }: { variant: "ai" | "render"; icon: KoasisIconName; eyebrow: string; title: string; description: string; steps: string[]; activeStep?: number }) {
  return (
    <div className={`processing-state processing-state-${variant}`} role="status" aria-live="polite">
      <div className="processing-visual" aria-hidden="true">
        <span className="processing-orbit" />
        <span className="processing-icon"><KoasisIcon name={icon} size={30} /></span>
      </div>
      <div className="processing-content">
        <span className="processing-eyebrow">{eyebrow}</span>
        <h4>{title}</h4>
        <p>{description}</p>
        <div className="processing-steps">
          {steps.map((step, index) => <span className={`processing-step ${index === activeStep ? "active" : ""} ${index < activeStep ? "done" : ""}`} key={step}>
            <span className="processing-step-dot">{index < activeStep ? <Check size={9} /> : index === activeStep ? <span /> : null}</span>
            {step}
          </span>)}
        </div>
        <div className="processing-bar" aria-label="Proses sedang berjalan"><span /></div>
      </div>
    </div>
  );
}

type UtilityPanel = "settings" | "help";

function UtilityModal({ panel, user, workspaceStatus, workspaceSyncError, onClose, onRetrySync, onStartReport, onSignOut }: {
  panel: UtilityPanel;
  user: FirebaseUser;
  workspaceStatus: string;
  workspaceSyncError: string;
  onClose: () => void;
  onRetrySync: () => void;
  onStartReport: () => void;
  onSignOut: () => void;
}) {
  const accountLabel = user.displayName?.trim() || user.email?.split("@")[0] || "Pengguna";
  const isSettings = panel === "settings";
  return (
    <div className="utility-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="utility-modal" role="dialog" aria-modal="true" aria-labelledby="utility-modal-title">
        <div className="utility-modal-header">
          <div>
            <span className="eyebrow">{isSettings ? "Preferensi workspace" : "Pusat bantuan"}</span>
            <h2 id="utility-modal-title">{isSettings ? "Pengaturan" : "Bantuan Koasis"}</h2>
          </div>
          <button type="button" className="icon-button utility-modal-close" aria-label="Tutup" onClick={onClose}><X size={18} /></button>
        </div>

        {isSettings ? (
          <>
            <p className="utility-modal-lead">Kelola akun dan cek status metadata workspace yang disinkronkan.</p>
            <div className="utility-account-card">
              <div className="user-avatar">{userInitial(user)}</div>
              <div><strong>{accountLabel}</strong><span>{user.email || "Akun Firebase"}</span></div>
            </div>
            <div className="utility-setting-list">
              <div className="utility-setting-row">
                <div className="utility-setting-icon"><KoasisIcon name="security" size={17} /></div>
                <div><strong>Data klinis tetap lokal</strong><span>Catatan pasien, attachment, dan file PPTX tidak ditulis ke Firestore.</span></div>
              </div>
              <div className="utility-setting-row">
                <div className="utility-setting-icon"><KoasisIcon name="safety" size={17} /></div>
                <div><strong>Metadata workspace</strong><span>{workspaceSyncError || workspaceStatus}</span></div>
                <span className={`utility-sync-dot ${workspaceSyncError ? "error" : workspaceStatus.startsWith("Menyinkronkan") ? "loading" : ""}`} />
              </div>
            </div>
            <div className="utility-modal-footer">
              <button type="button" className="button button-ghost" onClick={onRetrySync}><RefreshCw size={14} /> Cek sinkronisasi</button>
              <button type="button" className="button button-dark" onClick={onSignOut}><LogOut size={14} /> Keluar</button>
            </div>
          </>
        ) : (
          <>
            <p className="utility-modal-lead">Ikuti alur singkat ini untuk membuat laporan jaga pertama.</p>
            <div className="utility-help-list">
              <div><span>01</span><div><strong>Pilih template</strong><small>Upload PPTX sendiri atau gunakan template bawaan Koasis.</small></div></div>
              <div><span>02</span><div><strong>Masukkan data pasien</strong><small>Tempel catatan atau tarik TXT, DOCX, PDF, gambar, dan audio ke kartu pasien.</small></div></div>
              <div><span>03</span><div><strong>Review lalu generate</strong><small>Periksa field klinis dan evidence sebelum membuat preview serta PPTX.</small></div></div>
            </div>
            <div className="utility-help-note"><KoasisIcon name="insight" size={16} /><span>Jika preview atau ekstraksi gagal, periksa status template dan pastikan source pasien tidak kosong.</span></div>
            <div className="utility-modal-footer utility-help-footer">
              <button type="button" className="button button-ghost" onClick={onClose}>Tutup</button>
              <button type="button" className="button button-dark" onClick={onStartReport}><Plus size={14} /> Mulai laporan baru</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Dashboard({ shift, template, patients, onCreate, onNavigate }: { shift: ShiftDetails; template: ParsedTemplate | null; patients: PatientRecord[]; onCreate: () => void; onNavigate: (view: View) => void }) {
  const hasReport = Boolean(template || patients.length || shift.title !== EMPTY_SHIFT.title);
  return (
    <div className="page dashboard-page">
      <div className="dashboard-topline">
        <div>
          <div className="eyebrow">Ruang kerja laporan jaga</div>
          <h1>Selamat datang, <span>Dek Koas!</span></h1>
          <p>Susun data jaga yang tercecer menjadi presentasi klinis yang siap direview.</p>
        </div>
      </div>

      <div className="hero-grid">
        <div className="hero-card">
          <div className="hero-pattern" />
          <div className="hero-content">
            <div className="hero-kicker"><KoasisIcon name="spark" size={15} /> Clinical information compiler</div>
            <h2>Jaga selesai.<br /><em>Laporan lebih siap.</em></h2>
            <p>Upload template departemen, masukkan catatan pasien, lalu review setiap fakta sebelum diekspor ke PowerPoint.</p>
            <button className="button button-light" onClick={onCreate}><Plus size={16} /> Buat laporan baru <ArrowRight size={16} /></button>
          </div>
          <div className="hero-mark"><img src="/koasis-favicon.png" alt="" /></div>
        </div>
        <div className="workflow-card">
          <div className="card-heading"><div><span className="eyebrow">Cara kerja</span><h3>Dari catatan ke deck</h3></div><KoasisIcon name="workflow" size={20} /></div>
          <div className="workflow-list">
            {[
              ["01", "Parse template", "Shape & layout dibaca langsung dari PPTX"],
              ["02", "Review fakta", "Setiap nilai tetap punya evidence source"],
              ["03", "Export editable", "Slide digandakan tanpa merombak desain"],
            ].map(([number, title, copy]) => <div className="workflow-item" key={number}><span>{number}</span><div><strong>{title}</strong><p>{copy}</p></div></div>)}
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card"><div className="metric-icon blue"><KoasisIcon name="archive" size={18} /></div><div><span>Template aktif</span><strong>{template ? template.slideCount : "—"}<small>{template ? " slides" : " belum ada"}</small></strong></div><span className="metric-note">{template ? "Siap dipetakan" : "Upload PPTX"}</span></div>
        <div className="metric-card"><div className="metric-icon mint"><KoasisIcon name="patient" size={18} /></div><div><span>Pasien terdeteksi</span><strong>{patients.length || "—"}</strong></div><span className="metric-note">{patients.length ? "Perlu direview" : "Belum ada data"}</span></div>
        <div className="metric-card"><div className="metric-icon peach"><KoasisIcon name="report" size={18} /></div><div><span>Status laporan</span><strong>{hasReport ? "Draft" : "Kosong"}</strong></div><span className="metric-note">{hasReport ? "Local workspace" : "Mulai dari nol"}</span></div>
      </div>

      <div className="dashboard-lower">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><span className="eyebrow">Workspace terakhir</span><h3>{hasReport ? shift.title : "Belum ada laporan"}</h3></div><button className="icon-button" onClick={() => onNavigate(hasReport ? "new-shift" : "new-shift")}><ChevronRight size={17} /></button></div>
          {hasReport ? <div className="recent-report"><div className="report-type-icon"><KoasisIcon name="activity" size={20} /></div><div className="report-info"><strong>{shift.title}</strong><span>{shift.department || "Departemen belum diatur"} · {toIndonesianDate(shift.date)}</span><div className="report-progress"><span style={{ width: `${template ? (patients.length ? 72 : 38) : 16}%` }} /></div></div><span className="draft-label">Draft</span></div> : <EmptyState icon="report" title="Mulai laporan jaga pertama" description="Satu workspace untuk template, sumber, review, dan hasil akhir." action={<button className="button button-dark button-small" onClick={onCreate}><Plus size={14} /> Buat laporan</button>} />}
        </section>
        <section className="panel principle-panel">
          <div className="principle-quote">“</div>
          <span className="eyebrow">Prinsip Koasis</span>
          <h3>AI membaca informasi.<br /><span>Kode menjaga bentuknya.</span></h3>
          <p>Data klinis dinormalisasi dan diverifikasi dulu, baru dipetakan kembali ke template asli.</p>
          <div className="principle-footer"><KoasisIcon name="safety" size={16} /> Tidak ada nilai yang diisi diam-diam</div>
        </section>
      </div>
    </div>
  );
}

function NewShiftPage({ shift, setShift, template, builtInTemplates, builtInLoading, onBuiltInTemplate, onTemplate, onChangeTemplate, onContinue, busy, error }: { shift: ShiftDetails; setShift: (next: ShiftDetails) => void; template: ParsedTemplate | null; builtInTemplates: BuiltInTemplateEntry[]; builtInLoading: boolean; onBuiltInTemplate: (entry: BuiltInTemplateEntry) => void; onTemplate: (file: File) => void; onChangeTemplate: () => void; onContinue: () => void; busy: boolean; error: string }) {
  if (!template) {
    return (
      <div className="page">
        <ProgressSteps active={0} />
        <SectionHeading eyebrow="Langkah 01 · Template" title="Pilih template laporan dulu" description="Koasis akan membaca struktur template terlebih dahulu, lalu menyesuaikan panduan pengisian dan mapping klinisnya." action={<div className="autosave"><CircleCheck size={14} /> Tersimpan di perangkat ini</div>} />
        <section className="panel template-first-panel">
          <div className="template-first-grid">
            <div>
          <div className="panel-heading"><div><span className="eyebrow">Template bawaan Koasis</span><h3>Mulai dari format yang sudah dipelajari</h3><p>Template bawaan sudah memiliki panduan slide, chart, dan aturan pengisian yang spesifik.</p></div><KoasisIcon name="archive" size={20} /></div>
              <BuiltInTemplateList templates={builtInTemplates} loading={builtInLoading} onSelect={onBuiltInTemplate} />
            </div>
            <div className="template-first-upload"><div className="template-empty-divider"><span>atau</span></div><span className="eyebrow">Template sendiri</span><h3>Upload PPTX departemen</h3><p>Template lain tetap bisa dipakai; Koasis akan menganalisis shape dan mapping dari awal.</p><UploadDropzone accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" label="Upload template sendiri" hint="Maks. 20 MB · file PPTX" onFile={onTemplate} busy={busy} /></div>
          </div>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
        </section>
      </div>
    );
  }
  const profile = getTemplateProfile(template);
  const genericContextFields = profile.id === "generic" && !template.templateAnalysis
    ? [
        { key: "department", label: "Departemen", placeholder: "Contoh: Pediatri" },
        { key: "hospital", label: "Rumah sakit", placeholder: "Nama rumah sakit" },
      ]
    : [];
  const contextFieldCount = 1 + profile.shiftFields.length + genericContextFields.length;
  return (
    <div className="page">
      <ProgressSteps active={0} />
      <SectionHeading eyebrow={`Langkah 01 · ${profile.label}`} title="Atur konteks laporan jaga" description={`${profile.description} Field di bawah mengikuti metadata yang dibutuhkan template ini.`} action={<div className="autosave"><CircleCheck size={14} /> Tersimpan di perangkat ini</div>} />
      <div className="form-layout">
        <section className="panel form-panel">
          <div className="panel-heading"><div><h3>Detail laporan</h3><p>Informasi ini akan mengisi cover dan metadata presentasi.</p></div><KoasisIcon name="report" size={20} /></div>
          <div className="form-grid">
            <label className="field-label full"><span className="field-label-text">Judul laporan</span><input value={shift.title} onChange={(event) => setShift({ ...shift, title: event.target.value })} placeholder="Contoh: Laporan Jaga Pediatri" /></label>
            <div className={`context-field-grid ${contextFieldCount % 2 === 1 ? "has-odd" : ""}`}>
              <label className="field-label"><span className="field-label-text">Tanggal jaga</span><input type="date" value={shift.date} onChange={(event) => setShift({ ...shift, date: event.target.value })} /></label>
              {profile.shiftFields.map((fieldSpec) => <label className="field-label" key={fieldSpec.key}><span className="field-label-text">{fieldSpec.label}{fieldSpec.required && <span className="required-mark">*</span>}</span><input value={shiftFieldValue(shift, fieldSpec.key)} onChange={(event) => setShift(setShiftFieldValue(shift, fieldSpec.key, event.target.value))} placeholder={fieldSpec.placeholder} aria-required={fieldSpec.required || undefined} /></label>)}
              {genericContextFields.map((fieldSpec) => <label className="field-label" key={fieldSpec.key}><span className="field-label-text">{fieldSpec.label}</span><input value={shiftFieldValue(shift, fieldSpec.key)} onChange={(event) => setShift(setShiftFieldValue(shift, fieldSpec.key, event.target.value))} placeholder={fieldSpec.placeholder} /></label>)}
            </div>
          </div>
          <div className="form-footer"><div className="form-footer-left"><button className="button button-ghost button-small" onClick={onChangeTemplate}><ArrowLeft size={14} /> Ganti template</button></div><button className="button button-dark" onClick={onContinue}>Lanjutkan <ArrowRight size={16} /></button></div>
        </section>
        <aside className="panel side-info-panel">
          <div className="panel-heading"><div><span className="eyebrow">Template inti</span><h3>Gunakan PPTX asli</h3></div><KoasisIcon name="template" size={20} /></div>
          <p>Koasis membaca struktur shape, layout, dan teks dari template. File asli tetap menjadi sumber desain.</p>
          <div className="attached-template"><div className="file-icon"><KoasisIcon name="archive" size={19} /></div><div><strong>{template.name}</strong><span>{template.slideCount} slide · {template.templateValidation?.valid ? "kontrak klinis tervalidasi" : "menunggu validasi kontrak"} · {profile.label}</span></div>{template.templateValidation?.valid ? <CircleCheck className="success-icon" size={18} /> : <AlertTriangle className="warning-icon" size={18} />}</div>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
          <div className="side-info-list"><div><Check size={14} /> Layout asli dipertahankan</div><div><Check size={14} /> Shape bisa dikoreksi manual</div><div><Check size={14} /> Output tetap editable</div></div>
        </aside>
      </div>
    </div>
  );
}

function TemplatePage({ template, setTemplate, onContinue, onBack }: { template: ParsedTemplate | null; setTemplate: (template: ParsedTemplate) => void; onContinue: () => void; onBack: () => void }) {
  const [previewSlides, setPreviewSlides] = useState<string[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const setIncluded = (slideIndex: number, include: boolean) => {
    if (!template) return;
    const slides = template.slides.map((slide) => slide.index === slideIndex
      ? { ...slide, include }
      : slide);
    const templateAnalysis = template.templateAnalysis
      ? { ...template.templateAnalysis, slideGuides: template.templateAnalysis.slideGuides.map((guide) => guide.index === slideIndex
        ? { ...guide, include }
        : guide) }
      : undefined;
    const nextTemplate = { ...template, slides, templateAnalysis };
    const validation = validateTemplateContract(nextTemplate);
    setTemplate({
      ...nextTemplate,
      templateValidation: validation,
      templateAnalysis: templateAnalysis ? { ...templateAnalysis, validation } : undefined,
      analysisStatus: validation.valid ? "ready" : "needs_review",
    });
  };

  useEffect(() => {
    let cancelled = false;
    if (!template?.raw) {
      setPreviewSlides([]);
      setPreviewError("");
      return () => { cancelled = true; };
    }
    setPreviewBusy(true);
    setPreviewError("");
    renderPresentationForPreview(new Blob([template.raw], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }))
      .then((rendered) => {
        if (!cancelled) setPreviewSlides(rendered.slides);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : "Preview template belum tersedia.");
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });
    return () => { cancelled = true; };
  }, [template?.id, template?.raw]);

  if (!template) return <div className="page"><ProgressSteps active={3} /><SectionHeading eyebrow="Langkah 04 · Struktur template" title="Template belum dipilih" description="Pemilihan template dilakukan di awal laporan baru." /><section className="panel template-empty-picker"><EmptyState icon="archive" title="Belum ada template aktif" description="Kembali ke data laporan untuk memilih template bawaan atau upload template sendiri." action={<button className="button button-dark" onClick={onBack}>Kembali ke data laporan</button>} /></section></div>;
  const validation = validateTemplateContract(template);
  const learningStatus = template.templateAnalysis?.learningStatus;
  const contractLabel = learningStatus === "agent" ? "Dipelajari agent" : learningStatus === "trusted_profile" ? "Kontrak bawaan tervalidasi" : "Perlu dipelajari agent";
  return (
    <div className="page">
      <ProgressSteps active={3} />
      <SectionHeading eyebrow="Langkah 04 · Struktur template" title="Konfirmasi struktur template" description="Tinjau urutan slide dan pilih slide yang ingin disertakan. Tabel pembuka tetap memakai semua pasien, sedangkan slide klinis mengikuti satu kasus utama." action={<div className="template-confidence"><span className="confidence-dot" /> {template.slides.filter((slide) => slide.repeat && slideIsIncluded(slide)).length} slide detail</div>} />
      <div className={`template-contract-strip ${validation.valid ? "" : "warning"}`}><span className="template-contract-icon">{validation.valid ? <CircleCheck size={15} /> : <AlertTriangle size={15} />}</span><span>{validation.valid ? <>Mapping klinis otomatis sudah aktif untuk <strong>{template.name}</strong>. Ringkasan awal memakai semua pasien; slide klinis memakai satu kasus utama. Atur output dengan kotak <strong>Sertakan slide ini</strong>.</> : <>Template <strong>{template.name}</strong> belum aman untuk generate. Koasis menahan render sampai kontrak slide dan field dipelajari serta divalidasi.</>}</span><span className="template-contract-source">{contractLabel}</span></div>
      {!validation.valid && <div className="template-validation-panel error"><div><AlertTriangle size={15} /><strong>Quality gate template</strong></div><ul>{validation.errors.slice(0, 5).map((message) => <li key={message}>{message}</li>)}</ul>{validation.warnings.length > 0 && <p>{validation.warnings.slice(0, 3).join(" ")}</p>}</div>}
      {validation.valid && validation.warnings.length > 0 && <div className="template-validation-panel warning"><div><AlertTriangle size={15} /><strong>Catatan kontrak</strong></div><p>{validation.warnings.slice(0, 4).join(" ")}</p></div>}
      <div className="template-summary-grid"><div className="template-summary"><div className="summary-icon"><KoasisIcon name="archive" size={18} /></div><div><span>File template</span><strong>{template.name}</strong></div><span className="summary-meta">{template.fileName}</span></div><div className="template-summary"><div className="summary-icon purple"><KoasisIcon name="template" size={18} /></div><div><span>Slide terdeteksi</span><strong>{template.slideCount} slide</strong></div><span className="summary-meta">{template.slides.filter(slideIsIncluded).length} disertakan</span></div><div className="template-summary"><div className="summary-icon orange"><KoasisIcon name="overview" size={18} /></div><div><span>Slide detail</span><strong>{template.slides.filter((slide) => slide.repeat && slideIsIncluded(slide)).length} slide</strong></div><span className="summary-meta">untuk kasus utama</span></div></div>
      <section className="panel template-overview-panel">
        <div className="panel-heading compact-heading"><div><h3>Overview slide template</h3><p>Preview menunjukkan layout asli. Teks yang terlihat adalah contoh dari template, bukan data pasien baru.</p></div><KoasisIcon name="template" size={18} /></div>
        {previewBusy && <ProcessingState variant="render" icon="template" eyebrow="Template preview · proses aktif" title="Menyiapkan overview slide" description="Koasis sedang membaca layout asli dan menyiapkan thumbnail agar struktur template bisa kamu periksa sebelum lanjut." steps={["Membaca layout", "Menyiapkan thumbnail", "Menampilkan mapping"]} activeStep={1} />}
        {previewError && <div className="template-preview-status warning"><AlertTriangle size={14} /> Preview visual belum tersedia; struktur slide tetap bisa diatur.</div>}
        <div className="template-slide-grid">
          {template.slides.map((slide) => {
            const preview = previewSlides[slide.index];
            const inclusion = slideInclusion(slide);
            const included = slideIsIncluded(slide);
            const scopeLabel = slide.patientScope === "all_patients" ? "Semua pasien" : slide.patientScope === "focus_patient" ? "Detail kasus utama" : "Sekali";
            const statusLabel = !included ? "Tidak disertakan" : inclusion === "example" ? "Contoh · opsional" : inclusion === "optional" ? "Opsional · dipilih" : scopeLabel;
            return <article className={`template-slide-card ${slide.repeat && included ? "is-repeat" : ""} ${!included ? "is-excluded" : ""} inclusion-${inclusion}`} key={slide.index}>
              <div className="template-slide-card-head"><span>SLIDE {String(slide.index + 1).padStart(2, "0")}</span><span className={`template-slide-status ${!included ? "excluded" : inclusion !== "routine" ? "optional" : slide.repeat ? "repeat" : "static"}`}>{statusLabel}</span></div>
              <div className="template-slide-preview">{preview ? <img src={preview} alt={`Preview slide ${slide.index + 1}`} /> : <div className="template-slide-placeholder"><span>{String(slide.index + 1).padStart(2, "0")}</span><strong>{slide.title || `Slide ${slide.index + 1}`}</strong><small>{slide.shapes.length} elemen terbaca</small></div>}</div>
              <div className="template-slide-copy"><strong title={slide.title || `Slide ${slide.index + 1}`}>{slide.title || `Slide ${slide.index + 1}`}</strong><span>{slideRoleLabel(slide.role)} · {scopeLabel} · {slide.shapes.length} elemen</span></div>
              <label className="template-include-control"><input type="checkbox" checked={included} onChange={(event) => setIncluded(slide.index, event.target.checked)} /><span>Sertakan slide ini</span></label>
              {!included && slide.inclusionReason && <small className="template-inclusion-reason">{slide.inclusionReason}</small>}
            </article>;
          })}
        </div>
      </section>
      <div className="template-overview-note"><KoasisIcon name="safety" size={15} /><span>Field klinis dan mapping shape sudah dikendalikan oleh kontrak template. Anda tidak perlu memilih semantic field satu per satu.</span></div>
      <div className="page-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke review</button><button className="button button-dark" onClick={onContinue} disabled={!validation.valid}>Simpan struktur & lanjut ke generate <ArrowRight size={16} /></button></div>
    </div>
  );
}

function AttachmentList({ attachments, onRemove, label = "Evidence multimodal" }: { attachments: PatientAttachment[]; onRemove: (attachmentId: string) => void; label?: string }) {
  if (!attachments.length) return null;
  return <div className="attachment-list"><span className="attachment-list-label">{label}</span>{attachments.map((attachment) => { const icon = attachmentIcon(attachment.kind); return <div className="attachment-item" key={attachment.id}><KoasisIcon name={icon} size={15} /><span><strong>{attachment.name}</strong><small>{attachment.kind.toUpperCase()} · {fileSizeLabel(attachment.sizeBytes)}</small></span><button type="button" className="icon-button" title="Hapus attachment" onClick={() => onRemove(attachment.id)}><X size={14} /></button></div>; })}</div>;
}

function InboxPage({ template, drafts, focusDraftId, onFocusDraft, onDraftTextChange, onDraftFile, onRemoveAttachment, onAddDraft, onDetectBulk, onRemoveDraft, sources, patients, onAnalyze, onContinue, analysisBusy, analysisEngine, error }: { template: ParsedTemplate | null; drafts: PatientDraft[]; focusDraftId: string; onFocusDraft: (draftId: string) => void; onDraftTextChange: (draftId: string, text: string) => void; onDraftFile: (draftId: string, file: File) => void; onRemoveAttachment: (draftId: string, attachmentId: string) => void; onAddDraft: () => void; onDetectBulk: (text: string, label: string, attachments?: PatientAttachment[]) => Promise<void>; onRemoveDraft: (draftId: string) => void; sources: SourceItem[]; patients: PatientRecord[]; onAnalyze: () => void; onContinue: () => void; analysisBusy: boolean; analysisEngine: "none" | "ai" | "local" | "mixed"; error: string }) {
  const profile = getTemplateProfile(template);
  const profileTags = profile.id === "lapjag" ? ["PAT terpisah", "WHO siap diplot"] : profile.id.startsWith("perina") ? ["Resusitasi 0–15 mnt", "S.T.A.B.L.E."] : profile.id === "rscm" ? ["PAT + AMPLE", "Diagnosis awal/akhir"] : profile.id === "rsui" ? ["PAT checklist", "Lab + AGD"] : ["Mapping slide", "Profile adaptif"];
  const patientDraftCards = drafts.filter((draft) => !draft.bulkSource);
  const patientNumberAt = (draftIndex: number) => patientDraftCards.slice(0, draftIndex + 1).length;
  return (
    <div className="page">
      <ProgressSteps active={1} />
      <SectionHeading eyebrow={`Langkah 02 · Clinical inbox · ${profile.label}`} title="Masukkan semua pasien baru" description={`Pisahkan daftar bulk lewat input cepat atau isi kartu individual. Semua pasien masuk ke tabel ringkasan awal; pilih satu kasus utama untuk dibahas mendalam sesuai kontrak ${profile.label}.`} action={<div className="privacy-chip"><KoasisIcon name="security" size={14} /> Jangan masukkan data yang tidak perlu</div>} />
      <section className="panel template-guide-panel"><div className="template-guide-icon"><KoasisIcon name="review" size={18} /></div><div><span className="eyebrow">Kontrak ekstraksi aktif</span><h3>{profile.label}</h3><p>{profile.description} {profile.patientInputHint}</p></div><div className="template-guide-tags">{profileTags.map((tag) => <span key={tag}>{tag}</span>)}<span>TXT + DOCX</span><span>PDF + gambar + audio</span></div></section>
      <div className="patient-scope-note"><KoasisIcon name="patient" size={16} /><div><strong>Semua pasien tetap tercatat di tabel awal.</strong><span>Kasus utama saja yang akan menerima rangkaian slide klinis lengkap. Pilihan ini masih bisa diganti pada tahap review.</span></div></div>
      <BulkPatientIntake onDetect={onDetectBulk} busy={analysisBusy} />
      <div className="inbox-layout">
        <section className="panel source-panel">
          <div className="panel-heading"><div><h3>Data pasien per kartu</h3><p>Setiap kartu di sini mewakili satu pasien yang sudah terpisah dan siap direview.</p></div><KoasisIcon name="patient" size={20} /></div>
          <div className="patient-input-list">
            {patientDraftCards.map((draft, index) => <div className="patient-input-card" key={draft.id}>
              <div className="patient-input-head"><div className="patient-input-title"><span className="patient-input-number">{String(patientNumberAt(index)).padStart(2, "0")}</span><div><strong>{draft.label}</strong><span>Source khusus pasien ini</span></div></div><label className={`focus-patient-control ${focusDraftId === draft.id ? "selected" : ""}`}><input type="radio" name="focus-patient" checked={focusDraftId === draft.id} onChange={() => onFocusDraft(draft.id)} /><span><strong>Kasus utama</strong><small>Dibahas mendalam</small></span></label>{patientDraftCards.length > 1 && <button className="icon-button remove-patient" title="Hapus pasien" onClick={() => onRemoveDraft(draft.id)}><X size={15} /></button>}</div>
              <div className="free-text-source"><div className="free-text-heading"><div><strong>Catatan klinis pasien</strong><span>Tempel catatan mentah apa adanya. Agent akan mengekstrak, memahami konteks, dan menata ke slide sesuai template.</span></div><span className="source-mode-badge">free text</span></div><textarea className="clinical-textarea patient-textarea" value={draft.text} onChange={(event) => onDraftTextChange(draft.id, event.target.value)} placeholder={profile.patientInputHint} /></div>
              <AttachmentList attachments={draft.attachments ?? []} onRemove={(attachmentId) => onRemoveAttachment(draft.id, attachmentId)} />
              <UploadDropzone className="patient-evidence-dropzone" accept=".txt,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,image/*,audio/*" label="Tambah evidence pasien" hint="Tarik & lepas file atau klik · TXT, DOCX, PDF, gambar, audio" onFile={(file) => { void onDraftFile(draft.id, file); }} busy={analysisBusy} />
            </div>)}
          </div>
          <button className="add-patient-button add-patient-input" onClick={onAddDraft}><Plus size={14} /> Tambah pasien</button>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
        </section>
        <aside className="panel sources-panel">
          <div className="panel-heading"><div><span className="eyebrow">Evidence inbox</span><h3>Sumber masuk</h3></div><span className="source-count">{sources.length}</span></div>
          {sources.length ? <div className="source-list">{sources.map((source) => { const sourceIcon: KoasisIconName = source.type === "image" ? "radiology" : source.type === "audio" ? "audio" : source.type === "pdf" ? "evidence" : "file"; return <div className="source-item" key={source.id}><div className="source-file-icon"><KoasisIcon name={sourceIcon} size={16} /></div><div><strong>{source.name}</strong><span>{source.patientLabel ? `${source.patientLabel} · ` : ""}{source.sizeLabel || "Raw text"}</span></div><StatusBadge status={source.status === "ready" ? "documented" : source.status === "unsupported" ? "missing" : "inferred"} compact /></div>; })}</div> : <div className="mini-empty"><KoasisIcon name="evidence" size={19} /><span>Belum ada source.<br />Setiap kartu pasien akan muncul di sini.</span></div>}
          <div className="source-policy"><KoasisIcon name="safety" size={15} /><span>Setiap nilai hasil ekstraksi menyimpan snippet sumber untuk review.</span></div>
        </aside>
      </div>
      <section className={`panel detection-panel ${analysisBusy ? "is-processing" : ""}`}>
        <div className="detection-copy"><div className="detection-icon"><KoasisIcon name="insight" size={21} /></div><div><span className="eyebrow">{analysisEngine === "ai" ? "AI agent · backend extraction" : analysisEngine === "mixed" ? "AI agent + local fallback" : analysisEngine === "local" ? "Local fallback extraction" : "AI agent siap membaca"}</span><h3>{patients.length ? `${patients.length} pasien terdeteksi` : "Siap membaca catatan"}</h3><p>{patients.length ? "Semua pasien akan masuk tabel ringkasan. Satu kasus utama akan diteruskan ke slide klinis mendalam." : "Catatan dikirim ke AI agent melalui backend lokal. Nilai hasil ekstraksi tetap perlu direview sebelum export."}</p></div></div>
        {analysisBusy ? <ProcessingState variant="ai" icon="insight" eyebrow="AI agent · proses aktif" title="Membaca catatan pasien" description="Koasis sedang memisahkan pasien, mencocokkan field dengan kontrak template, dan menyiapkan data untuk review." steps={["Membaca source", "Memetakan field", "Menyiapkan review"]} /> : patients.length ? <div className="detected-patients">{patients.map((patient) => <div className="detected-chip" key={patient.id}><span>{patient.displayName.slice(0, 1).toUpperCase()}</span>{patient.displayName}<Check size={13} /></div>)}</div> : <div className="detection-placeholder"><span>Pasien</span><span>Data klinis</span><span>Status field</span></div>}
        <div className="detection-actions"><button className="button button-dark" onClick={onAnalyze} disabled={analysisBusy}><RefreshCw size={15} className={analysisBusy ? "spin" : ""} /> {analysisBusy ? "AI sedang membaca…" : patients.length ? "Analisis ulang" : "Deteksi pasien"}</button>{patients.length > 0 && <button className="button button-ghost" onClick={onContinue}>Lanjut review <ArrowRight size={15} /></button>}</div>
      </section>
    </div>
  );
}

function FieldCard({ label, path, patient, multiline = false, onChange }: { label: string; path: string; patient: PatientRecord; multiline?: boolean; onChange: (path: string, value: string) => void }) {
  const field = fieldAt(patient, path);
  const meta = statusMeta(field?.status);
  const Icon = meta.icon;
  const value = field ? formatFieldValue(field) : "Tidak tercantum";
  return (
    <div className={`field-card ${meta.className}`}>
      <div className="field-card-head"><span>{label}</span><StatusBadge status={field?.status} compact /></div>
      <div className="field-editor"><textarea value={value === "Tidak tercantum" ? "" : value} rows={multiline ? 3 : 1} placeholder="Tidak tercantum" onChange={(event) => onChange(path, event.target.value)} /><button className="field-edit"><Pencil size={13} /></button></div>
      {field?.status === "conflicting" && field.alternatives?.length ? <div className="conflict-note"><AlertTriangle size={13} /> Alternatif: {field.alternatives.map(String).join(" · ")}</div> : null}
      {field?.sources?.[0] && <div className="evidence-line"><Icon size={12} /><span>{field.sources[0].textSnippet || "Source tersedia"}</span></div>}
    </div>
  );
}

function ReviewPage({ template, patients, activePatientId, setActivePatientId, focusPatientId, onFocusPatient, onUpdate, onContinue, onBack }: { template: ParsedTemplate | null; patients: PatientRecord[]; activePatientId: string; setActivePatientId: (id: string) => void; focusPatientId: string; onFocusPatient: (id: string) => void; onUpdate: (patientId: string, path: string, value: string) => void; onContinue: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<ReviewTab>("identity");
  const patient = patients.find((item) => item.id === activePatientId) ?? patients[0];
  const profile = getTemplateProfile(template);
  const lapjag = profile.id === "lapjag";
  const fields: Record<ReviewTab, Array<{ label: string; path: string; multiline?: boolean }>> = {
    identity: [
      { label: "Nama / inisial", path: "identifiers.name" },
      { label: "Nomor rekam medis", path: "identifiers.medicalRecordNumber" },
      { label: "Usia", path: "demographics.age" },
      { label: "Jenis kelamin", path: "demographics.sex" },
      { label: "Kegawatan (T/F)", path: "urgency" },
      { label: "Berat badan (kg)", path: "demographics.weightKg" },
      { label: "Tinggi / panjang badan (cm)", path: "demographics.heightCm" },
      { label: "Keluhan utama", path: "chiefComplaint", multiline: true },
      { label: "Waktu datang", path: "admission.arrivalTime" },
      { label: "Asal rujukan", path: "admission.referralSource" },
    ],
    history: [
      { label: "Riwayat penyakit sekarang", path: "history.presentIllness", multiline: true },
      { label: "Riwayat penyakit dahulu", path: "history.pastMedicalHistory", multiline: true },
      { label: "Riwayat obat", path: "history.medicationHistory", multiline: true },
      { label: "Alergi", path: "history.allergyHistory", multiline: true },
      { label: "Riwayat lahir", path: "history.birthHistory", multiline: true },
      { label: "Imunisasi", path: "history.immunizationHistory", multiline: true },
      { label: "Riwayat keluarga", path: "history.familyHistory", multiline: true },
      { label: "Riwayat nutrisi", path: "history.nutritionHistory", multiline: true },
      { label: "Riwayat sosioekonomi", path: "history.socioeconomicHistory", multiline: true },
    ],
    exam: [
      { label: "Keadaan umum", path: "physicalExam.generalAppearance", multiline: true },
      { label: "Kesadaran", path: "physicalExam.consciousness" },
      { label: "Tekanan darah", path: "physicalExam.vitalSigns.bloodPressure" },
      { label: "Denyut jantung", path: "physicalExam.vitalSigns.heartRate" },
      { label: "Laju napas", path: "physicalExam.vitalSigns.respiratoryRate" },
      { label: "Suhu", path: "physicalExam.vitalSigns.temperature" },
      { label: "SpO₂", path: "physicalExam.vitalSigns.spo2" },
      { label: "Temuan pemeriksaan", path: "physicalExam.findings", multiline: true },
    ],
    assessment: [
      { label: "Diagnosis kerja", path: "assessment.workingDiagnosis", multiline: true },
      { label: "Diagnosis banding", path: "assessment.differentialDiagnosis", multiline: true },
      { label: "Laboratorium", path: "investigations.laboratory", multiline: true },
      { label: "Radiologi / imaging", path: "investigations.imaging", multiline: true },
      { label: "Obat", path: "management.medications", multiline: true },
      { label: "Cairan", path: "management.fluids", multiline: true },
      { label: "Tindakan", path: "management.procedures", multiline: true },
      { label: "Disposisi", path: "disposition", multiline: true },
    ],
    template: profile.fieldGroups.flatMap((group) => group.fields.map((spec) => ({ label: `${group.label} · ${spec.label}`, path: spec.key, multiline: spec.multiline }))),
  };
  if (!patient) return <div className="page"><EmptyState icon="patient" title="Belum ada pasien" description="Kembali ke data pasien untuk menjalankan ekstraksi." action={<button className="button button-dark" onClick={onBack}>Kembali ke inbox</button>} /></div>;
  const tabs: ReviewTab[] = ["identity", "history", "exam", "assessment", ...(profile.fieldGroups.length ? ["template" as const] : [])];
  const fieldList = fields[tab] || fields.identity;
  const documented = fieldList.filter(({ path }) => fieldAt(patient, path)?.status === "documented" || fieldAt(patient, path)?.status === "user_confirmed").length;
  return (
    <div className="page">
      <ProgressSteps active={2} />
      <SectionHeading eyebrow="Langkah 03 · Human review" title="Review informasi klinis" description="Konfirmasi nilai yang ingin dibawa ke slide. Nilai kosong tetap kosong sampai Anda mengisinya." action={<div className="review-counter"><CircleCheck size={14} /> {documented}/{fieldList.length} field terisi</div>} />
      <div className="review-layout">
        <aside className="panel patient-list-panel">
          <div className="panel-heading compact-heading"><div><h3>Pasien</h3><p>{patients.length} terdeteksi dari source</p></div><KoasisIcon name="patient" size={17} /></div>
          <div className="patient-list">{patients.map((item, index) => { const hasConflict = [...Object.values(item), ...Object.values(item.templateData ?? {})].some((value) => value && typeof value === "object" && "status" in value && (value as ClinicalField<unknown>).status === "conflicting"); const isFocus = item.id === focusPatientId; return <button className={`patient-list-item ${item.id === patient.id ? "selected" : ""}`} key={item.id} onClick={() => setActivePatientId(item.id)}><span className="patient-avatar">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.displayName}</strong><small>{isFocus ? "Kasus utama · " : "Ringkasan awal · "}{item.demographics.age?.value || "Usia belum ada"} · {item.demographics.sex?.value || "Jenis kelamin belum ada"}</small></span>{isFocus ? <span className="patient-focus-badge">Utama</span> : hasConflict && <AlertTriangle size={15} className="conflict-icon" />}</button>; })}</div>
          <button className="add-patient-button"><Plus size={14} /> Tambah pasien manual</button>
        </aside>
        <section className="panel review-main-panel">
          <div className="review-patient-header"><div className="review-patient-title"><div className="large-patient-avatar">{patient.displayName.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">Patient record · {patient.sourceId}</span><h3>{patient.displayName}</h3><span>{patient.demographics.age?.value || "Usia belum tercantum"} · {patient.demographics.sex?.value || "Jenis kelamin belum tercantum"}</span></div></div><div className="review-patient-actions"><button className="button button-ghost button-small"><Eye size={14} /> Lihat source</button><button className="button button-ghost button-small" onClick={() => onFocusPatient(patient.id)} disabled={focusPatientId === patient.id}>{focusPatientId === patient.id ? <Check size={14} /> : <KoasisIcon name="patient" size={14} />} {focusPatientId === patient.id ? "Kasus utama dipilih" : "Jadikan kasus utama"}</button></div></div>
          <div className="review-tabs">{tabs.map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item === "identity" ? "Identitas" : item === "history" ? "Anamnesis" : item === "exam" ? "Pemeriksaan" : item === "assessment" ? "Assessment & terapi" : profile.label}</button>)}</div>
          {lapjag && <div className="review-template-note"><KoasisIcon name="safety" size={14} /><span><strong>{profile.label}:</strong> tab <em>{profile.label}</em> menampilkan field yang akan dibaca langsung oleh slide PAT, WHO, diagnosis dan tata laksana.</span></div>}
          <div className="field-grid">{fieldList.map((field) => <FieldCard {...field} patient={patient} key={field.path} onChange={(path, value) => onUpdate(patient.id, path, value)} />)}</div>
          <div className="review-note"><KoasisIcon name="safety" size={15} /><div><strong>Traceability aktif</strong><span>Source snippet ditampilkan pada field yang berasal dari catatan. Nilai yang Anda edit menjadi user confirmed.</span></div></div>
        </section>
      </div>
      <div className="page-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke inbox</button><button className="button button-dark" onClick={onContinue}>Lanjut ke struktur template <ArrowRight size={16} /></button></div>
    </div>
  );
}

function isSummarySlideForTemplate(template: ParsedTemplate, slide: ParsedSlide): boolean {
  return slide.role === "shift_summary"
    || slide.patientScope === "all_patients"
    || template.bindings.some((binding) => binding.slideIndex === slide.index && binding.semanticField === "shift.patientSummaryTable");
}

function summaryTableCapacityForTemplate(template: ParsedTemplate, slide: ParsedSlide): number {
  const binding = template.bindings.find((item) => item.slideIndex === slide.index && item.semanticField === "shift.patientSummaryTable");
  const shape = binding ? slide.shapes.find((item) => item.id === binding.shapeId) : undefined;
  return Math.max(0, (shape?.tableRows?.length ?? 0) - 1);
}

function summaryPageCountForTemplate(template: ParsedTemplate, patients: PatientRecord[]): number {
  return template.slides
    .filter((slide) => slideIsIncluded(slide) && isSummarySlideForTemplate(template, slide))
    .reduce((total, slide) => {
      const capacity = summaryTableCapacityForTemplate(template, slide);
      return total + (capacity > 0 ? Math.max(1, Math.ceil(patients.length / capacity)) : 1);
    }, 0);
}

function GeneratePage({ shift, template, patients, focusPatientId, onGenerate, onBack, busy, stage, error }: { shift: ShiftDetails; template: ParsedTemplate | null; patients: PatientRecord[]; focusPatientId: string; onGenerate: () => void; onBack: () => void; busy: boolean; stage: GenerationStage; error: string }) {
  const selectedSlides = template?.slides.filter(slideIsIncluded) ?? [];
  const repeatCount = selectedSlides.filter((slide) => slide.repeat).length;
  const focusPatient = patients.find((patient) => patient.id === focusPatientId);
  const detailPatientCount = focusPatient ? 1 : patients.length;
  const summarySlides = selectedSlides.filter((slide) => template && isSummarySlideForTemplate(template, slide)).length;
  const summaryPages = template ? summaryPageCountForTemplate(template, patients) : 0;
  const expectedSlides = template ? selectedSlides.length + Math.max(0, summaryPages - summarySlides) + Math.max(0, detailPatientCount - 1) * repeatCount : 0;
  const validation = template ? validateTemplateContract(template) : undefined;
  const canGenerate = Boolean(template && patients.length && focusPatient && validation?.valid);
  return (
    <div className="page">
      <ProgressSteps active={4} />
      <SectionHeading eyebrow="Langkah 05 · Output" title="Generate laporan jaga" description="Semua input siap dirender ke salinan template. Setelah dibuat, Koasis akan merender ulang setiap slide untuk quality check visual sebelum download." action={<div className="privacy-chip"><KoasisIcon name="safety" size={14} /> Review sebelum export</div>} />
      <div className="generate-layout">
        <section className="panel generate-main-panel">
          <div className="generate-summary-head"><div><span className="eyebrow">Report plan</span><h3>{shift.title}</h3><p>{shift.department || "Departemen belum diatur"} · {toIndonesianDate(shift.date)} · {shift.hospital || "Rumah sakit belum diatur"}</p></div><div className="ready-badge"><CircleCheck size={14} /> Ready for render</div></div>
          <div className="plan-grid"><div className="plan-item"><span>Template</span><strong>{template?.name || "Belum ada template"}</strong><small>{selectedSlides.length} slide dipilih dari {template?.slideCount || 0}</small></div><div className="plan-item"><span>Patient records</span><strong>{patients.length} pasien ringkasan</strong><small>semua masuk tabel awal</small></div><div className="plan-item"><span>Kasus utama</span><strong>{focusPatient?.displayName || "Belum dipilih"}</strong><small>satu rangkaian slide mendalam</small></div><div className="plan-item"><span>Output estimate</span><strong>{expectedSlides || "—"} slide</strong><small>{repeatCount} slide untuk kasus utama</small></div></div>
          <div className="generation-checklist"><div className="checklist-heading"><h4>Quality gates</h4><span>4 checks</span></div><div className="checklist-row">{validation?.valid ? <Check size={15} /> : <AlertTriangle size={15} />}<span>Kontrak template dipelajari & tervalidasi</span><small>{validation?.valid ? "Lulus" : "Ditahan"}</small></div><div className="checklist-row"><Check size={15} /><span>Template mapping tersimpan</span><small>{template?.bindings.length || 0} binding</small></div><div className="checklist-row"><Check size={15} /><span>Setiap pasien punya record terstruktur</span><small>{patients.length} record</small></div><div className="checklist-row"><Check size={15} /><span>Field missing tidak diisi otomatis</span><small>Policy aktif</small></div></div>
          {busy && <ProcessingState variant="render" icon="report" eyebrow={stage === "rendering" ? "Visual quality check · proses aktif" : "PPTX compiler · proses aktif"} title={stage === "rendering" ? "Menyiapkan preview slide" : "Menyusun laporan editable"} description={stage === "rendering" ? "File PPTX sudah dibuat. Koasis sedang mengambil gambar setiap slide untuk quality check visual." : "Koasis sedang menyalin template, mengisi field klinis, dan menjaga layout asli tetap editable."} steps={["Menyusun data", "Menyalin template", "Menyiapkan render"]} activeStep={stage === "rendering" ? 2 : 0} />}
          {validation && !validation.valid && <div className="inline-error"><AlertTriangle size={15} /> {validation.errors.slice(0, 2).join(" ")}</div>}
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
          <div className="generate-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke struktur</button><button className="button button-dark button-large" onClick={onGenerate} disabled={busy || !canGenerate}>{busy ? <><RefreshCw size={16} className="spin" /> Membuat PPTX…</> : <><KoasisIcon name="spark" size={16} /> Generate editable PPTX</>}</button></div>
        </section>
        <aside className="panel safety-panel"><div className="safety-orb"><KoasisIcon name="security" size={22} /></div><span className="eyebrow">Clinical safety boundary</span><h3>Koasis membantu dokumentasi, bukan mengambil keputusan.</h3><p>Diagnosis, temuan, dan tata laksana hanya dibawa dari sumber atau edit user. Nilai yang hilang ditampilkan sebagai “Tidak tercantum”.</p><div className="safety-line"><KoasisIcon name="safety" size={15} /> Tidak ada rekomendasi obat otomatis</div><div className="safety-line"><KoasisIcon name="safety" size={15} /> Output tetap editable di PowerPoint</div></aside>
      </div>
    </div>
  );
}

function buildPreviewSlides(template: ParsedTemplate, patients: PatientRecord[], focusPatientId?: string) {
  const profile = getTemplateProfile(template);
  const detailPatients = focusPatientId && patients.some((patient) => patient.id === focusPatientId)
    ? patients.filter((patient) => patient.id === focusPatientId)
    : patients;
  const titleOf = (slide: ParsedSlide): string => {
    const guide = template.profileId === "generic"
      ? template.templateAnalysis?.slideGuides.find((item) => item.index === slide.index) || profile.slideGuides.find((item) => item.index === slide.index)
      : profile.slideGuides.find((item) => item.index === slide.index) || template.templateAnalysis?.slideGuides.find((item) => item.index === slide.index);
    let title = guide?.label || slide.title;
    if (slide.role === "shift_summary" || /pasien baru/i.test(title)) title = title.replace(/pasien baru\s*:?\s*.*?\s+pasien/i, `PASIEN BARU: ${patients.length} PASIEN`);
    if (slide.role === "management" && /gizi\s*buruk/i.test(title)) title = title.replace(/gizi\s*buruk/ig, "NUTRISI");
    return title;
  };
  const rows: Array<{ number: number; title: string; role: string; patient?: string; tag: string }> = [];
  const includedSlides = template.slides.filter(slideIsIncluded);
  const groups: ParsedSlide[][] = [];
  let group: ParsedSlide[] = [];
  includedSlides.forEach((slide) => {
    if (slide.repeat) group.push(slide);
    else if (group.length) { groups.push(group); group = []; }
  });
  if (group.length) groups.push(group);
  const groupStarts = new Map(groups.map((items) => [items[0].index, items]));
  const consumed = new Set<number>();
  const isSummarySlide = (slide: ParsedSlide) => isSummarySlideForTemplate(template, slide);
  const addStatic = (slide: ParsedSlide) => {
    if (!isSummarySlide(slide)) {
      rows.push({ number: rows.length + 1, title: titleOf(slide), role: slideRoleLabel(slide.role), tag: "Static" });
      return;
    }
    const capacity = summaryTableCapacityForTemplate(template, slide);
    const pageTotal = capacity > 0 ? Math.max(1, Math.ceil(patients.length / capacity)) : 1;
    for (let pageIndex = 1; pageIndex <= pageTotal; pageIndex += 1) {
      rows.push({
        number: rows.length + 1,
        title: pageIndex === 1 ? titleOf(slide) : `${titleOf(slide)} · Lanjutan ${pageIndex}/${pageTotal}`,
        role: slideRoleLabel(slide.role),
        tag: pageTotal > 1 ? `Semua pasien · ${pageIndex}/${pageTotal}` : "Semua pasien",
      });
    }
  };
  includedSlides.forEach((slide) => {
    if (consumed.has(slide.index)) return;
    const repeatGroup = groupStarts.get(slide.index);
    if (!repeatGroup) { addStatic(slide); return; }
    repeatGroup.forEach((item) => consumed.add(item.index));
    detailPatients.forEach((patient, patientIndex) => repeatGroup.forEach((item) => rows.push({ number: rows.length + 1, title: titleOf(item), role: slideRoleLabel(item.role), patient: patient.displayName, tag: `Kasus utama ${patientIndex + 1}` })));
  });
  return rows;
}

function ProtectedPreviewFrame({ source, alt, compact = false, paid = false }: { source: string; alt: string; compact?: boolean; paid?: boolean }) {
  return (
    <div className={`protected-preview-frame ${compact ? "compact" : ""} ${paid ? "paid" : ""}`} onContextMenu={(event) => event.preventDefault()} onDragStart={(event) => event.preventDefault()}>
      <img src={source} alt={alt} draggable={false} />
      {!paid && <><div className="preview-watermark-grid" aria-hidden="true">{Array.from({ length: compact ? 4 : 9 }, (_, index) => index % 3 === 1 ? <span className="preview-watermark-logo" key={index}><img src="/koasis-favicon.png" alt="" /></span> : <span className="preview-watermark-copy" key={index}>KOASIS PREVIEW</span>)}</div><span className="preview-protected-badge"><KoasisIcon name="security" size={compact ? 9 : 11} /> Preview</span></>}
    </div>
  );
}

function PresentationReviewSummary({ review, previewBusy, reviewPassed }: { review?: PresentationReview; previewBusy: boolean; reviewPassed: boolean }) {
  const state = previewBusy ? "pending" : review?.status || "pending";
  const title = state === "pass" ? "Pemeriksaan visual & konteks lulus" : state === "blocked" ? "Download ditahan: ada masalah wajib diperbaiki" : state === "needs_review" ? "Ada catatan yang perlu ditinjau" : "Menunggu pemeriksaan akhir";
  const detail = previewBusy
    ? "Agent sedang menilai layout, kepadatan teks, konteks pasien, dan kemungkinan sample template ikut terbawa."
    : review?.summary || "Pemeriksaan akan berjalan setelah render PowerPoint selesai.";
  const icon = state === "pass" ? <CircleCheck size={15} /> : state === "blocked" ? <AlertTriangle size={15} /> : state === "needs_review" ? <AlertTriangle size={15} /> : <CircleDashed size={15} />;
  return <div className={`presentation-review-summary ${state} ${reviewPassed ? "ready" : ""}`} role="status" aria-live="polite">
    <div className="presentation-review-summary-head"><span className="presentation-review-summary-icon">{icon}</span><div><strong>{title}</strong><span>{review?.engine === "agent" ? "Agent + pemeriksaan lokal" : review?.engine === "local" ? "Pemeriksaan lokal" : "Quality gate aktif"}</span></div></div>
    <p>{detail}</p>
    {review?.issues?.length ? <ul className="presentation-review-issues">{review.issues.slice(0, 4).map((issue, index) => <li key={`${issue.title}-${issue.slideIndex ?? "all"}-${index}`}><span>{issue.severity === "error" ? "Wajib" : "Cek"}{issue.slideIndex === undefined ? "" : ` · slide ${issue.slideIndex + 1}`}</span>{issue.title}: {issue.detail}</li>)}</ul> : null}
  </div>;
}

function PreviewPage({ template, patients, focusPatientId, generated, previewBusy, onDownload, onBack, onNew, visualReviewConfirmed, onVisualReviewChange, paymentStatus }: { template: ParsedTemplate | null; patients: PatientRecord[]; focusPatientId: string; generated: GeneratedArtifact | null; previewBusy: boolean; onDownload: () => void; onBack: () => void; onNew: () => void; visualReviewConfirmed: boolean; onVisualReviewChange: (value: boolean) => void; paymentStatus: PaymentStatus }) {
  const previewRows = template ? buildPreviewSlides(template, patients, focusPatientId) : [];
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [paymentNotice, setPaymentNotice] = useState("");
  const previewSlides = generated?.previewSlides || [];
  useEffect(() => {
    if (selectedSlide >= previewSlides.length) setSelectedSlide(Math.max(0, previewSlides.length - 1));
  }, [previewSlides.length, selectedSlide]);
  const selectedMeta = previewRows[selectedSlide];
  const hasVisualRender = previewSlides.length > 0;
  const review = generated?.review;
  const reviewPassed = review?.status === "pass";
  const isPaid = paymentStatus === "paid";
  const isDownloadAvailable = (isPaid || DEMO_DOWNLOAD_MODE) && reviewPassed;
  const downloadLabel = !reviewPassed ? "Menunggu quality gate" : isPaid ? "Download PPTX" : "Free download";
  return (
    <div className="page">
      <SectionHeading eyebrow="Langkah 05 · Visual quality check" title="Preview laporan jaga" description="Koasis merender PPTX final di server agar setiap slide bisa diperiksa sebelum file diunduh." action={<div className={`ready-badge ${previewBusy ? "loading" : hasVisualRender ? "" : "warning"}`}>{previewBusy ? <RefreshCw size={14} className="spin" /> : <CircleCheck size={14} />} {previewBusy ? "Merender slide…" : hasVisualRender ? "Render siap direview" : "Render belum tersedia"}</div>} />
      <div className="preview-toolbar"><div className="preview-file"><div className="file-icon large"><KoasisIcon name="archive" size={20} /></div><div><strong>{generated?.fileName || "laporan-jaga.pptx"}</strong><span>{generated?.slideCount || previewRows.length} slide · editable PPTX · {generated?.previewEngine || "visual render"}</span></div></div><div className="toolbar-actions"><button className="button button-ghost" onClick={onBack}><Pencil size={14} /> Edit review</button><button className={`button ${isDownloadAvailable ? "button-dark" : "button-locked"}`} onClick={onDownload} disabled={!isDownloadAvailable || !visualReviewConfirmed || !hasVisualRender} title={isDownloadAvailable ? downloadLabel : "Selesaikan pemeriksaan quality gate sebelum download"}>{isDownloadAvailable ? <Download size={15} /> : <KoasisIcon name="security" size={15} />} {downloadLabel}</button></div></div>
      {generated?.previewError && <div className="inline-error preview-error"><AlertTriangle size={15} /> {generated.previewError}</div>}
      <div className="preview-layout"><section className="panel preview-stage"><div className="preview-stage-head"><div><span className="eyebrow">Actual PowerPoint render · protected preview</span><h3>{selectedMeta?.title || "Tampilan per slide"}</h3></div><span>{previewBusy ? "Memproses…" : hasVisualRender ? `${selectedSlide + 1} / ${previewSlides.length}` : "Menunggu render"}</span></div>{previewBusy ? <ProcessingState variant="render" icon="radiology" eyebrow="Visual quality check · proses aktif" title="Merender preview slide" description="Koasis sedang mengubah setiap slide PowerPoint menjadi gambar yang bisa kamu periksa sebelum download." steps={["Membuat slide", "Mengambil gambar", "Menyiapkan review"]} activeStep={1} /> : hasVisualRender ? <><div className="preview-focus"><button className="preview-nav-button" onClick={() => setSelectedSlide((current) => Math.max(0, current - 1))} disabled={selectedSlide === 0} aria-label="Slide sebelumnya"><ArrowLeft size={17} /></button><ProtectedPreviewFrame paid={isPaid} source={previewSlides[selectedSlide]} alt={`Render slide ${selectedSlide + 1}`} /><button className="preview-nav-button" onClick={() => setSelectedSlide((current) => Math.min(previewSlides.length - 1, current + 1))} disabled={selectedSlide === previewSlides.length - 1} aria-label="Slide berikutnya"><ArrowRight size={17} /></button></div><div className="preview-slide-grid rendered-slide-grid">{previewSlides.map((source, index) => { const row = previewRows[index]; return <button className={`preview-slide-card rendered-slide-card ${index === selectedSlide ? "selected" : ""}`} key={`${index}-${row?.title || "slide"}`} onClick={() => setSelectedSlide(index)}><ProtectedPreviewFrame paid={isPaid} compact source={source} alt={`Thumbnail slide ${index + 1}`} /><span className="preview-slide-number">{String(index + 1).padStart(2, "0")}</span><div className="preview-slide-meta"><strong>{row?.title || `Slide ${index + 1}`}</strong><span>{row?.role || "Render PPTX"}</span></div></button>; })}</div></> : <div className="preview-render-empty"><CircleDashed size={24} /><strong>Render visual belum berhasil</strong><span>Perbaiki masalah render lalu generate ulang. Download ditahan sampai slide dapat diperiksa.</span></div>}</section><aside className="panel preview-side"><div className="panel-heading"><div><span className="eyebrow">Quality gate</span><h3>Review sebelum final</h3></div><KoasisIcon name="review" size={19} /></div><div className="export-check"><Check size={14} /><span>Struktur PPTX tervalidasi</span></div><div className={`export-check ${hasVisualRender ? "" : "pending"}`}>{hasVisualRender ? <Check size={14} /> : <CircleDashed size={14} />}<span>Visual render {hasVisualRender ? "tersedia" : previewBusy ? "sedang diproses" : "menunggu"}</span></div><div className={`export-check ${generated && generated.slideCount === previewSlides.length ? "" : "pending"}`}>{generated && generated.slideCount === previewSlides.length ? <Check size={14} /> : <CircleDashed size={14} />}<span>Jumlah slide konsisten</span></div><PresentationReviewSummary review={review} previewBusy={previewBusy} reviewPassed={reviewPassed} /><label className="visual-review-control"><input type="checkbox" checked={visualReviewConfirmed} onChange={(event) => onVisualReviewChange(event.target.checked)} disabled={!hasVisualRender || !reviewPassed} /><span>Saya sudah memeriksa tampilan setiap slide dan menyetujui hasilnya.</span></label><div className="preview-disclaimer"><AlertTriangle size={14} /><span>Periksa teks terpotong, tabel kosong, data yang tertukar, dan elemen yang bertabrakan. Edit review jika ada temuan.</span></div><div className={`paywall-card ${isPaid ? "paid" : ""} ${DEMO_DOWNLOAD_MODE && !isPaid ? "demo" : ""}`}><div className="paywall-card-head"><div className="paywall-icon"><KoasisIcon name={isPaid ? "safety" : DEMO_DOWNLOAD_MODE ? "generate" : "security"} size={19} /></div><div><span className="eyebrow">{isPaid ? "Output berbayar" : "Demo Koasis"}</span><h3>{isPaid ? "Download terbuka" : DEMO_DOWNLOAD_MODE ? "Free download" : "Bayar untuk download"}</h3></div><span className="paywall-status">{isPaid ? "Paid" : DEMO_DOWNLOAD_MODE ? "Demo" : "Locked"}</span></div><p>{isPaid ? "Pembayaran terverifikasi. File editable siap diunduh." : DEMO_DOWNLOAD_MODE ? "Selama masa demo, file editable dapat diunduh gratis setelah preview selesai direview." : "Preview tetap bisa direview dengan watermark. Download PPTX dibuka setelah pembayaran terverifikasi."}</p>{!isPaid && <button type="button" className="button button-dark full-width paywall-cta" onClick={() => DEMO_DOWNLOAD_MODE ? onDownload() : setPaymentNotice("Payment gateway belum dihubungkan. Tombol ini sudah disiapkan untuk checkout pada tahap berikutnya.")} disabled={!isDownloadAvailable || !visualReviewConfirmed || !hasVisualRender}>{DEMO_DOWNLOAD_MODE ? <Download size={15} /> : <KoasisIcon name="security" size={15} />} {DEMO_DOWNLOAD_MODE ? "Free download" : "Bayar & unlock download"}</button>}{paymentNotice && !isPaid && !DEMO_DOWNLOAD_MODE && <div className="paywall-notice" role="status"><AlertTriangle size={13} />{paymentNotice}</div>}</div><button className="button button-ghost full-width" onClick={onNew}><Plus size={15} /> Mulai laporan lain</button></aside></div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, signOut } = useAuth();
  const [view, setView] = useState<View>("dashboard");
  const [shift, setShift] = useState<ShiftDetails>(EMPTY_SHIFT);
  const [template, setTemplate] = useState<ParsedTemplate | null>(null);
  const [patientDrafts, setPatientDrafts] = useState<PatientDraft[]>(createInitialPatientDrafts);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [builtInTemplates, setBuiltInTemplates] = useState<BuiltInTemplateEntry[]>([]);
  const [builtInLoading, setBuiltInLoading] = useState(true);
  const [activePatientId, setActivePatientId] = useState("");
  const [focusDraftId, setFocusDraftId] = useState("draft-1");
  const [focusPatientId, setFocusPatientId] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisEngine, setAnalysisEngine] = useState<"none" | "ai" | "local" | "mixed">("none");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationStage, setGenerationStage] = useState<GenerationStage>("idle");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedArtifact | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [visualReviewConfirmed, setVisualReviewConfirmed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel | null>(null);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [workspaceSyncState, setWorkspaceSyncState] = useState<"loading" | "saved" | "error">("loading");
  const [workspaceSyncError, setWorkspaceSyncError] = useState("");
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);
  // The demo intentionally exposes download. Once the gateway is connected,
  // turn DEMO_DOWNLOAD_MODE off so only a server-verified paid state creates
  // a download URL. Real enforcement must move the final artifact behind the backend.
  const generatedUrl = useMemo(() => generated && (paymentStatus === "paid" || DEMO_DOWNLOAD_MODE) ? URL.createObjectURL(generated.blob) : "", [generated, paymentStatus]);

  const storedTemplateMetadata = useMemo<WorkspaceMetadata["template"]>(() => ({
    id: template?.id || "",
    name: template?.name || "",
    fileName: template?.fileName || "",
    profileId: template?.profileId || "generic",
    slideCount: template?.slideCount || 0,
    analysisStatus: template?.analysisStatus || "uploaded",
  }), [template?.analysisStatus, template?.fileName, template?.id, template?.name, template?.profileId, template?.slideCount]);

  useEffect(() => () => { if (generatedUrl) URL.revokeObjectURL(generatedUrl); }, [generatedUrl]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setUtilityPanel(null);
      }
    };
    document.body.classList.toggle("mobile-nav-open", mobileNavOpen);
    if (mobileNavOpen || utilityPanel) window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("mobile-nav-open");
    };
  }, [mobileNavOpen, utilityPanel]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    loadBuiltInTemplateCatalog()
      .then((catalog) => { if (!cancelled) setBuiltInTemplates(catalog); })
      .catch(() => { if (!cancelled) setBuiltInTemplates([]); })
      .finally(() => { if (!cancelled) setBuiltInLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setWorkspaceHydrated(false);
    setWorkspaceSyncState("loading");
    setWorkspaceSyncError("");
    loadWorkspaceMetadata(user.uid)
      .then((metadata) => {
        if (cancelled) return;
        if (metadata?.shift) setShift({ ...EMPTY_SHIFT, ...metadata.shift });
        setWorkspaceSyncState("saved");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setWorkspaceSyncState("error");
        setWorkspaceSyncError(loadError instanceof Error ? loadError.message : "Metadata workspace belum bisa dibaca.");
      })
      .finally(() => {
        if (!cancelled) setWorkspaceHydrated(true);
      });
    return () => { cancelled = true; };
  }, [user.uid, workspaceReloadKey]);

  useEffect(() => {
    if (!workspaceHydrated) return undefined;
    const metadata: WorkspaceMetadata = {
      schemaVersion: 1,
      // Deliberately whitelist shift metadata. Patient notes, extracted fields,
      // sources, attachment data URLs, and generated files never enter Firestore.
      shift: {
        title: shift.title,
        date: shift.date,
        department: shift.department,
        hospital: shift.hospital,
        team: shift.team,
        facilitator: shift.facilitator,
        dpjp: shift.dpjp,
      },
      template: storedTemplateMetadata,
    };
    const timeout = window.setTimeout(() => {
      saveWorkspaceMetadata(user.uid, metadata)
        .then(() => {
          setWorkspaceSyncState("saved");
          setWorkspaceSyncError("");
        })
        .catch((saveError) => {
          setWorkspaceSyncState("error");
          setWorkspaceSyncError(saveError instanceof Error ? saveError.message : "Metadata workspace belum bisa disimpan.");
        });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [shift.date, shift.department, shift.dpjp, shift.facilitator, shift.hospital, shift.team, shift.title, storedTemplateMetadata, user.uid, workspaceHydrated]);

  const handleTemplate = async (file: File) => {
    setError("");
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setError("File template harus berformat .pptx.");
      return;
    }
    setTemplateBusy(true);
    try {
      // A user upload is always a new contract. Do not let a filename such as
      // "RSUI-final.pptx" accidentally inherit a built-in profile before the
      // template agent has inspected its actual slides.
      const parsed = await parsePptx(file, file.name, "generic");
      const customTemplate: ParsedTemplate = { ...parsed, profileId: "generic", analysisStatus: "analyzing" };
      const analyzed = await analyzeTemplateWithAi(customTemplate);
      setTemplate(analyzed.template);
      if (analyzed.error || !analyzed.template.templateValidation?.valid) {
        setError(analyzed.error
          ? "Agent template belum bisa dihubungi. Generate ditahan sampai kontrak template dipelajari agent."
          : "Agent template menemukan bagian yang belum aman untuk dirender. Periksa warning kontrak sebelum melanjutkan.");
      }
      setView("new-shift");
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Template tidak bisa dianalisis.");
    } finally {
      setTemplateBusy(false);
    }
  };

  const handleBuiltInTemplate = async (entry: BuiltInTemplateEntry) => {
    setError("");
    setTemplateBusy(true);
    try {
      const raw = await loadBuiltInTemplate(entry);
      const parsed = await parsePptx(raw, entry.fileName);
      const prepared = { ...parsed, name: entry.label };
      const analyzed = prepared.profileId === "generic"
        ? await analyzeTemplateWithAi({ ...prepared, analysisStatus: "analyzing" })
        : { template: applyTemplateAnalysis(prepared, buildLocalTemplateAnalysis(prepared), "local"), analysis: undefined, error: undefined };
      setTemplate(analyzed.template);
      if (analyzed.error || !analyzed.template.templateValidation?.valid) {
        setError(analyzed.error
          ? "Template bawaan baru belum bisa dipelajari agent. Generate ditahan sampai analisis template berhasil."
          : `Kontrak template bawaan perlu diperiksa: ${analyzed.template.templateValidation?.errors.slice(0, 2).join(" ") || "struktur belum aman untuk dirender."}`);
      }
      setView("new-shift");
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Template bawaan tidak bisa dianalisis.");
    } finally {
      setTemplateBusy(false);
    }
  };

  const updateDraftText = (draftId: string, text: string) => {
    setPatientDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, text } : draft));
  };

  const handleDraftFile = async (draftId: string, file: File) => {
    const draft = patientDrafts.find((item) => item.id === draftId);
    if (!draft) return;
    const patientLabel = draft.label;
    if (file.size > 8 * 1024 * 1024) {
      setError(`${file.name} terlalu besar. Batas attachment adalah 8 MB.`);
      return;
    }
    if (file.type === "text/plain" || /\.txt$/i.test(file.name)) {
      const text = await file.text();
      updateDraftText(draftId, text);
      setSources((current) => [...current.filter((source) => source.patientId !== draftId || (source.type !== "txt" && source.type !== "docx")), { id: `file-${draftId}-${Date.now()}`, name: file.name, type: "txt", sizeLabel: fileSizeLabel(file.size), status: "ready", text, patientId: draftId, patientLabel }]);
      return;
    }
    if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name)) {
      try {
        const text = await extractDocxText(file);
        updateDraftText(draftId, text);
        setSources((current) => [...current.filter((source) => source.patientId !== draftId || (source.type !== "txt" && source.type !== "docx")), { id: `file-${draftId}-${Date.now()}`, name: file.name, type: "docx", sizeLabel: fileSizeLabel(file.size), status: "ready", text, patientId: draftId, patientLabel }]);
      } catch (fileError) {
        setError(fileError instanceof Error ? fileError.message : `${file.name} tidak bisa dibaca sebagai DOCX.`);
      }
      return;
    }
    const kind = attachmentKind(file);
    if (!kind) {
      setError(`Format ${file.name} belum didukung. Gunakan TXT, DOCX, gambar, PDF, atau audio.`);
      return;
    }
    try {
      const attachment: PatientAttachment = { id: `attachment-${draftId}-${Date.now()}`, name: file.name, mimeType: file.type || (kind === "pdf" ? "application/pdf" : `${kind}/*`), kind, sizeBytes: file.size, dataUrl: await readFileAsDataUrl(file) };
      setPatientDrafts((current) => current.map((item) => item.id === draftId ? { ...item, attachments: [...(item.attachments ?? []), attachment] } : item));
      setSources((current) => [...current, { id: attachment.id, name: file.name, type: kind, sizeLabel: fileSizeLabel(file.size), status: "ready", patientId: draftId, patientLabel }]);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : `${file.name} tidak bisa dibaca.`);
    }
  };

  const removeAttachment = (draftId: string, attachmentId: string) => {
    setPatientDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) } : draft));
    setSources((current) => current.filter((source) => source.id !== attachmentId));
  };

  const addPatientDraft = () => {
    setPatientDrafts((current) => {
      const patientNumber = current.filter((draft) => !draft.bulkSource).length + 1;
      return [...current, { id: `draft-${Date.now()}`, label: `Pasien ${patientNumber}`, text: "", attachments: [] }];
    });
  };

  const detectBulkPatients = async (text: string, label: string, attachments: PatientAttachment[] = []) => {
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) throw new Error("Tempel atau pilih file daftar pasien terlebih dahulu.");
    setError("");
    const profile = getTemplateProfile(template);
    const sourceId = `source-bulk-${Date.now()}`;
    setAnalysisBusy(true);
    try {
      let extractedPatients: PatientRecord[];
      let usedLocalFallback = false;
      try {
        const aiPatients = await extractPatientsWithAi(trimmed, sourceId, "Daftar pasien gabungan", shift, profile.id, profile.extractionInstructions, {
          label: profile.label,
          patientInputHint: profile.patientInputHint,
          extractionInstructions: profile.extractionInstructions,
          shiftFields: profile.shiftFields,
          fieldGroups: profile.fieldGroups,
          slides: profile.slideGuides,
          bindings: template?.bindings || [],
          warnings: template?.templateAnalysis?.warnings || [],
          confidence: template?.templateAnalysis?.confidence,
          validation: template?.templateValidation,
        }, attachments);
        extractedPatients = aiPatients.map((patient) => ({ ...patient, sourceId, attachments: [] }));
      } catch (aiError) {
        const localPatients = extractPatients(trimmed, sourceId).patients;
        if (!localPatients.length) throw new Error(aiError instanceof Error ? aiError.message : "AI agent tidak menemukan pasien dari daftar ini.");
        extractedPatients = localPatients.map((patient) => ({ ...patient, sourceId, attachments: [] }));
        usedLocalFallback = true;
      }
      if (!extractedPatients.length) throw new Error("Daftar pasien tidak menghasilkan record yang bisa dibuat menjadi kartu.");

      const rawSections = splitPatientSections(trimmed);
      const detectedDrafts: PatientDraft[] = extractedPatients.map((patient, index) => ({
        id: `draft-bulk-${Date.now()}-${index}`,
        label: `Pasien ${index + 1}`,
        text: rawSections.length === extractedPatients.length ? rawSections[index] : patientRecordToDraftText(patient),
        attachments: [],
      }));
      setPatientDrafts((current) => {
        const retainedDrafts = current.filter((draft) => !draft.bulkSource && (draft.text.trim() || (draft.attachments ?? []).length));
        return [...retainedDrafts, ...detectedDrafts].map((draft, index) => ({ ...draft, label: `Pasien ${index + 1}` }));
      });
      setPatients((current) => [...current.filter((patient) => !patient.sourceId.startsWith("source-bulk-")), ...extractedPatients]);
      setFocusDraftId(detectedDrafts[0]?.id || "");
      setFocusPatientId(extractedPatients[0]?.id || "");
      setActivePatientId(extractedPatients[0]?.id || "");
      setAnalysisEngine(usedLocalFallback ? "local" : "ai");
      setSources((current) => [...current.filter((source) => !source.id.startsWith("bulk-source-") && !source.id.startsWith("source-bulk-")), {
        id: `bulk-source-${sourceId}`,
        name: label,
        type: attachments[0]?.kind || "raw_text",
        sizeLabel: attachments.length ? `${fileSizeLabel(attachments[0].sizeBytes)} · ${extractedPatients.length} pasien terdeteksi` : `${trimmed.length} karakter · ${extractedPatients.length} pasien terdeteksi`,
        status: "ready",
        text: trimmed || undefined,
        patientLabel: "Bulk input",
      }]);
      if (usedLocalFallback) setError("AI agent belum merespons; daftar berhasil dipisahkan dengan fallback lokal. Periksa kembali setiap kartu sebelum lanjut review.");
    } catch (detectError) {
      throw detectError instanceof Error ? detectError : new Error("Daftar pasien belum bisa dipisahkan.");
    } finally {
      setAnalysisBusy(false);
    }
  };

  const removePatientDraft = (draftId: string) => {
    setPatientDrafts((current) => {
      let patientNumber = 0;
      const remaining = current.filter((draft) => draft.id !== draftId).map((draft) => draft.bulkSource ? draft : { ...draft, label: `Pasien ${++patientNumber}` });
      if (focusDraftId === draftId) setFocusDraftId(remaining[0]?.id || "");
      return remaining;
    });
    setSources((current) => current.filter((source) => source.patientId !== draftId));
    setPatients((current) => current.filter((patient) => patient.sourceId !== `source-${draftId}`));
    setFocusPatientId((current) => current && patients.some((patient) => patient.id === current && patient.sourceId === `source-${draftId}`) ? "" : current);
  };

  const focusDraft = (draftId: string) => {
    setFocusDraftId(draftId);
    const matchingPatient = patients.find((patient) => patient.sourceId === `source-${draftId}`);
    if (matchingPatient) setFocusPatientId(matchingPatient.id);
  };

  const analyze = async () => {
    setError("");
    const profile = getTemplateProfile(template);
    const populatedDrafts = patientDrafts.filter((draft) => draft.text.trim() || (draft.attachments ?? []).length);
    if (!populatedDrafts.length) {
      setError("Isi minimal satu kartu pasien, catatan bebas, atau upload evidence multimodal terlebih dahulu.");
      return;
    }
    const requestedFocusDraftId = populatedDrafts.some((draft) => draft.id === focusDraftId)
      ? focusDraftId
      : populatedDrafts[0].id;
    setFocusDraftId(requestedFocusDraftId);
    setAnalysisBusy(true);
    try {
      const extractedPatients: PatientRecord[] = [];
      const fallbackMessages: string[] = [];
      for (const draft of populatedDrafts) {
        const sourceId = `source-${draft.id}`;
        const sourceText = draft.text;
        try {
          const aiPatients = await extractPatientsWithAi(sourceText, sourceId, draft.label, shift, profile.id, profile.extractionInstructions, {
            label: profile.label,
            patientInputHint: profile.patientInputHint,
            extractionInstructions: profile.extractionInstructions,
            shiftFields: profile.shiftFields,
            fieldGroups: profile.fieldGroups,
            slides: profile.slideGuides,
            bindings: template?.bindings || [],
            warnings: template?.templateAnalysis?.warnings || [],
            confidence: template?.templateAnalysis?.confidence,
            validation: template?.templateValidation,
          }, draft.attachments ?? []);
          extractedPatients.push(...aiPatients.map((patient) => ({ ...patient, attachments: draft.bulkSource ? [] : draft.attachments ?? [] })));
        } catch (aiError) {
          const localPatients = extractPatients(sourceText, sourceId).patients;
          extractedPatients.push(...localPatients.map((patient) => ({ ...patient, attachments: draft.bulkSource ? [] : draft.attachments ?? [] })));
          fallbackMessages.push(`${draft.label}: ${aiError instanceof Error ? aiError.message : "AI backend tidak merespons"}`);
        }
      }
      if (!extractedPatients.length) throw new Error("Data pasien tidak menghasilkan record yang bisa direview.");
      const requestedFocusSourceId = `source-${requestedFocusDraftId}`;
      const focusPatient = extractedPatients.find((patient) => patient.sourceId === requestedFocusSourceId) ?? extractedPatients[0];
      setPatients(extractedPatients);
      setFocusPatientId(focusPatient?.id ?? "");
      setActivePatientId(focusPatient?.id ?? extractedPatients[0]?.id ?? "");
      setAnalysisEngine(fallbackMessages.length === populatedDrafts.length ? "local" : fallbackMessages.length ? "mixed" : "ai");
      setSources((current) => [
        ...current.filter((source) => source.type !== "raw_text"),
        ...populatedDrafts.map((draft) => { const text = draft.text; return { id: `source-${draft.id}`, name: `Catatan ${draft.label}`, type: "raw_text" as const, sizeLabel: text ? `${text.length} karakter` : `${(draft.attachments ?? []).length} attachment`, status: "ready" as const, text, patientId: draft.id, patientLabel: draft.label }; }),
      ]);
      if (fallbackMessages.length) {
        setError(`Sebagian atau seluruh ekstraksi memakai fallback lokal karena AI backend gagal. ${fallbackMessages.join(" ")}`);
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Data klinis tidak bisa diproses.");
    } finally {
      setAnalysisBusy(false);
    }
  };

  const updatePatient = (patientId: string, path: string, value: string) => {
    setPatients((current) => current.map((patient) => patient.id === patientId ? setFieldValue(patient, path, value) : patient));
  };

  const generate = async () => {
    if (!template) return;
    setError("");
    setGenerationBusy(true);
    setGenerationStage("building");
    try {
      const selectedFocusPatient = patients.find((patient) => patient.id === focusPatientId);
      if (!selectedFocusPatient) {
        throw new Error("Pilih satu pasien utama untuk dibahas mendalam sebelum membuat laporan.");
      }
      const result = await generatePresentation(template, patients, template.bindings, shift, { focusPatientId: selectedFocusPatient.id });
      setGenerated({ ...result, previewSlides: [], previewEngine: "server renderer", previewError: "", review: undefined });
      setPaymentStatus("unpaid");
      setVisualReviewConfirmed(false);
      setPreviewBusy(true);
      setGenerationStage("rendering");
      setView("preview");
      try {
        const rendered = await renderPresentationForPreview(result.blob);
        setGenerated((current) => current ? { ...current, previewSlides: rendered.slides, previewEngine: rendered.engine } : current);
        const localInspection = await inspectGeneratedPresentation(result.blob, template, patients, selectedFocusPatient.id);
        let finalReview = localInspection.review;
        try {
          const agentReview = await reviewPresentationWithAgent(localInspection.snapshot, patients, rendered.slides, selectedFocusPatient.id);
          const mergedIssues = [...localInspection.review.issues, ...agentReview.issues]
            .filter((issue, index, all) => all.findIndex((candidate) => candidate.slideIndex === issue.slideIndex && candidate.title === issue.title && candidate.detail === issue.detail) === index)
            .slice(0, 24);
          finalReview = {
            ...agentReview,
            status: localInspection.review.status === "blocked" || agentReview.status === "blocked"
              ? "blocked"
              : localInspection.review.status === "needs_review"
                ? "needs_review"
                : agentReview.status,
            issues: mergedIssues,
            summary: agentReview.summary,
            checkedSlides: rendered.slides.length,
          };
        } catch (agentError) {
          finalReview = {
            ...localInspection.review,
            status: localInspection.review.status === "blocked" ? "blocked" : "needs_review",
            summary: `${localInspection.review.summary} Agent visual/kontekstual belum tersedia; download ditahan sampai pemeriksaan agent berhasil.${agentError instanceof Error ? ` ${agentError.message}` : ""}`,
          };
        }
        setGenerated((current) => current ? { ...current, review: finalReview } : current);
      } catch (renderError) {
        const previewError = renderError instanceof Error ? renderError.message : "Preview visual gagal.";
        setGenerated((current) => current ? { ...current, previewError } : current);
      } finally {
        setPreviewBusy(false);
      }
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "PPTX belum bisa dibuat.");
    } finally {
      setGenerationBusy(false);
      setGenerationStage("idle");
    }
  };

  const download = () => {
    if ((!DEMO_DOWNLOAD_MODE && paymentStatus !== "paid") || !generated || generated.review?.status !== "pass" || !generatedUrl || !visualReviewConfirmed || !generated.previewSlides.length) return;
    const link = document.createElement("a");
    link.href = generatedUrl;
    link.download = generated.fileName;
    link.click();
  };

  const startNew = () => {
    setShift({ ...EMPTY_SHIFT, date: new Date().toISOString().slice(0, 10) });
    setTemplate(null);
    setPatientDrafts(createInitialPatientDrafts());
    setSources([]);
    setPatients([]);
    setFocusDraftId("draft-1");
    setFocusPatientId("");
    setActivePatientId("");
    setAnalysisEngine("none");
    setGenerated(null);
    setPaymentStatus("unpaid");
    setGenerationStage("idle");
    setPreviewBusy(false);
    setVisualReviewConfirmed(false);
    setError("");
    setView("new-shift");
  };

  const navTo = (next: View) => { setError(""); setView(next); setMobileNavOpen(false); setUtilityPanel(null); };

  const pageTitle = view === "dashboard" ? "Overview" : view === "new-shift" ? "Laporan baru" : view === "template" ? "Struktur template" : view === "inbox" ? "Data pasien" : view === "review" ? "Review klinis" : view === "generate" ? "Generate laporan" : "Preview";
  const accountLabel = user.displayName?.trim() || user.email?.split("@")[0] || "Pengguna";
  const workspaceStatus = workspaceSyncState === "loading" ? "Menyinkronkan metadata…" : workspaceSyncState === "error" ? "Sinkronisasi perlu dicek" : "Metadata tersimpan";
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="brand"><img className="brand-lockup" src="/koasis-wordmark.png" alt="Koasis — Your Clinical Oasis" /></div>
        <nav className="main-nav"><span className="nav-label">Ruang kerja</span>{NAV_ITEMS.map(({ id, label, icon, hint }) => <button className={`nav-item ${view === id ? "active" : ""}`} onClick={() => navTo(id)} key={id}><KoasisIcon name={icon} size={17} /><span>{label}</span>{hint && <small>{hint}</small>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-utilities"><button className="nav-item" onClick={() => setUtilityPanel("settings")}><KoasisIcon name="settings" size={17} /><span>Pengaturan</span></button><button className="nav-item" onClick={() => setUtilityPanel("help")}><KoasisIcon name="help" size={17} /><span>Bantuan</span></button></div><div className="sidebar-user"><div className="user-avatar">{userInitial(user)}</div><div><strong>{accountLabel}</strong><span>{user.email || "Akun Firebase"}</span></div><button className="icon-button" aria-label="Keluar dari akun" title="Keluar" onClick={() => { void signOut(); }}><LogOut size={15} /></button></div></div>
      </aside>
      {mobileNavOpen && <button className="sidebar-scrim" aria-label="Tutup menu navigasi" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-content">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label={mobileNavOpen ? "Tutup menu" : "Buka menu"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X size={19} /> : <Menu size={19} />}</button><div className="topbar-brand-mobile"><img src="/koasis-wordmark.png" alt="Koasis — Your Clinical Oasis" /></div><div className="breadcrumbs"><span>Koasis</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div></div></header>
        {view === "dashboard" && <Dashboard shift={shift} template={template} patients={patients} onCreate={() => navTo("new-shift")} onNavigate={navTo} />}
        {view === "new-shift" && <NewShiftPage shift={shift} setShift={setShift} template={template} builtInTemplates={builtInTemplates} builtInLoading={builtInLoading} onBuiltInTemplate={handleBuiltInTemplate} onTemplate={handleTemplate} onChangeTemplate={() => { setTemplate(null); navTo("new-shift"); }} onContinue={() => navTo("inbox")} busy={templateBusy} error={error} />}
        {view === "template" && <TemplatePage template={template} setTemplate={setTemplate} onContinue={() => navTo("generate")} onBack={() => navTo("review")} />}
        {view === "inbox" && <InboxPage template={template} drafts={patientDrafts} focusDraftId={focusDraftId} onFocusDraft={focusDraft} onDraftTextChange={updateDraftText} onDraftFile={handleDraftFile} onRemoveAttachment={removeAttachment} onAddDraft={addPatientDraft} onDetectBulk={detectBulkPatients} onRemoveDraft={removePatientDraft} sources={sources} patients={patients} onAnalyze={analyze} onContinue={() => navTo("review")} analysisBusy={analysisBusy} analysisEngine={analysisEngine} error={error} />}
        {view === "review" && <ReviewPage template={template} patients={patients} activePatientId={activePatientId} setActivePatientId={setActivePatientId} focusPatientId={focusPatientId} onFocusPatient={setFocusPatientId} onUpdate={updatePatient} onContinue={() => navTo("template")} onBack={() => navTo("inbox")} />}
        {view === "generate" && <GeneratePage shift={shift} template={template} patients={patients} focusPatientId={focusPatientId} onGenerate={generate} onBack={() => navTo("template")} busy={generationBusy} stage={generationStage} error={error} />}
        {view === "preview" && <PreviewPage template={template} patients={patients} focusPatientId={focusPatientId} generated={generated} previewBusy={previewBusy} onDownload={download} onBack={() => navTo("review")} onNew={startNew} visualReviewConfirmed={visualReviewConfirmed} onVisualReviewChange={setVisualReviewConfirmed} paymentStatus={paymentStatus} />}
      </main>
      {utilityPanel && <UtilityModal panel={utilityPanel} user={user} workspaceStatus={workspaceStatus} workspaceSyncError={workspaceSyncError} onClose={() => setUtilityPanel(null)} onRetrySync={() => { setWorkspaceReloadKey((current) => current + 1); }} onStartReport={() => navTo("new-shift")} onSignOut={() => { void signOut(); }} />}
    </div>
  );
}

export default function App() {
  return <AuthGate><AuthenticatedApp /></AuthGate>;
}
