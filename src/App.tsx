import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  CloudUpload,
  Download,
  Eye,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  Files,
  Home,
  Layers3,
  LifeBuoy,
  LockKeyhole,
  Map,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Upload,
  UserRound,
  UsersRound,
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
import { extractPatientsWithAi } from "./lib/aiClinicalClient";
import { extractPatients, formatFieldValue } from "./lib/clinicalParser";
import { generatePresentation } from "./lib/pptxGenerator";
import { parsePptx } from "./lib/pptxParser";
import { renderPresentationForPreview } from "./lib/presentationRenderer";
import { analyzeTemplateWithAi, buildLocalTemplateAnalysis } from "./lib/templateAnalyzer";
import { getTemplateProfile } from "./lib/templateProfiles";
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
};

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

function attachmentIcon(kind: PatientAttachment["kind"]) {
  return kind === "image" ? FileImage : kind === "audio" ? FileAudio : FileText;
}

const NAV_ITEMS: Array<{ id: View; label: string; icon: typeof Home; hint?: string }> = [
  { id: "dashboard", label: "Overview", icon: Home },
  { id: "new-shift", label: "Laporan baru", icon: Plus },
  { id: "inbox", label: "Data pasien", icon: Files, hint: "01" },
  { id: "review", label: "Review klinis", icon: ClipboardCheck, hint: "02" },
  { id: "template", label: "Struktur template", icon: Map, hint: "03" },
  { id: "generate", label: "Generate laporan", icon: Layers3, hint: "04" },
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
        <div className={`progress-step ${index < active ? "done" : ""} ${index === active ? "active" : ""}`} key={step}>
          <span className="progress-dot">{index < active ? <Check size={13} /> : index + 1}</span>
          <span>{step}</span>
          {index < steps.length - 1 && <span className="progress-line" />}
        </div>
      ))}
    </div>
  );
}

