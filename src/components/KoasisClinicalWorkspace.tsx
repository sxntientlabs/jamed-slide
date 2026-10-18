import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowRight, BookOpen, Calculator, CalendarClock, Check, ChevronRight, CircleAlert, ClipboardList, Clock3, Copy, FileText, HeartPulse, ListChecks, MessageCircle, Play, Plus, Presentation, Search, ShieldCheck, Stethoscope, Target, Timer, UserRound, Wrench, X, Zap } from "lucide-react";
import { KoasisGlyph } from "./KoasisGlyph";
import type { AgentId } from "../lib/agentCatalog";
import { detectSensitiveIdentifiers } from "../lib/privacyGuard";
import { loadClinicalState, saveClinicalState } from "../lib/koasisRemoteStore";
import { ASSESSMENT_LAB, CALCULATOR_CATALOG, CAPTURE_KIND_LABELS, CASE_OUTPUTS, CLINICAL_DAY_BLOCKS, fillMessageTemplate, MESSAGE_TEMPLATES, PROCEDURE_CATALOG, SHIFT_FLOW, calculateClinicalTool, type CaptureKind, type CalculatorId, type OpsEncounter, type OpsStage, type OpsSurface, type ProcedureDefinition, type OpsAssessmentAttempt } from "../lib/clinicalOps";
import type { MkarCockpitAction } from "./MkarRotationCockpit";
import type { KoasisWorkspace, WorkspaceTask, ShiftPhase } from "./KoasisWorkspacePanel";

type KoasisClinicalWorkspaceProps = {
  userId: string;
  workspace: KoasisWorkspace;
  tasks: WorkspaceTask[];
  activeShiftPhase: ShiftPhase;
  onShiftPhaseChange: (phase: ShiftPhase) => void;
  onAction: (action: MkarCockpitAction) => void;
  onToggleTask: (taskId: string) => void;
  onOpenWorkspace: () => void;
  onOpenCurriculum: () => void;
};

type CaptureDialogProps = {
  open: boolean;
  kind: CaptureKind;
  onClose: () => void;
  onSubmit: (record: Omit<OpsEncounter, "id" | "createdAt">) => void;
};

const SURFACES: Array<{ id: "clinical" | "shift" | "case"; label: string; detail: string; glyph: "clinical" | "workflow" | "case" }> = [
  { id: "clinical", label: "Kerja klinik", detail: "Weekdays · siapkan sampai rapikan", glyph: "clinical" },
  { id: "shift", label: "Jaga", detail: "Capture · tindakan · handover", glyph: "workflow" },
  { id: "case", label: "Belajar & output", detail: "Kasus · ujian · tools", glyph: "case" },
];

const LEARNING_SURFACES: Array<{ id: "case" | "assessment" | "tools"; label: string; detail: string; glyph: "case" | "exam" | "concept" }> = [
  { id: "case", label: "Kasus & portfolio", detail: "Follow-up · CBD · output", glyph: "case" },
  { id: "assessment", label: "Assessment Lab", detail: "Mini-CEX · DOPS · OSCE · MCQ", glyph: "exam" },
  { id: "tools", label: "Tools desk", detail: "Calculator · message · procedure", glyph: "concept" },
];

const STAGES: Array<{ id: OpsStage; label: string; detail: string }> = [
  { id: "before", label: "Sebelum", detail: "Brief dan review" },
  { id: "during", label: "Saat kegiatan", detail: "Observe dan capture" },
  { id: "after", label: "Setelah", detail: "Feedback dan output" },
];

const STAGE_COPY: Record<OpsStage, { kicker: string; title: string; description: string }> = {
  before: { kicker: "Prebrief", title: "Masuk klinik dengan tujuan yang jelas.", description: "Pilih fokus subspesialisasi, review anamnesis–pemeriksaan fisik, dan siapkan pertanyaan yang bisa kamu bawa ke DPJP." },
  during: { kicker: "Clinical capture", title: "Tangkap fakta saat masih segar.", description: "Gunakan template ringkas untuk encounter, follow-up, atau tindakan. Catat yang terlihat dan dilakukan—bukan asumsi." },
  after: { kicker: "Debrief", title: "Ubah pengalaman menjadi bukti belajar.", description: "Rapikan feedback, data yang kurang, dan next step menjadi logbook, CBD, presentasi, atau sesi belajar." },
};

const DEFAULT_CAPTURE: Omit<OpsEncounter, "id" | "createdAt"> = { alias: "", setting: "", kind: "encounter", summary: "", nextStep: "" };

function newOpsId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatOpsTime(value: string): string {
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "Baru saja";
  }
}

function CaptureDialog({ open, kind, onClose, onSubmit }: CaptureDialogProps) {
  const [values, setValues] = useState(DEFAULT_CAPTURE);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValues({ ...DEFAULT_CAPTURE, kind });
      setError("");
    }
  }, [kind, open]);

  if (!open) return null;
  const update = (key: keyof typeof DEFAULT_CAPTURE, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const alias = values.alias.trim();
    const setting = values.setting.trim();
    const summary = values.summary.trim();
    const nextStep = values.nextStep.trim();
    if (!alias || !summary) {
      setError("Isi alias dan ringkasan fakta agar catatan dapat digunakan kembali.");
      return;
    }
    if (detectSensitiveIdentifiers(`${alias}\n${setting}\n${summary}\n${nextStep}`).length) {
      setError("Gunakan alias dan konteks umum. Jangan masukkan nama, nomor rekam medis, kontak, alamat, atau tanggal lahir.");
      return;
    }
    onSubmit({ alias, setting: setting || "Unit belum ditulis", kind: values.kind, summary, nextStep });
  };

  return <div className="ops-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="ops-dialog" role="dialog" aria-modal="true" aria-labelledby="ops-capture-title">
      <header className="ops-dialog-head"><div><span className="ops-eyebrow">Quick capture · {CAPTURE_KIND_LABELS[kind]}</span><h2 id="ops-capture-title">Catat kegiatan klinik</h2><p>Masukkan fakta singkat sekarang. Detail dan output bisa dirapikan setelahnya.</p></div><button type="button" className="ops-dialog-close" onClick={onClose} aria-label="Tutup capture"><X size={17} /></button></header>
      <div className="ops-safety-note"><ShieldCheck size={14} /><span>Gunakan alias pasien. Catatan tersimpan di workspace privat dan tidak menjadi rekam medis resmi.</span></div>
      <form className="ops-dialog-form" onSubmit={submit}>
        <div className="ops-form-grid"><label><span>Alias pasien <em>wajib</em></span><input autoFocus value={values.alias} onChange={(event) => update("alias", event.target.value)} placeholder="Contoh: P-07" /></label><label><span>Unit / konteks</span><input value={values.setting} onChange={(event) => update("setting", event.target.value)} placeholder="Contoh: Bangsal anak · DPJP jantung" /></label></div>
        <label><span>Jenis capture</span><select value={values.kind} onChange={(event) => update("kind", event.target.value as CaptureKind)}>{Object.entries(CAPTURE_KIND_LABELS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        <label><span>Fakta / temuan / kegiatan <em>wajib</em></span><textarea value={values.summary} onChange={(event) => update("summary", event.target.value)} placeholder="Apa yang kamu lihat, lakukan, atau dengar dari supervisor?" rows={4} /></label>
        <label><span>Next step <em>opsional</em></span><textarea value={values.nextStep} onChange={(event) => update("nextStep", event.target.value)} placeholder="Data yang perlu dilengkapi, feedback, atau follow-up berikutnya…" rows={3} /></label>
        {error && <div className="ops-form-error" role="alert">{error}</div>}
        <footer className="ops-dialog-actions"><button type="button" className="ops-secondary" onClick={onClose}>Batal</button><button type="submit" className="ops-primary"><Check size={14} /> Simpan capture</button></footer>
      </form>
    </section>
  </div>;
}

function SurfaceTabs({ surface, onChange }: { surface: OpsSurface; onChange: (surface: OpsSurface) => void }) {
  const activeSurface = surface === "assessment" || surface === "tools" ? "case" : surface;
  return <section className="ops-route-block"><div className="ops-subsection-heading"><span>Pilih ruang kerja</span><small>Satu pilihan untuk satu sesi</small></div><nav className="ops-surface-tabs" aria-label="Jalur kerja Koasis">{SURFACES.map((item) => <button type="button" key={item.id} className={activeSurface === item.id ? "active" : ""} onClick={() => onChange(item.id)}><span className="ops-tab-mark"><KoasisGlyph name={item.glyph} size={15} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav></section>;
}

function LearningSubnav({ surface, onChange }: { surface: OpsSurface; onChange: (surface: OpsSurface) => void }) {
  return <section className="ops-learning-block"><div className="ops-subsection-heading"><span>Pilih tujuan</span><small>Ruang belajar & output</small></div><nav className="ops-learning-subnav" aria-label="Belajar dan output">{LEARNING_SURFACES.map((item) => <button type="button" key={item.id} className={surface === item.id ? "active" : ""} onClick={() => onChange(item.id)}><span className="ops-subnav-mark"><KoasisGlyph name={item.glyph} size={13} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</nav></section>;
}

function OpsHero({ onCapture, onOpenCurriculum }: { onCapture: () => void; onOpenCurriculum: () => void }) {
  return <section className="ops-hero">
    <div className="ops-hero-copy"><div className="ops-kicker"><span className="ops-kicker-mark"><KoasisGlyph name="clinical" size={15} /></span><span>Koasis workspace</span><span className="ops-live-pill"><i /> siap dipakai</span></div><h1>Apa yang ingin kamu kerjakan?</h1><p>Pilih satu ruang kerja. Koasis akan menjaga urutan langkahnya dari persiapan sampai output.</p><div className="ops-hero-actions"><button type="button" className="ops-primary" onClick={onCapture}><Plus size={15} /> Catat kegiatan</button><button type="button" className="ops-text-action" onClick={onOpenCurriculum}>Lihat kurikulum MKAR <ArrowRight size={13} /></button></div></div>
  </section>;
}

function StageRail({ stage, onChange }: { stage: OpsStage; onChange: (stage: OpsStage) => void }) {
  return <section className="ops-flow-block"><div className="ops-subsection-heading"><span>Langkah kerja</span><small>Pilih tahap yang sedang kamu lakukan</small></div><div className="ops-stage-rail" role="tablist" aria-label="Tahap kegiatan klinik">{STAGES.map((item, index) => <button type="button" role="tab" aria-selected={stage === item.id} className={stage === item.id ? "active" : ""} onClick={() => onChange(item.id)} key={item.id}><span>{index + 1}</span><strong>{item.label}</strong><small>{item.detail}</small>{index < STAGES.length - 1 && <i />}</button>)}</div></section>;
}

export function KoasisClinicalWorkspace({ userId, workspace, tasks, activeShiftPhase, onShiftPhaseChange, onAction, onToggleTask, onOpenWorkspace, onOpenCurriculum }: KoasisClinicalWorkspaceProps) {
  const [surface, setSurfaceState] = useState<OpsSurface>("clinical");
  const [stage, setStage] = useState<OpsStage>(activeShiftPhase);
  const [captureKind, setCaptureKind] = useState<CaptureKind>("encounter");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [encounters, setEncounters] = useState<OpsEncounter[]>([]);
  const [attempts, setAttempts] = useState<OpsAssessmentAttempt[]>([]);
  const [remoteReady, setRemoteReady] = useState(false);
  const [selectedProcedureId, setSelectedProcedureId] = useState(PROCEDURE_CATALOG[0]?.id || "");
  const [procedureProgress, setProcedureProgress] = useState<Record<string, number[]>>({});
  const [calculatorId, setCalculatorId] = useState<CalculatorId>("bmi");
  const [calculatorValues, setCalculatorValues] = useState<Record<string, string>>({});
  const [calculatorResult, setCalculatorResult] = useState<{ value: string; unit: string; note: string } | { error: string } | null>(null);
  const [messageId, setMessageId] = useState(MESSAGE_TEMPLATES[0]?.id || "");
  const [messageValues, setMessageValues] = useState<Record<string, string>>({});
  const [messageDraft, setMessageDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [shiftStep, setShiftStep] = useState(0);

  const activeStage = STAGE_COPY[stage];
  const selectedProcedure = PROCEDURE_CATALOG.find((procedure) => procedure.id === selectedProcedureId) || PROCEDURE_CATALOG[0];
  const selectedCalculator = CALCULATOR_CATALOG.find((calculator) => calculator.id === calculatorId) || CALCULATOR_CATALOG[0];
  const selectedMessage = MESSAGE_TEMPLATES.find((template) => template.id === messageId) || MESSAGE_TEMPLATES[0];
  const completedTasks = tasks.filter((task) => task.done).length;
  const recentEncounters = encounters.slice(0, 4);
  const uncompletedTasks = tasks.filter((task) => !task.done);

  useEffect(() => {
    let disposed = false;
    let loadSucceeded = false;
    setRemoteReady(false);
    void loadClinicalState(userId)
      .then((state) => {
        if (disposed || !state) return;
        loadSucceeded = true;
        setEncounters(state.encounters);
        setAttempts(state.attempts);
      })
      .then(() => {
        loadSucceeded = true;
      })
      .catch((error) => console.warn("Clinical workspace belum dapat dimuat dari Firestore.", error))
      .finally(() => {
        if (!disposed && loadSucceeded) setRemoteReady(true);
      });
    return () => {
      disposed = true;
      setRemoteReady(false);
    };
  }, [userId]);

  useEffect(() => {
    if (!remoteReady) return;
    const timer = window.setTimeout(() => {
      void saveClinicalState(userId, { schemaVersion: 1, encounters, attempts })
        .catch((error) => console.warn("Clinical workspace belum tersimpan ke Firestore.", error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [attempts, encounters, remoteReady, userId]);

  useEffect(() => {
    setStage(activeShiftPhase);
  }, [activeShiftPhase]);

  useEffect(() => {
    if (!selectedMessage) return;
    setMessageValues((current) => Object.fromEntries(selectedMessage.fields.map((field) => [field, current[field] || ""])));
    setMessageDraft("");
    setCopyStatus("");
  }, [messageId, selectedMessage]);

  const setOpsStage = (next: OpsStage) => {
    setStage(next);
    onShiftPhaseChange(next);
  };

  const changeSurface = (next: OpsSurface) => {
    setSurfaceState(next);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const scrollable = document.querySelector(".koasis-conversation-scroll");
        if (scrollable instanceof HTMLElement) scrollable.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  };
  const setSurface = changeSurface;

  const openCapture = (kind: CaptureKind = "encounter") => {
    setCaptureKind(kind);
    setCaptureOpen(true);
  };

  const saveEncounter = (record: Omit<OpsEncounter, "id" | "createdAt">) => {
    setEncounters((current) => [{ ...record, id: newOpsId("encounter"), createdAt: new Date().toISOString() }, ...current]);
    setCaptureOpen(false);
    changeSurface(record.kind === "feedback" ? "case" : "shift");
  };

  const launchAgent = (agentId: AgentId) => onAction({ type: "agent", agentId });
  const launchWorkflow = (kind: "visite" | "study" | "handover" | "exam" | "guideline" | "evidence") => onAction({ type: "workflow", kind });

  const calculate = () => setCalculatorResult(calculateClinicalTool(calculatorId, calculatorValues));

  const createMessageDraft = () => {
    if (!selectedMessage) return;
    setMessageDraft(fillMessageTemplate(selectedMessage, messageValues));
    setCopyStatus("");
  };

  const copyMessage = async () => {
    if (!messageDraft) return;
    try {
      await navigator.clipboard.writeText(messageDraft);
      setCopyStatus("Draft disalin");
    } catch {
      setCopyStatus("Clipboard tidak tersedia; salin manual dari draft.");
    }
  };

  const toggleProcedureStep = (index: number) => {
    if (!selectedProcedure) return;
    setProcedureProgress((current) => {
      const existing = current[selectedProcedure.id] || [];
      return { ...current, [selectedProcedure.id]: existing.includes(index) ? existing.filter((item) => item !== index) : [...existing, index] };
    });
  };

  const recordAssessment = (assessmentId: string) => {
    setAttempts((current) => [{ id: newOpsId("assessment"), assessmentId, note: "Attempt dicatat dari Assessment Lab.", createdAt: new Date().toISOString() }, ...current]);
  };

  const attemptCount = (assessmentId: string) => attempts.filter((attempt) => attempt.assessmentId === assessmentId).length;

  return <div className="ops-workspace">
    <OpsHero onCapture={() => openCapture()} onOpenCurriculum={onOpenCurriculum} />
    <SurfaceTabs surface={surface} onChange={changeSurface} />

    {surface === "clinical" && <>
      <section className="ops-context-strip"><div><CalendarClock size={15} /><span><small>Stase</small><strong>{workspace.rotation}</strong></span></div><div><Stethoscope size={15} /><span><small>Unit</small><strong>{workspace.unit}</strong></span></div><div><Clock3 size={15} /><span><small>Jadwal</small><strong>{workspace.shift}</strong></span></div><button type="button" onClick={onOpenWorkspace}>Edit konteks</button></section>
      <StageRail stage={stage} onChange={setOpsStage} />
      <section className="ops-section-intro"><div><span className="ops-eyebrow">{activeStage.kicker}</span><h2>{activeStage.title}</h2><p>{activeStage.description}</p></div><span className="ops-stage-chip"><i />{stage === "before" ? "Siapkan" : stage === "during" ? "Lakukan" : "Buktikan"}</span></section>
      <section className="ops-main-grid">
        <article className="ops-panel ops-plan-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Clinical day</span><h3>Rangkaian kegiatan weekdays</h3></div><span className="ops-count">{completedTasks}/{tasks.length}</span></div><div className="ops-day-list">{CLINICAL_DAY_BLOCKS.map((block) => <button type="button" className={`ops-day-row ${block.stage === stage ? "focus" : ""}`} key={block.id} onClick={() => { setOpsStage(block.stage); if (block.id === "bedside") launchAgent("prebrief"); else if (block.id === "follow-up") changeSurface("case"); else if (block.id === "discussion") launchAgent("presentation"); else launchAgent(block.agentId); }}><span className="ops-day-mark"><KoasisGlyph name={block.id === "discussion" ? "report" : block.id === "follow-up" ? "case" : block.id === "bedside" ? "study" : "workflow"} size={15} /></span><span><strong>{block.label}</strong><small>{block.detail}</small></span><em>{block.stage === "before" ? "PRE" : block.stage === "during" ? "LIVE" : "POST"}</em><ChevronRight size={14} /></button>)}</div><div className="ops-panel-subhead"><span>Rencana hari ini</span><small>{uncompletedTasks.length ? `${uncompletedTasks.length} next action` : "Semua task selesai"}</small></div><div className="ops-task-mini-list">{tasks.slice(0, 4).map((task) => <button type="button" className={task.done ? "done" : ""} key={task.id} onClick={() => onToggleTask(task.id)}><span>{task.done && <Check size={11} />}</span><strong>{task.label}</strong><small>{task.done ? "Selesai" : task.detail}</small></button>)}</div></article>
        <aside className="ops-panel ops-focus-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Output terdekat</span><h3>{workspace.goal}</h3></div><Target size={16} /></div><div className="ops-output-list">{stage === "before" && <><button type="button" onClick={() => launchAgent("prebrief")}><span><strong>Prebrief DPJP</strong><small>Materi, anamnesis, PF, clinical reasoning</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => launchWorkflow("guideline")}><span><strong>Guideline pack</strong><small>Sumber, red flags, dan hal yang perlu diverifikasi</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => launchWorkflow("study")}><span><strong>Study sprint</strong><small>Recall singkat sebelum masuk unit</small></span><ArrowRight size={14} /></button></>}{stage === "during" && <><button type="button" onClick={() => openCapture("encounter")}><span><strong>Capture encounter</strong><small>Kasus alias dan temuan yang terlihat</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => openCapture("procedure")}><span><strong>Catat tindakan</strong><small>Instruksi, langkah, monitoring, feedback</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => changeSurface("shift")}><span><strong>Buka shift console</strong><small>Untuk pasien baru atau tindakan saat jaga</small></span><ArrowRight size={14} /></button></>}{stage === "after" && <><button type="button" onClick={() => changeSurface("case")}><span><strong>Ubah jadi case brief</strong><small>Fakta, data kurang, hipotesis, next step</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => launchAgent("presentation")}><span><strong>Susun makalah / PPT</strong><small>Outline, source pack, speaker notes</small></span><ArrowRight size={14} /></button><button type="button" onClick={() => changeSurface("tools")}><span><strong>Message Desk</strong><small>Draft feedback atau update ke DPJP</small></span><ArrowRight size={14} /></button></>}</div><div className="ops-safety-inline"><ShieldCheck size={13} /><span>AI menyusun draft dari inputmu. Fakta, identitas, dan keputusan klinis tetap perlu kamu cek.</span></div></aside>
      </section>
    </>}

    {surface === "shift" && <section className="ops-surface-view"><div className="ops-section-intro"><div><span className="ops-eyebrow">Night shift console</span><h2>Jaga: capture cepat, handover jelas.</h2><p>Gunakan alur ini untuk pasien baru, tindakan yang diminta, monitoring serial, dan laporan jaga.</p></div><div className="ops-inline-actions"><button type="button" className="ops-primary" onClick={() => openCapture("encounter")}><Plus size={14} /> Pasien baru</button><button type="button" className="ops-secondary" onClick={() => onAction({ type: "lapjag" })}>Laporan jaga <ArrowRight size={13} /></button></div></div><div className="ops-shift-flow">{SHIFT_FLOW.map((item, index) => <button type="button" key={item.id} className={index === shiftStep ? "active" : index < shiftStep ? "done" : ""} onClick={() => setShiftStep(index)}><span>{index < shiftStep ? <Check size={12} /> : index + 1}</span><strong>{item.label}</strong><small>{item.detail}</small>{index < SHIFT_FLOW.length - 1 && <i />}</button>)}</div><div className="ops-shift-grid"><article className="ops-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Quick capture</span><h3>Yang terjadi di lapangan</h3></div><Zap size={16} /></div><div className="ops-quick-grid"><button type="button" onClick={() => openCapture("encounter")}><UserRound size={16} /><strong>Pasien baru</strong><small>Triase · anam · PF</small></button><button type="button" onClick={() => openCapture("monitoring")}><HeartPulse size={16} /><strong>Monitoring TTV</strong><small>Waktu · nilai · respons</small></button><button type="button" onClick={() => { setSelectedProcedureId("ecg"); changeSurface("tools"); }}><Activity size={16} /><strong>EKG</strong><small>Checklist persiapan</small></button><button type="button" onClick={() => { setSelectedProcedureId("ngt"); changeSurface("tools"); }}><Wrench size={16} /><strong>NGT</strong><small>Safety gate · SOP</small></button><button type="button" onClick={() => launchWorkflow("handover")}><MessageCircle size={16} /><strong>Handover</strong><small>I-PASS · reviewable</small></button><button type="button" onClick={() => onAction({ type: "lapjag" })}><FileText size={16} /><strong>Laporan jaga</strong><small>PPTX legacy workspace</small></button></div></article><article className="ops-panel ops-recent-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Recent capture</span><h3>Timeline shift</h3></div><span className="ops-count">{encounters.length}</span></div>{recentEncounters.length ? <div className="ops-encounter-list">{recentEncounters.map((record) => <div className="ops-encounter-row" key={record.id}><span className="ops-encounter-dot" /><div><strong>{record.alias} · {record.setting}</strong><small>{CAPTURE_KIND_LABELS[record.kind]} · {formatOpsTime(record.createdAt)}</small><p>{record.summary}</p></div></div>)}</div> : <div className="ops-empty-state"><CircleAlert size={18} /><strong>Belum ada capture</strong><span>Mulai dari pasien baru atau monitoring agar handover dan laporan tidak perlu ditulis ulang dari ingatan.</span></div>}</article></div><div className="ops-shift-bottom"><div><span className="ops-eyebrow">Safety boundary</span><strong>Red flag → stop → escalate.</strong><small>Koasis membantu struktur dan checklist. Jika kondisi pasien memburuk, ikuti jalur eskalasi unit dan hubungi supervisor.</small></div><button type="button" onClick={() => launchAgent("procedure")}><ListChecks size={14} /> Buka Procedure Coach</button></div></section>}

    {surface === "case" && <section className="ops-surface-view"><LearningSubnav surface={surface} onChange={setSurface} /><div className="ops-section-intro"><div><span className="ops-eyebrow">Kasus & portfolio</span><h2>Satu tempat untuk follow-up dan output.</h2><p>Mulai dari capture fakta, lalu teruskan ke CBD, logbook, makalah, atau PPT tanpa membuka banyak ruang kerja.</p></div><div className="ops-inline-actions"><button type="button" className="ops-primary" onClick={() => onAction({ type: "case" })}><Plus size={14} /> Buka case workspace</button><button type="button" className="ops-secondary" onClick={() => openCapture("feedback")}><MessageCircle size={14} /> Catat feedback</button></div></div><div className="ops-case-grid"><article className="ops-panel ops-case-timeline"><div className="ops-panel-head"><div><span className="ops-eyebrow">Follow-up timeline</span><h3>{encounters.length ? `${encounters.length} capture tersimpan` : "Mulai dari encounter pertama"}</h3></div><Timer size={16} /></div>{encounters.length ? <div className="ops-encounter-list">{encounters.map((record) => <div className="ops-encounter-row" key={record.id}><span className="ops-encounter-dot" /><div><div className="ops-row-inline"><strong>{record.alias}</strong><span>{formatOpsTime(record.createdAt)}</span></div><small>{CAPTURE_KIND_LABELS[record.kind]} · {record.setting}</small><p>{record.summary}</p>{record.nextStep && <em>Next: {record.nextStep}</em>}</div></div>)}</div> : <div className="ops-empty-state"><ClipboardList size={18} /><strong>Belum ada kasus aktif</strong><span>Capture dari bedside atau jaga akan muncul di sini dan bisa diteruskan menjadi CBD, logbook, makalah, atau PPT.</span><button type="button" className="ops-secondary" onClick={() => openCapture("encounter")}>Tambah encounter <Plus size={13} /></button></div>}</article><aside className="ops-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Transform</span><h3>Jadikan output berikutnya.</h3></div><Presentation size={16} /></div><div className="ops-output-cards">{CASE_OUTPUTS.map((output) => <button type="button" key={output.id} onClick={() => launchAgent(output.agentId)}><span><strong>{output.label}</strong><small>{output.detail}</small></span><ArrowRight size={14} /></button>)}</div><div className="ops-safety-inline"><ShieldCheck size={13} /><span>Draft makalah/PPT harus melewati review sumber, data, dan supervisor.</span></div></aside></div></section>}

    {surface === "assessment" && <section className="ops-surface-view"><LearningSubnav surface={surface} onChange={setSurface} /><div className="ops-section-intro"><div><span className="ops-eyebrow">Assessment Lab</span><h2>Latihan ujian dengan langkah yang jelas.</h2><p>Pilih jenis ujian, mulai simulasi bersama agent, lalu catat attempt dan feedback. Ini progress belajar, bukan nilai resmi.</p></div><span className="ops-stage-chip"><ShieldCheck size={13} /> Review manusia wajib</span></div><div className="ops-assessment-summary"><div><strong>{attempts.length}</strong><span>attempt tercatat</span></div><div><strong>{ASSESSMENT_LAB.length}</strong><span>mode latihan</span></div><div><strong>{new Set(attempts.map((attempt) => attempt.assessmentId)).size}</strong><span>assessment disentuh</span></div></div><div className="ops-assessment-grid">{ASSESSMENT_LAB.map((assessment) => <article className={assessment.kind} key={assessment.id}><div className="ops-assessment-top"><span>{assessment.kind === "formative" ? "Formatif" : "Sumatif"}</span><b>{attemptCount(assessment.id)} attempt</b></div><h3>{assessment.label}</h3><p>{assessment.description}</p><div className="ops-checklist-preview">{assessment.checklist.slice(0, 3).map((item) => <span key={item}><Check size={11} />{item}</span>)}</div><footer><button type="button" onClick={() => launchAgent(assessment.agentId)}><Play size={12} /> Mulai latihan</button><button type="button" onClick={() => recordAssessment(assessment.id)}><Plus size={12} /> Catat attempt</button></footer></article>)}</div></section>}

    {surface === "tools" && <section className="ops-surface-view"><LearningSubnav surface={surface} onChange={setSurface} /><div className="ops-section-intro"><div><span className="ops-eyebrow">Tools desk</span><h2>Alat bantu untuk pekerjaan yang berulang.</h2><p>Calculator, draft chat, dan checklist prosedur ada di satu meja. Gunakan hasilnya sebagai bahan review, bukan keputusan otomatis.</p></div><div className="ops-inline-actions"><button type="button" className="ops-secondary" onClick={() => launchAgent("evidence")}><Search size={14} /> Evidence Desk</button><button type="button" className="ops-secondary" onClick={() => launchAgent("procedure")}><ListChecks size={14} /> Procedure Coach</button></div></div><div className="ops-tool-grid"><article className="ops-panel ops-calculator-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Calculator desk</span><h3>{selectedCalculator.label}</h3></div><Calculator size={16} /></div><select className="ops-tool-select" value={calculatorId} onChange={(event) => { setCalculatorId(event.target.value as CalculatorId); setCalculatorResult(null); setCalculatorValues({}); }} aria-label="Pilih kalkulator">{CALCULATOR_CATALOG.map((calculator) => <option value={calculator.id} key={calculator.id}>{calculator.label}</option>)}</select><p className="ops-tool-description">{selectedCalculator.shortDescription}</p><div className="ops-input-grid">{selectedCalculator.inputs.map((input) => <label key={input.key}><span>{input.label} <em>{input.unit}</em></span><input inputMode="decimal" value={calculatorValues[input.key] || ""} onChange={(event) => { setCalculatorValues((current) => ({ ...current, [input.key]: event.target.value })); setCalculatorResult(null); }} placeholder={input.placeholder} /></label>)}</div><div className="ops-formula"><span>Formula</span><strong>{selectedCalculator.formula}</strong></div><button type="button" className="ops-primary ops-full" onClick={calculate}><Calculator size={14} /> Hitung</button>{calculatorResult && ("error" in calculatorResult ? <div className="ops-form-error" role="alert">{calculatorResult.error}</div> : <div className="ops-calculator-result"><span>Hasil belajar</span><strong>{calculatorResult.value} <small>{calculatorResult.unit}</small></strong><p>{calculatorResult.note}</p></div>)}<small className="ops-tool-source">{selectedCalculator.sourceLabel}</small></article><article className="ops-panel ops-message-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Message desk</span><h3>Draft chat ke DPJP</h3></div><MessageCircle size={16} /></div><select className="ops-tool-select" value={messageId} onChange={(event) => setMessageId(event.target.value)} aria-label="Pilih template chat">{MESSAGE_TEMPLATES.map((template) => <option value={template.id} key={template.id}>{template.label}</option>)}</select><p className="ops-tool-description">{selectedMessage?.purpose}</p><div className="ops-input-stack">{selectedMessage?.fields.map((field) => <label key={field}><span>{field === "alias" ? "Alias pasien" : field === "unit" ? "Unit" : field === "summary" ? "Ringkasan" : field === "assessment" ? "Jenis assessment" : field === "time" ? "Waktu" : field === "update" ? "Update" : field === "nextStep" ? "Yang sudah dilakukan" : field === "activity" ? "Kegiatan" : field === "question" ? "Fokus feedback" : field === "topic" ? "Topik/kasus" : "Deadline"}</span><textarea rows={field === "summary" || field === "update" || field === "question" ? 2 : 1} value={messageValues[field] || ""} onChange={(event) => setMessageValues((current) => ({ ...current, [field]: event.target.value }))} placeholder={`Isi ${field}`} /></label>)}</div><button type="button" className="ops-secondary ops-full" onClick={createMessageDraft}><MessageCircle size={14} /> Buat draft</button>{messageDraft && <div className="ops-message-draft"><div><span>Review sebelum kirim</span><button type="button" onClick={copyMessage} aria-label="Salin draft"><Copy size={13} /></button></div><p>{messageDraft}</p>{copyStatus && <small>{copyStatus}</small>}</div>}<small className="ops-tool-source">Draft only · tidak ada pengiriman otomatis.</small></article><article className="ops-panel ops-procedure-panel"><div className="ops-panel-head"><div><span className="ops-eyebrow">Procedure coach</span><h3>Checklist tindakan</h3></div><Wrench size={16} /></div><select className="ops-tool-select" value={selectedProcedure?.id || ""} onChange={(event) => setSelectedProcedureId(event.target.value)} aria-label="Pilih prosedur">{PROCEDURE_CATALOG.map((procedure) => <option value={procedure.id} key={procedure.id}>{procedure.label}</option>)}</select>{selectedProcedure && <><p className="ops-tool-description">{selectedProcedure.description}</p><div className="ops-safety-note compact"><ShieldCheck size={13} /><span>{selectedProcedure.safetyGate}</span></div><div className="ops-procedure-steps">{selectedProcedure.steps.map((step, index) => { const done = procedureProgress[selectedProcedure.id]?.includes(index); return <button type="button" className={done ? "done" : ""} key={step} onClick={() => toggleProcedureStep(index)}><span>{done ? <Check size={12} /> : index + 1}</span><strong>{step}</strong></button>; })}</div><div className="ops-procedure-footer"><span>{procedureProgress[selectedProcedure.id]?.length || 0}/{selectedProcedure.steps.length} langkah</span><button type="button" onClick={() => launchAgent("procedure")}>Buka agent <ArrowRight size={13} /></button></div><small className="ops-tool-source">{selectedProcedure.sourceLabel}</small></>}</article></div></section>}

    <footer className="ops-footer"><ShieldCheck size={13} /><span>Local-first · alias only · output AI perlu review manusia.</span><span>Gunakan SOP rumah sakit dan arahan DPJP sebagai sumber utama.</span></footer>
    <CaptureDialog open={captureOpen} kind={captureKind} onClose={() => setCaptureOpen(false)} onSubmit={saveEncounter} />
  </div>;
}