function UploadDropzone({ accept, label, hint, onFile, busy = false }: { accept: string; label: string; hint: string; onFile: (file: File) => void; busy?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`upload-dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
      <div className="upload-icon"><CloudUpload size={22} /></div>
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

function BuiltInTemplateList({ templates, loading, activeName, onSelect, compact = false }: { templates: BuiltInTemplateEntry[]; loading: boolean; activeName?: string; onSelect: (entry: BuiltInTemplateEntry) => void; compact?: boolean }) {
  if (loading) return <div className="built-in-loading"><RefreshCw size={14} className="spin" /> Memuat template bawaan…</div>;
  if (!templates.length) return <div className="built-in-empty"><FileArchive size={15} /> Arsip template bawaan belum tersedia.</div>;
  return <div className={`built-in-list ${compact ? "compact" : ""}`}>{templates.map((entry) => <button className={`built-in-template-row ${activeName === entry.label ? "selected" : ""}`} key={entry.archivePath} onClick={() => onSelect(entry)}><span className="built-in-mini-icon"><FileArchive size={15} /></span><span className="built-in-template-copy"><strong>{entry.label}</strong><small>Template bawaan · PPTX editable</small></span>{activeName === entry.label ? <Check size={14} className="built-in-selected" /> : <ChevronRight size={14} className="built-in-arrow" />}</button>)}</div>;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Files; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={26} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
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
          <h1>Selamat datang di <span>JaMed</span></h1>
          <p>Susun data jaga yang tercecer menjadi presentasi klinis yang siap direview.</p>
        </div>
        <div className="topline-actions">
          <div className="privacy-chip"><LockKeyhole size={14} /> Local-first workspace</div>
          <button className="avatar-button" aria-label="Profil"><UserRound size={17} /></button>
        </div>
      </div>

      <div className="hero-grid">
        <div className="hero-card">
          <div className="hero-pattern" />
          <div className="hero-content">
            <div className="hero-kicker"><Sparkles size={15} /> Clinical information compiler</div>
            <h2>Jaga selesai.<br /><em>Laporan lebih siap.</em></h2>
            <p>Upload template departemen, masukkan catatan pasien, lalu review setiap fakta sebelum diekspor ke PowerPoint.</p>
            <button className="button button-light" onClick={onCreate}><Plus size={16} /> Buat laporan baru <ArrowRight size={16} /></button>
          </div>
          <div className="hero-mark"><Stethoscope size={44} /></div>
        </div>
        <div className="workflow-card">
          <div className="card-heading"><div><span className="eyebrow">Cara kerja</span><h3>Dari catatan ke deck</h3></div><BrainCircuit size={20} /></div>
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
        <div className="metric-card"><div className="metric-icon blue"><FileArchive size={18} /></div><div><span>Template aktif</span><strong>{template ? template.slideCount : "—"}<small>{template ? " slides" : " belum ada"}</small></strong></div><span className="metric-note">{template ? "Siap dipetakan" : "Upload PPTX"}</span></div>
        <div className="metric-card"><div className="metric-icon mint"><UsersRound size={18} /></div><div><span>Pasien terdeteksi</span><strong>{patients.length || "—"}</strong></div><span className="metric-note">{patients.length ? "Perlu direview" : "Belum ada data"}</span></div>
        <div className="metric-card"><div className="metric-icon peach"><ClipboardList size={18} /></div><div><span>Status laporan</span><strong>{hasReport ? "Draft" : "Kosong"}</strong></div><span className="metric-note">{hasReport ? "Local workspace" : "Mulai dari nol"}</span></div>
      </div>

      <div className="dashboard-lower">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><span className="eyebrow">Workspace terakhir</span><h3>{hasReport ? shift.title : "Belum ada laporan"}</h3></div><button className="icon-button" onClick={() => onNavigate(hasReport ? "new-shift" : "new-shift")}><ChevronRight size={17} /></button></div>
          {hasReport ? <div className="recent-report"><div className="report-type-icon"><Activity size={20} /></div><div className="report-info"><strong>{shift.title}</strong><span>{shift.department || "Departemen belum diatur"} · {toIndonesianDate(shift.date)}</span><div className="report-progress"><span style={{ width: `${template ? (patients.length ? 72 : 38) : 16}%` }} /></div></div><span className="draft-label">Draft</span></div> : <EmptyState icon={ClipboardList} title="Mulai laporan jaga pertama" description="Satu workspace untuk template, sumber, review, dan hasil akhir." action={<button className="button button-dark button-small" onClick={onCreate}><Plus size={14} /> Buat laporan</button>} />}
        </section>
        <section className="panel principle-panel">
          <div className="principle-quote">“</div>
          <span className="eyebrow">Prinsip JaMed</span>
          <h3>AI membaca informasi.<br /><span>Kode menjaga bentuknya.</span></h3>
          <p>Data klinis dinormalisasi dan diverifikasi dulu, baru dipetakan kembali ke template asli.</p>
          <div className="principle-footer"><ShieldCheck size={16} /> Tidak ada nilai yang diisi diam-diam</div>
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
        <SectionHeading eyebrow="Langkah 01 · Template" title="Pilih template laporan dulu" description="JaMed akan membaca struktur template terlebih dahulu, lalu menyesuaikan panduan pengisian dan mapping klinisnya." action={<div className="autosave"><CircleCheck size={14} /> Tersimpan di perangkat ini</div>} />
        <section className="panel template-first-panel">
          <div className="template-first-grid">
            <div>
              <div className="panel-heading"><div><span className="eyebrow">Template bawaan JaMed</span><h3>Mulai dari format yang sudah dipelajari</h3><p>Template Lapjag sudah memiliki panduan slide, chart WHO, dan aturan pengisian yang spesifik.</p></div><FileArchive size={20} /></div>
              <BuiltInTemplateList templates={builtInTemplates} loading={builtInLoading} onSelect={onBuiltInTemplate} />
            </div>
            <div className="template-first-upload"><div className="template-empty-divider"><span>atau</span></div><span className="eyebrow">Template sendiri</span><h3>Upload PPTX departemen</h3><p>Template lain tetap bisa dipakai; JaMed akan menganalisis shape dan mapping dari awal.</p><UploadDropzone accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" label="Upload template sendiri" hint="Maks. 20 MB · file PPTX" onFile={onTemplate} busy={busy} /></div>
          </div>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
        </section>
      </div>
    );
  }
  const profile = getTemplateProfile(template);
  return (
    <div className="page">
      <ProgressSteps active={0} />
      <SectionHeading eyebrow={`Langkah 01 · ${profile.label}`} title="Atur konteks laporan jaga" description={`${profile.description} Field di bawah mengikuti metadata yang dibutuhkan template ini.`} action={<div className="autosave"><CircleCheck size={14} /> Tersimpan di perangkat ini</div>} />
      <div className="form-layout">
        <section className="panel form-panel">
          <div className="panel-heading"><div><h3>Detail laporan</h3><p>Informasi ini akan mengisi cover dan metadata presentasi.</p></div><ClipboardList size={20} /></div>
          <div className="form-grid">
            <label className="field-label full">Judul laporan<input value={shift.title} onChange={(event) => setShift({ ...shift, title: event.target.value })} placeholder="Contoh: Laporan Jaga Pediatri" /></label>
            <label className="field-label">Tanggal jaga<input type="date" value={shift.date} onChange={(event) => setShift({ ...shift, date: event.target.value })} /></label>
            {profile.shiftFields.map((fieldSpec) => <label className="field-label" key={fieldSpec.key}>{fieldSpec.label}{fieldSpec.required && <span className="required-mark">*</span>}<input value={shiftFieldValue(shift, fieldSpec.key)} onChange={(event) => setShift(setShiftFieldValue(shift, fieldSpec.key, event.target.value))} placeholder={fieldSpec.placeholder} /></label>)}
            {profile.id === "generic" && !template.templateAnalysis && <>
              <label className="field-label">Departemen<input value={shift.department} onChange={(event) => setShift({ ...shift, department: event.target.value })} placeholder="Contoh: Pediatri" /></label>
              <label className="field-label">Rumah sakit<input value={shift.hospital} onChange={(event) => setShift({ ...shift, hospital: event.target.value })} placeholder="Nama rumah sakit" /></label>
            </>}
          </div>
          <div className="form-footer"><div className="form-footer-left"><button className="button button-ghost button-small" onClick={onChangeTemplate}><ArrowLeft size={14} /> Ganti template</button><div className="secure-note"><LockKeyhole size={14} /> Data tetap di browser pada tahap MVP</div></div><button className="button button-dark" onClick={onContinue}>Lanjutkan <ArrowRight size={16} /></button></div>
        </section>
        <aside className="panel side-info-panel">
          <div className="panel-heading"><div><span className="eyebrow">Template inti</span><h3>Gunakan PPTX asli</h3></div><Layers3 size={20} /></div>
          <p>JaMed membaca struktur shape, layout, dan teks dari template. File asli tetap menjadi sumber desain.</p>
          <div className="attached-template"><div className="file-icon"><FileArchive size={19} /></div><div><strong>{template.name}</strong><span>{template.slideCount} slide · kontrak klinis siap · {profile.label}</span></div><CircleCheck className="success-icon" size={18} /></div>
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
  const setRepeat = (slideIndex: number, repeat: boolean) => {
    if (!template) return;
    const slides = template.slides.map((slide) => slide.index === slideIndex ? { ...slide, repeat } : slide);
    const templateAnalysis = template.templateAnalysis ? { ...template.templateAnalysis, slideGuides: template.templateAnalysis.slideGuides.map((guide) => guide.index === slideIndex ? { ...guide, repeat } : guide) } : undefined;
    setTemplate({ ...template, slides, templateAnalysis });
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

  if (!template) return <div className="page"><ProgressSteps active={3} /><SectionHeading eyebrow="Langkah 04 · Struktur template" title="Template belum dipilih" description="Pemilihan template dilakukan di awal laporan baru." /><section className="panel template-empty-picker"><EmptyState icon={FileArchive} title="Belum ada template aktif" description="Kembali ke data laporan untuk memilih template bawaan atau upload template sendiri." action={<button className="button button-dark" onClick={onBack}>Kembali ke data laporan</button>} /></section></div>;
  return (
    <div className="page">
      <ProgressSteps active={3} />
      <SectionHeading eyebrow="Langkah 04 · Struktur template" title="Konfirmasi struktur template" description="Tinjau urutan slide dan pilih slide yang perlu diulang untuk setiap pasien sebelum membuat PPTX." action={<div className="template-confidence"><span className="confidence-dot" /> {template.slides.filter((slide) => slide.repeat).length} slide per pasien</div>} />
      <div className="template-contract-strip"><CircleCheck size={15} /><span>Mapping klinis otomatis sudah aktif untuk <strong>{template.name}</strong>. Di halaman ini Anda hanya perlu mengatur urutan pengulangan slide.</span><span className="template-contract-source">{template.templateAnalysis?.source === "agent" ? "Kontrak dipelajari dari file" : "Kontrak lokal tervalidasi"}</span></div>
      <div className="template-summary-grid"><div className="template-summary"><div className="summary-icon"><FileArchive size={18} /></div><div><span>File template</span><strong>{template.name}</strong></div><span className="summary-meta">{template.fileName}</span></div><div className="template-summary"><div className="summary-icon purple"><Layers3 size={18} /></div><div><span>Slide terdeteksi</span><strong>{template.slideCount} slide</strong></div><span className="summary-meta">struktur terbaca</span></div><div className="template-summary"><div className="summary-icon orange"><Map size={18} /></div><div><span>Diulang per pasien</span><strong>{template.slides.filter((slide) => slide.repeat).length} slide</strong></div><span className="summary-meta">bisa diubah di bawah</span></div></div>
      <section className="panel template-overview-panel">
        <div className="panel-heading compact-heading"><div><h3>Overview slide template</h3><p>Preview menunjukkan layout asli. Teks yang terlihat adalah contoh dari template, bukan data pasien baru.</p></div><Layers3 size={18} /></div>
        {previewBusy && <div className="template-preview-status"><RefreshCw size={14} className="spin" /> Menyiapkan preview slide…</div>}
        {previewError && <div className="template-preview-status warning"><AlertTriangle size={14} /> Preview visual belum tersedia; struktur slide tetap bisa diatur.</div>}
        <div className="template-slide-grid">
          {template.slides.map((slide) => {
            const preview = previewSlides[slide.index];
            return <article className={`template-slide-card ${slide.repeat ? "is-repeat" : ""}`} key={slide.index}>
              <div className="template-slide-card-head"><span>SLIDE {String(slide.index + 1).padStart(2, "0")}</span><span className={`template-slide-status ${slide.repeat ? "repeat" : "static"}`}>{slide.repeat ? "Per pasien" : "Sekali"}</span></div>
              <div className="template-slide-preview">{preview ? <img src={preview} alt={`Preview slide ${slide.index + 1}`} /> : <div className="template-slide-placeholder"><span>{String(slide.index + 1).padStart(2, "0")}</span><strong>{slide.title || `Slide ${slide.index + 1}`}</strong><small>{slide.shapes.length} elemen terbaca</small></div>}</div>
              <div className="template-slide-copy"><strong title={slide.title || `Slide ${slide.index + 1}`}>{slide.title || `Slide ${slide.index + 1}`}</strong><span>{slideRoleLabel(slide.role)} · {slide.shapes.length} elemen</span></div>
              <label className="template-repeat-control"><input type="checkbox" checked={slide.repeat} onChange={(event) => setRepeat(slide.index, event.target.checked)} /><span>Ulangi untuk setiap pasien</span></label>
            </article>;
          })}
        </div>
      </section>
      <div className="template-overview-note"><ShieldCheck size={15} /><span>Field klinis dan mapping shape sudah dikendalikan oleh kontrak template. Anda tidak perlu memilih semantic field satu per satu.</span></div>
      <div className="page-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke review</button><button className="button button-dark" onClick={onContinue}>Simpan struktur & lanjut ke generate <ArrowRight size={16} /></button></div>
    </div>
  );
}

function AttachmentList({ attachments, onRemove }: { attachments: PatientAttachment[]; onRemove: (attachmentId: string) => void }) {
  if (!attachments.length) return null;
  return <div className="attachment-list"><span className="attachment-list-label">Evidence multimodal</span>{attachments.map((attachment) => { const Icon = attachmentIcon(attachment.kind); return <div className="attachment-item" key={attachment.id}><Icon size={15} /><span><strong>{attachment.name}</strong><small>{attachment.kind.toUpperCase()} · {fileSizeLabel(attachment.sizeBytes)}</small></span><button type="button" className="icon-button" title="Hapus attachment" onClick={() => onRemove(attachment.id)}><X size={14} /></button></div>; })}</div>;
}

function InboxPage({ template, drafts, onDraftTextChange, onDraftFile, onRemoveAttachment, onAddDraft, onRemoveDraft, sources, patients, onAnalyze, onContinue, analysisBusy, analysisEngine, error }: { template: ParsedTemplate | null; drafts: PatientDraft[]; onDraftTextChange: (draftId: string, text: string) => void; onDraftFile: (draftId: string, file: File) => void; onRemoveAttachment: (draftId: string, attachmentId: string) => void; onAddDraft: () => void; onRemoveDraft: (draftId: string) => void; sources: SourceItem[]; patients: PatientRecord[]; onAnalyze: () => void; onContinue: () => void; analysisBusy: boolean; analysisEngine: "none" | "ai" | "local" | "mixed"; error: string }) {
  const profile = getTemplateProfile(template);
  const profileTags = profile.id === "lapjag" ? ["PAT terpisah", "WHO siap diplot"] : profile.id.startsWith("perina") ? ["Resusitasi 0–15 mnt", "S.T.A.B.L.E."] : profile.id === "rscm" ? ["PAT + AMPLE", "Diagnosis awal/akhir"] : profile.id === "rsui" ? ["PAT checklist", "Lab + AGD"] : ["Mapping slide", "Profile adaptif"];
  return (
    <div className="page">
      <ProgressSteps active={1} />
      <SectionHeading eyebrow={`Langkah 02 · Clinical inbox · ${profile.label}`} title="Masukkan data per pasien" description={`Setiap kartu pasien menerima free text atau evidence multimodal. Agent akan menata data mengikuti kontrak ${profile.label}, bukan memakai form klinis yang sama untuk semua template.`} action={<div className="privacy-chip"><LockKeyhole size={14} /> Jangan masukkan data yang tidak perlu</div>} />
      <section className="panel template-guide-panel"><div className="template-guide-icon"><ClipboardCheck size={18} /></div><div><span className="eyebrow">Kontrak ekstraksi aktif</span><h3>{profile.label}</h3><p>{profile.description} {profile.patientInputHint}</p></div><div className="template-guide-tags">{profileTags.map((tag) => <span key={tag}>{tag}</span>)}<span>Text + image</span><span>PDF + audio</span></div></section>
      <div className="inbox-layout">
        <section className="panel source-panel">
          <div className="panel-heading"><div><h3>Data pasien per kartu</h3><p>Setiap kartu dikirim sebagai satu record pasien ke agent. Tambahkan kartu baru untuk pasien berikutnya.</p></div><UsersRound size={20} /></div>
          <div className="patient-input-list">
            {drafts.map((draft, index) => <div className="patient-input-card" key={draft.id}>
              <div className="patient-input-head"><div className="patient-input-title"><span className="patient-input-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{draft.label}</strong><span>Source khusus pasien ini</span></div></div>{drafts.length > 1 && <button className="icon-button remove-patient" title="Hapus pasien" onClick={() => onRemoveDraft(draft.id)}><X size={15} /></button>}</div>
              <div className="free-text-source"><div className="free-text-heading"><div><strong>Catatan klinis pasien</strong><span>Tempel catatan mentah apa adanya. Agent akan mengekstrak, memahami konteks, dan menata ke slide sesuai template.</span></div><span className="source-mode-badge">free text</span></div><textarea className="clinical-textarea patient-textarea" value={draft.text} onChange={(event) => onDraftTextChange(draft.id, event.target.value)} placeholder={profile.patientInputHint} /></div>
              <AttachmentList attachments={draft.attachments ?? []} onRemove={(attachmentId) => onRemoveAttachment(draft.id, attachmentId)} />
              <div className="patient-input-actions"><label className="button button-ghost button-small" htmlFor={`patient-file-${draft.id}`}><Upload size={14} /> Tambah evidence</label><input id={`patient-file-${draft.id}`} type="file" accept=".txt,.pdf,image/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) onDraftFile(draft.id, file); event.currentTarget.value = ""; }} /><span className="source-help">Dukungan: TXT, gambar, PDF, dan audio. Semua tetap terikat ke pasien ini.</span></div>
            </div>)}
          </div>
          <button className="add-patient-button add-patient-input" onClick={onAddDraft}><Plus size={14} /> Tambah pasien</button>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
        </section>
        <aside className="panel sources-panel">
          <div className="panel-heading"><div><span className="eyebrow">Evidence inbox</span><h3>Sumber masuk</h3></div><span className="source-count">{sources.length}</span></div>
          {sources.length ? <div className="source-list">{sources.map((source) => { const SourceIcon = source.type === "image" ? FileImage : source.type === "audio" ? FileAudio : source.type === "pdf" ? FileText : FileText; return <div className="source-item" key={source.id}><div className="source-file-icon"><SourceIcon size={16} /></div><div><strong>{source.name}</strong><span>{source.patientLabel ? `${source.patientLabel} · ` : ""}{source.sizeLabel || "Raw text"}</span></div><StatusBadge status={source.status === "ready" ? "documented" : source.status === "unsupported" ? "missing" : "inferred"} compact /></div>; })}</div> : <div className="mini-empty"><Files size={19} /><span>Belum ada source.<br />Setiap kartu pasien akan muncul di sini.</span></div>}
          <div className="source-policy"><ShieldCheck size={15} /><span>Setiap nilai hasil ekstraksi menyimpan snippet sumber untuk review.</span></div>
        </aside>
      </div>
      <section className="panel detection-panel">
        <div className="detection-copy"><div className="detection-icon"><BrainCircuit size={21} /></div><div><span className="eyebrow">{analysisEngine === "ai" ? "AI agent · backend extraction" : analysisEngine === "mixed" ? "AI agent + local fallback" : analysisEngine === "local" ? "Local fallback extraction" : "AI agent siap membaca"}</span><h3>{patients.length ? `${patients.length} pasien terdeteksi` : "Siap membaca catatan"}</h3><p>{patients.length ? "Pemisahan awal berhasil. Lanjutkan untuk meninjau setiap nilai dan konflik." : "Catatan dikirim ke AI agent melalui backend lokal. Nilai hasil ekstraksi tetap perlu direview sebelum export."}</p></div></div>
        {patients.length ? <div className="detected-patients">{patients.map((patient) => <div className="detected-chip" key={patient.id}><span>{patient.displayName.slice(0, 1).toUpperCase()}</span>{patient.displayName}<Check size={13} /></div>)}</div> : <div className="detection-placeholder"><span>Pasien</span><span>Data klinis</span><span>Status field</span></div>}
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

function ReviewPage({ template, patients, activePatientId, setActivePatientId, onUpdate, onContinue, onBack }: { template: ParsedTemplate | null; patients: PatientRecord[]; activePatientId: string; setActivePatientId: (id: string) => void; onUpdate: (patientId: string, path: string, value: string) => void; onContinue: () => void; onBack: () => void }) {
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
  if (!patient) return <div className="page"><EmptyState icon={UsersRound} title="Belum ada pasien" description="Kembali ke data pasien untuk menjalankan ekstraksi." action={<button className="button button-dark" onClick={onBack}>Kembali ke inbox</button>} /></div>;
  const tabs: ReviewTab[] = ["identity", "history", "exam", "assessment", ...(profile.fieldGroups.length ? ["template" as const] : [])];
  const fieldList = fields[tab] || fields.identity;
  const documented = fieldList.filter(({ path }) => fieldAt(patient, path)?.status === "documented" || fieldAt(patient, path)?.status === "user_confirmed").length;
  return (
    <div className="page">
      <ProgressSteps active={2} />
      <SectionHeading eyebrow="Langkah 03 · Human review" title="Review informasi klinis" description="Konfirmasi nilai yang ingin dibawa ke slide. Nilai kosong tetap kosong sampai Anda mengisinya." action={<div className="review-counter"><CircleCheck size={14} /> {documented}/{fieldList.length} field terisi</div>} />
      <div className="review-layout">
        <aside className="panel patient-list-panel">
          <div className="panel-heading compact-heading"><div><h3>Pasien</h3><p>{patients.length} terdeteksi dari source</p></div><UsersRound size={17} /></div>
          <div className="patient-list">{patients.map((item, index) => { const hasConflict = [...Object.values(item), ...Object.values(item.templateData ?? {})].some((value) => value && typeof value === "object" && "status" in value && (value as ClinicalField<unknown>).status === "conflicting"); return <button className={`patient-list-item ${item.id === patient.id ? "selected" : ""}`} key={item.id} onClick={() => setActivePatientId(item.id)}><span className="patient-avatar">{String(index + 1).padStart(2, "0")}</span><span><strong>{item.displayName}</strong><small>{item.demographics.age?.value || "Usia belum ada"} · {item.demographics.sex?.value || "Jenis kelamin belum ada"}</small></span>{hasConflict && <AlertTriangle size={15} className="conflict-icon" />}</button>; })}</div>
          <button className="add-patient-button"><Plus size={14} /> Tambah pasien manual</button>
        </aside>
        <section className="panel review-main-panel">
          <div className="review-patient-header"><div className="review-patient-title"><div className="large-patient-avatar">{patient.displayName.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">Patient record · {patient.sourceId}</span><h3>{patient.displayName}</h3><span>{patient.demographics.age?.value || "Usia belum tercantum"} · {patient.demographics.sex?.value || "Jenis kelamin belum tercantum"}</span></div></div><button className="button button-ghost button-small"><Eye size={14} /> Lihat source</button></div>
          <div className="review-tabs">{tabs.map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item === "identity" ? "Identitas" : item === "history" ? "Anamnesis" : item === "exam" ? "Pemeriksaan" : item === "assessment" ? "Assessment & terapi" : profile.label}</button>)}</div>
          {lapjag && <div className="review-template-note"><ShieldCheck size={14} /><span><strong>Lapjag:</strong> tab <em>{profile.label}</em> menampilkan field yang akan dibaca langsung oleh slide PAT, WHO, diagnosis dan tata laksana.</span></div>}
          <div className="field-grid">{fieldList.map((field) => <FieldCard {...field} patient={patient} key={field.path} onChange={(path, value) => onUpdate(patient.id, path, value)} />)}</div>
          <div className="review-note"><ShieldCheck size={15} /><div><strong>Traceability aktif</strong><span>Source snippet ditampilkan pada field yang berasal dari catatan. Nilai yang Anda edit menjadi user confirmed.</span></div></div>
        </section>
      </div>
      <div className="page-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke inbox</button><button className="button button-dark" onClick={onContinue}>Lanjut ke struktur template <ArrowRight size={16} /></button></div>
    </div>
  );
}

function GeneratePage({ shift, template, patients, onGenerate, onBack, busy, error }: { shift: ShiftDetails; template: ParsedTemplate | null; patients: PatientRecord[]; onGenerate: () => void; onBack: () => void; busy: boolean; error: string }) {
  const repeatCount = template?.slides.filter((slide) => slide.repeat).length ?? 0;
  const expectedSlides = template ? template.slideCount + Math.max(0, patients.length - 1) * repeatCount : 0;
  return (
    <div className="page">
      <ProgressSteps active={4} />
      <SectionHeading eyebrow="Langkah 05 · Output" title="Generate laporan jaga" description="Semua input siap dirender ke salinan template. Setelah dibuat, JaMed akan merender ulang setiap slide untuk quality check visual sebelum download." action={<div className="privacy-chip"><ShieldCheck size={14} /> Review sebelum export</div>} />
      <div className="generate-layout">
        <section className="panel generate-main-panel">
          <div className="generate-summary-head"><div><span className="eyebrow">Report plan</span><h3>{shift.title}</h3><p>{shift.department || "Departemen belum diatur"} · {toIndonesianDate(shift.date)} · {shift.hospital || "Rumah sakit belum diatur"}</p></div><div className="ready-badge"><CircleCheck size={14} /> Ready for render</div></div>
          <div className="plan-grid"><div className="plan-item"><span>Template</span><strong>{template?.name || "Belum ada template"}</strong><small>{template?.slideCount || 0} slide sumber</small></div><div className="plan-item"><span>Patient records</span><strong>{patients.length} pasien</strong><small>source-backed review</small></div><div className="plan-item"><span>Output estimate</span><strong>{expectedSlides || "—"} slide</strong><small>{repeatCount} slide repeat per pasien</small></div></div>
          <div className="generation-checklist"><div className="checklist-heading"><h4>Quality gates</h4><span>3 checks</span></div><div className="checklist-row"><Check size={15} /><span>Template mapping tersimpan</span><small>{template?.bindings.length || 0} binding</small></div><div className="checklist-row"><Check size={15} /><span>Setiap pasien punya record terstruktur</span><small>{patients.length} record</small></div><div className="checklist-row"><Check size={15} /><span>Field missing tidak diisi otomatis</span><small>Policy aktif</small></div></div>
          {error && <div className="inline-error"><AlertTriangle size={15} /> {error}</div>}
          <div className="generate-actions"><button className="button button-ghost" onClick={onBack}><ArrowLeft size={16} /> Kembali ke struktur</button><button className="button button-dark button-large" onClick={onGenerate} disabled={busy || !template || !patients.length}>{busy ? <><RefreshCw size={16} className="spin" /> Membuat PPTX…</> : <><Sparkles size={16} /> Generate editable PPTX</>}</button></div>
        </section>
        <aside className="panel safety-panel"><div className="safety-orb"><LockKeyhole size={22} /></div><span className="eyebrow">Clinical safety boundary</span><h3>JaMed membantu dokumentasi, bukan mengambil keputusan.</h3><p>Diagnosis, temuan, dan tata laksana hanya dibawa dari sumber atau edit user. Nilai yang hilang ditampilkan sebagai “Tidak tercantum”.</p><div className="safety-line"><ShieldCheck size={15} /> Tidak ada rekomendasi obat otomatis</div><div className="safety-line"><ShieldCheck size={15} /> Output tetap editable di PowerPoint</div></aside>
      </div>
    </div>
  );
}

function buildPreviewSlides(template: ParsedTemplate, patients: PatientRecord[]) {
  const profile = getTemplateProfile(template);
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
  let number = 1;
  const groups: ParsedSlide[][] = [];
  let group: ParsedSlide[] = [];
  template.slides.forEach((slide) => { if (slide.repeat) group.push(slide); else if (group.length) { groups.push(group); group = []; } });
  if (group.length) groups.push(group);
  const repeatSet = new Set(groups.flat().map((slide) => slide.index));
  template.slides.forEach((slide) => {
    if (repeatSet.has(slide.index)) return;
    rows.push({ number: number++, title: titleOf(slide), role: slideRoleLabel(slide.role), tag: "Static" });
  });
  const sorted = [...rows];
  if (groups.length) {
    const firstGroup = groups[0];
    const staticBefore = template.slides.filter((slide) => slide.index < firstGroup[0].index && !repeatSet.has(slide.index));
    const staticAfter = template.slides.filter((slide) => slide.index > firstGroup[firstGroup.length - 1].index && !repeatSet.has(slide.index));
    sorted.length = 0;
    staticBefore.forEach((slide) => sorted.push({ number: sorted.length + 1, title: titleOf(slide), role: slideRoleLabel(slide.role), tag: "Static" }));
    patients.forEach((patient, patientIndex) => firstGroup.forEach((slide) => sorted.push({ number: sorted.length + 1, title: titleOf(slide), role: slideRoleLabel(slide.role), patient: patient.displayName, tag: `Patient ${patientIndex + 1}` })));
    staticAfter.forEach((slide) => sorted.push({ number: sorted.length + 1, title: titleOf(slide), role: slideRoleLabel(slide.role), tag: "Static" }));
  }
  return sorted;
}

function PreviewPage({ template, patients, generated, onDownload, onBack, onNew, visualReviewConfirmed, onVisualReviewChange }: { template: ParsedTemplate | null; patients: PatientRecord[]; generated: GeneratedArtifact | null; onDownload: () => void; onBack: () => void; onNew: () => void; visualReviewConfirmed: boolean; onVisualReviewChange: (value: boolean) => void }) {
  const previewRows = template ? buildPreviewSlides(template, patients) : [];
  const [selectedSlide, setSelectedSlide] = useState(0);
  const previewSlides = generated?.previewSlides || [];
  useEffect(() => {
    if (selectedSlide >= previewSlides.length) setSelectedSlide(Math.max(0, previewSlides.length - 1));
  }, [previewSlides.length, selectedSlide]);
  const selectedMeta = previewRows[selectedSlide];
  const hasVisualRender = previewSlides.length > 0;
  return (
    <div className="page">
      <SectionHeading eyebrow="Langkah 05 · Visual quality check" title="Preview laporan jaga" description="JaMed merender PPTX final di server agar setiap slide bisa diperiksa sebelum file diunduh." action={<div className={`ready-badge ${hasVisualRender ? "" : "warning"}`}><CircleCheck size={14} /> {hasVisualRender ? "Render siap direview" : "Render belum tersedia"}</div>} />
      <div className="preview-toolbar"><div className="preview-file"><div className="file-icon large"><FileArchive size={20} /></div><div><strong>{generated?.fileName || "laporan-jaga.pptx"}</strong><span>{generated?.slideCount || previewRows.length} slide · editable PPTX · {generated?.previewEngine || "visual render"}</span></div></div><div className="toolbar-actions"><button className="button button-ghost" onClick={onBack}><Pencil size={14} /> Edit review</button><button className="button button-dark" onClick={onDownload} disabled={!visualReviewConfirmed || !hasVisualRender}><Download size={15} /> Download PPTX</button></div></div>
      {generated?.previewError && <div className="inline-error preview-error"><AlertTriangle size={15} /> {generated.previewError}</div>}
      <div className="preview-layout"><section className="panel preview-stage"><div className="preview-stage-head"><div><span className="eyebrow">Actual PowerPoint render</span><h3>{selectedMeta?.title || "Tampilan per slide"}</h3></div><span>{hasVisualRender ? `${selectedSlide + 1} / ${previewSlides.length}` : "Menunggu render"}</span></div>{hasVisualRender ? <><div className="preview-focus"><button className="preview-nav-button" onClick={() => setSelectedSlide((current) => Math.max(0, current - 1))} disabled={selectedSlide === 0} aria-label="Slide sebelumnya"><ArrowLeft size={17} /></button><img src={previewSlides[selectedSlide]} alt={`Render slide ${selectedSlide + 1}`} /><button className="preview-nav-button" onClick={() => setSelectedSlide((current) => Math.min(previewSlides.length - 1, current + 1))} disabled={selectedSlide === previewSlides.length - 1} aria-label="Slide berikutnya"><ArrowRight size={17} /></button></div><div className="preview-slide-grid rendered-slide-grid">{previewSlides.map((source, index) => { const row = previewRows[index]; return <button className={`preview-slide-card rendered-slide-card ${index === selectedSlide ? "selected" : ""}`} key={`${index}-${row?.title || "slide"}`} onClick={() => setSelectedSlide(index)}><img src={source} alt={`Thumbnail slide ${index + 1}`} /><span className="preview-slide-number">{String(index + 1).padStart(2, "0")}</span><div className="preview-slide-meta"><strong>{row?.title || `Slide ${index + 1}`}</strong><span>{row?.role || "Render PPTX"}</span></div></button>; })}</div></> : <div className="preview-render-empty"><CircleDashed size={24} /><strong>Render visual belum berhasil</strong><span>Perbaiki masalah render lalu generate ulang. Download ditahan sampai slide dapat diperiksa.</span></div>}</section><aside className="panel preview-side"><div className="panel-heading"><div><span className="eyebrow">Quality gate</span><h3>Review sebelum final</h3></div><ClipboardCheck size={19} /></div><div className="export-check"><Check size={14} /><span>Struktur PPTX tervalidasi</span></div><div className={`export-check ${hasVisualRender ? "" : "pending"}`}>{hasVisualRender ? <Check size={14} /> : <CircleDashed size={14} />}<span>Visual render {hasVisualRender ? "tersedia" : "menunggu"}</span></div><div className={`export-check ${generated && generated.slideCount === previewSlides.length ? "" : "pending"}`}>{generated && generated.slideCount === previewSlides.length ? <Check size={14} /> : <CircleDashed size={14} />}<span>Jumlah slide konsisten</span></div><label className="visual-review-control"><input type="checkbox" checked={visualReviewConfirmed} onChange={(event) => onVisualReviewChange(event.target.checked)} disabled={!hasVisualRender} /><span>Saya sudah memeriksa tampilan setiap slide dan menyetujui hasilnya.</span></label><div className="preview-disclaimer"><AlertTriangle size={14} /><span>Periksa teks terpotong, tabel kosong, data yang tertukar, dan elemen yang bertabrakan. Edit review jika ada temuan.</span></div><button className="button button-ghost full-width" onClick={onNew}><Plus size={15} /> Mulai laporan lain</button></aside></div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [shift, setShift] = useState<ShiftDetails>(EMPTY_SHIFT);
  const [template, setTemplate] = useState<ParsedTemplate | null>(null);
  const [patientDrafts, setPatientDrafts] = useState<PatientDraft[]>(createInitialPatientDrafts);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [builtInTemplates, setBuiltInTemplates] = useState<BuiltInTemplateEntry[]>([]);
  const [builtInLoading, setBuiltInLoading] = useState(true);
  const [activePatientId, setActivePatientId] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisEngine, setAnalysisEngine] = useState<"none" | "ai" | "local" | "mixed">("none");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<GeneratedArtifact | null>(null);
  const [visualReviewConfirmed, setVisualReviewConfirmed] = useState(false);
  const generatedUrl = useMemo(() => generated ? URL.createObjectURL(generated.blob) : "", [generated]);

  useEffect(() => () => { if (generatedUrl) URL.revokeObjectURL(generatedUrl); }, [generatedUrl]);

  useEffect(() => {
    let cancelled = false;
    loadBuiltInTemplateCatalog()
      .then((catalog) => { if (!cancelled) setBuiltInTemplates(catalog); })
      .catch(() => { if (!cancelled) setBuiltInTemplates([]); })
      .finally(() => { if (!cancelled) setBuiltInLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
      if (analyzed.error) setError("Agent template belum bisa dihubungi; JaMed memakai observasi lokal sementara.");
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
      const localAnalysis = buildLocalTemplateAnalysis(prepared);
      setTemplate({ ...prepared, templateAnalysis: localAnalysis, analysisStatus: "ready" });
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
      setSources((current) => [...current.filter((source) => source.patientId !== draftId || source.type !== "txt"), { id: `file-${draftId}-${Date.now()}`, name: file.name, type: "txt", sizeLabel: fileSizeLabel(file.size), status: "ready", text, patientId: draftId, patientLabel }]);
      return;
    }
    const kind = attachmentKind(file);
    if (!kind) {
      setError(`Format ${file.name} belum didukung. Gunakan TXT, gambar, PDF, atau audio.`);
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
    setPatientDrafts((current) => [...current, { id: `draft-${Date.now()}`, label: `Pasien ${current.length + 1}`, text: "", attachments: [] }]);
  };

  const removePatientDraft = (draftId: string) => {
    setPatientDrafts((current) => current.filter((draft) => draft.id !== draftId).map((draft, index) => ({ ...draft, label: `Pasien ${index + 1}` })));
    setSources((current) => current.filter((source) => source.patientId !== draftId));
  };

  const analyze = async () => {
    setError("");
    const profile = getTemplateProfile(template);
    const populatedDrafts = patientDrafts.filter((draft) => draft.text.trim() || (draft.attachments ?? []).length);
    if (!populatedDrafts.length) {
      setError("Isi minimal satu kartu pasien, catatan bebas, atau upload evidence multimodal terlebih dahulu.");
      return;
    }
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
          }, draft.attachments ?? []);
          extractedPatients.push(...aiPatients);
        } catch (aiError) {
          const localPatients = extractPatients(sourceText, sourceId).patients;
          extractedPatients.push(...localPatients);
          fallbackMessages.push(`${draft.label}: ${aiError instanceof Error ? aiError.message : "AI backend tidak merespons"}`);
        }
      }
      if (!extractedPatients.length) throw new Error("Data pasien tidak menghasilkan record yang bisa direview.");
      setPatients(extractedPatients);
      setActivePatientId(extractedPatients[0]?.id ?? "");
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
    try {
      const result = await generatePresentation(template, patients, template.bindings, shift);
      let previewSlides: string[] = [];
      let previewEngine = "server renderer";
      let previewError = "";
      try {
        const rendered = await renderPresentationForPreview(result.blob);
        previewSlides = rendered.slides;
        previewEngine = rendered.engine;
      } catch (renderError) {
        previewError = renderError instanceof Error ? renderError.message : "Preview visual gagal.";
      }
      setGenerated({ ...result, previewSlides, previewEngine, previewError });
      setVisualReviewConfirmed(false);
      setView("preview");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "PPTX belum bisa dibuat.");
    } finally {
      setGenerationBusy(false);
    }
  };

  const download = () => {
    if (!generated || !generatedUrl || !visualReviewConfirmed || !generated.previewSlides.length) return;
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
    setAnalysisEngine("none");
    setGenerated(null);
    setVisualReviewConfirmed(false);
    setError("");
    setView("new-shift");
  };

  const navTo = (next: View) => { setError(""); setView(next); };

  const pageTitle = view === "dashboard" ? "Overview" : view === "new-shift" ? "Laporan baru" : view === "template" ? "Struktur template" : view === "inbox" ? "Data pasien" : view === "review" ? "Review klinis" : view === "generate" ? "Generate laporan" : "Preview";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src="/JaMed.png" alt="JaMed" /></div><div><strong>JaMed</strong><span>jaga, made clear</span></div></div>
        <div className="workspace-switcher"><div className="workspace-avatar">J</div><div><span>Workspace</span><strong>{shift.title === EMPTY_SHIFT.title ? "Laporan baru" : shift.title}</strong></div><ChevronDown size={14} /></div>
        <nav className="main-nav"><span className="nav-label">Ruang kerja</span>{NAV_ITEMS.map(({ id, label, icon: Icon, hint }) => <button className={`nav-item ${view === id ? "active" : ""}`} onClick={() => navTo(id)} key={id}><Icon size={17} /><span>{label}</span>{hint && <small>{hint}</small>}</button>)}</nav>
        <div className="sidebar-bottom"><div className="sidebar-mini-card"><div className="mini-orb"><ShieldCheck size={16} /></div><div><strong>Data aman di sini</strong><span>MVP local-first</span></div></div><button className="nav-item"><Settings2 size={17} /><span>Pengaturan</span></button><button className="nav-item"><LifeBuoy size={17} /><span>Bantuan</span></button><div className="sidebar-user"><div className="user-avatar">R</div><div><strong>Rafael</strong><span>Medical clerk</span></div><button className="icon-button"><ChevronRight size={15} /></button></div></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumbs"><span>JaMed</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div><div className="topbar-right"><span className="environment-badge"><span /> Local preview</span><button className="icon-button"><Search size={17} /></button><button className="icon-button mobile-menu"><Menu size={18} /></button></div></header>
        {view === "dashboard" && <Dashboard shift={shift} template={template} patients={patients} onCreate={() => navTo("new-shift")} onNavigate={navTo} />}
        {view === "new-shift" && <NewShiftPage shift={shift} setShift={setShift} template={template} builtInTemplates={builtInTemplates} builtInLoading={builtInLoading} onBuiltInTemplate={handleBuiltInTemplate} onTemplate={handleTemplate} onChangeTemplate={() => { setTemplate(null); navTo("new-shift"); }} onContinue={() => navTo("inbox")} busy={templateBusy} error={error} />}
        {view === "template" && <TemplatePage template={template} setTemplate={setTemplate} onContinue={() => navTo("generate")} onBack={() => navTo("review")} />}
        {view === "inbox" && <InboxPage template={template} drafts={patientDrafts} onDraftTextChange={updateDraftText} onDraftFile={handleDraftFile} onRemoveAttachment={removeAttachment} onAddDraft={addPatientDraft} onRemoveDraft={removePatientDraft} sources={sources} patients={patients} onAnalyze={analyze} onContinue={() => navTo("review")} analysisBusy={analysisBusy} analysisEngine={analysisEngine} error={error} />}
        {view === "review" && <ReviewPage template={template} patients={patients} activePatientId={activePatientId} setActivePatientId={setActivePatientId} onUpdate={updatePatient} onContinue={() => navTo("template")} onBack={() => navTo("inbox")} />}
        {view === "generate" && <GeneratePage shift={shift} template={template} patients={patients} onGenerate={generate} onBack={() => navTo("template")} busy={generationBusy} error={error} />}
        {view === "preview" && <PreviewPage template={template} patients={patients} generated={generated} onDownload={download} onBack={() => navTo("review")} onNew={startNew} visualReviewConfirmed={visualReviewConfirmed} onVisualReviewChange={setVisualReviewConfirmed} />}
      </main>
    </div>
  );
}
