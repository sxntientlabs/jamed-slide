import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BookOpenCheck, CalendarDays, Check, ChevronRight, CircleAlert, ClipboardCheck, Clock3, FileText, Layers3, Plus, ShieldCheck, Target, UserRound } from "lucide-react";
import { KoasisGlyph } from "./KoasisGlyph";
import type { AgentId } from "../lib/agentCatalog";
import { MKAR_ASSESSMENTS, MKAR_CLINICAL_TOPIC_GROUPS, MKAR_PHASES, MKAR_PROFILE, MKAR_SUB_CPMK, MKAR_TARGETS, type MkarPhaseId } from "../lib/mkarProfile";
import { detectSensitiveIdentifiers } from "../lib/privacyGuard";
import { loadMkarEvidence, saveMkarEvidence, type RemoteMkarEvidence } from "../lib/koasisRemoteStore";
import type { KoasisWorkflowKind } from "./KoasisWorkflowDialog";
import type { KoasisWorkspace, WorkspaceTask, ShiftPhase } from "./KoasisWorkspacePanel";

type CockpitView = "today" | "competency" | "assessment";

export type MkarCockpitAction =
  | { type: "workspace" }
  | { type: "case" }
  | { type: "lapjag" }
  | { type: "agent"; agentId: AgentId }
  | { type: "workflow"; kind: KoasisWorkflowKind };

type MkarRotationCockpitProps = {
  userId: string;
  workspace: KoasisWorkspace;
  tasks: WorkspaceTask[];
  activeShiftPhase: ShiftPhase;
  onShiftPhaseChange: (phase: ShiftPhase) => void;
  onAction: (action: MkarCockpitAction) => void;
  onToggleTask: (taskId: string) => void;
  onOpenOps?: () => void;
};

type MkarEvidence = RemoteMkarEvidence;

type MkarEvidenceDraft = {
  targetId: string;
  assessmentId: string;
  context: string;
  note: string;
};

type MkarEvidenceSeed = Pick<MkarEvidenceDraft, "targetId" | "assessmentId">;

const SHIFT_PHASE_LABELS: Record<ShiftPhase, string> = {
  before: "Sebelum kerklin & jaga",
  during: "Saat kerklin & jaga",
  after: "Setelah kerklin & jaga",
};

const TASK_TO_ACTION: Record<string, MkarCockpitAction | undefined> = {
  prepare: { type: "workflow", kind: "visite" },
  case: { type: "case" },
  debrief: { type: "workflow", kind: "study" },
};

function targetSummary(category: "skill" | "case") {
  const targets = MKAR_TARGETS.filter((target) => target.category === category);
  return { count: targets.length, total: targets.reduce((sum, target) => sum + target.target, 0) };
}

function actionLabel(action: MkarCockpitAction): string {
  if (action.type === "case") return "Buka case workspace";
  if (action.type === "lapjag") return "Buka laporan jaga";
  if (action.type === "workspace") return "Atur konteks rotasi";
  if (action.type === "workflow") return `Buka ${action.kind}`;
  return `Buka ${action.agentId}`;
}

function ProgressPill({ label }: { label: string }) {
  return <span className="mkar-progress-pill"><i />{label}</span>;
}

function mkarEvidenceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mkar-evidence-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function MkarEvidenceDialog({
  open,
  draft,
  error,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft: MkarEvidenceDraft;
  error: string;
  onChange: (key: keyof MkarEvidenceDraft, value: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;
  return <div className="mkar-evidence-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="mkar-evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="mkar-evidence-title">
      <header className="mkar-evidence-dialog-head"><div><span className="mkar-eyebrow">Portfolio capture</span><h2 id="mkar-evidence-title">Catat evidence rotasi</h2><p>Tambahkan kegiatan yang benar-benar kamu lakukan. Data ini tersimpan di workspace privat dan belum dikirim ke AI.</p></div><button type="button" className="mkar-evidence-close" onClick={onClose} aria-label="Tutup catat evidence">×</button></header>
      <div className="mkar-evidence-safety"><ShieldCheck size={14} /><span>Gunakan alias atau konteks umum saja. Jangan masukkan nama, nomor rekam medis, alamat, atau kontak pasien.</span></div>
      <form className="mkar-evidence-form" onSubmit={onSubmit}>
        <label><span>Target kasus / skill</span><select value={draft.targetId} onChange={(event) => onChange("targetId", event.target.value)} disabled={Boolean(draft.assessmentId)}><option value="">Tidak terkait target tertentu</option>{MKAR_TARGETS.map((target) => <option value={target.id} key={target.id}>{target.label} · target {target.target} {target.unit}</option>)}</select></label>
        <label><span>Assessment</span><select value={draft.assessmentId} onChange={(event) => onChange("assessmentId", event.target.value)}><option value="">Bukan assessment formal</option>{MKAR_ASSESSMENTS.map((assessment) => <option value={assessment.id} key={assessment.id}>{assessment.label} · {assessment.required}</option>)}</select></label>
        <label><span>Alias / konteks singkat <em>wajib</em></span><input value={draft.context} onChange={(event) => onChange("context", event.target.value)} placeholder="Contoh: P-07 · poli · anamnesis terobservasi" autoFocus /></label>
        <label><span>Catatan evidence <em>opsional</em></span><textarea value={draft.note} onChange={(event) => onChange("note", event.target.value)} placeholder="Apa yang dilakukan, siapa yang memberi feedback, atau apa next step-nya?" rows={3} /></label>
        {error && <div className="mkar-evidence-error" role="alert">{error}</div>}
        <footer className="mkar-evidence-actions"><button type="button" className="mkar-secondary-action" onClick={onClose}>Batal</button><button type="submit" className="mkar-primary-action"><Check size={14} /> Simpan evidence</button></footer>
      </form>
    </section>
  </div>;
}

export function MkarRotationCockpit({ userId, workspace, tasks, activeShiftPhase, onShiftPhaseChange, onAction, onToggleTask, onOpenOps }: MkarRotationCockpitProps) {
  const [view, setView] = useState<CockpitView>("today");
  const [mkarPhase, setMkarPhase] = useState<MkarPhaseId>("latihan");
  const [evidenceRecords, setEvidenceRecords] = useState<MkarEvidence[]>([]);
  const [remoteReady, setRemoteReady] = useState(false);
  const [evidenceDialogOpen, setEvidenceDialogOpen] = useState(false);
  const [evidenceDraft, setEvidenceDraft] = useState<MkarEvidenceDraft>({ targetId: MKAR_TARGETS[0]?.id || "", assessmentId: "", context: "", note: "" });
  const [evidenceError, setEvidenceError] = useState("");
  const completedTasks = tasks.filter((task) => task.done).length;
  const skills = targetSummary("skill");
  const cases = targetSummary("case");
  const activeMkarPhase = MKAR_PHASES.find((phase) => phase.id === mkarPhase) ?? MKAR_PHASES[1];
  const targetCount = (targetId: string) => evidenceRecords.filter((record) => record.targetId === targetId).length;
  const assessmentCount = (assessmentId: string) => evidenceRecords.filter((record) => record.assessmentId === assessmentId).length;
  const skillRecorded = MKAR_TARGETS.filter((target) => target.category === "skill").reduce((sum, target) => sum + Math.min(targetCount(target.id), target.target), 0);
  const caseRecorded = MKAR_TARGETS.filter((target) => target.category === "case").reduce((sum, target) => sum + Math.min(targetCount(target.id), target.target), 0);

  useEffect(() => {
    let disposed = false;
    let loadSucceeded = false;
    setRemoteReady(false);
    void loadMkarEvidence(userId)
      .then((evidence) => {
        loadSucceeded = true;
        if (!disposed) setEvidenceRecords(evidence);
      })
      .catch((error) => console.warn("Portfolio evidence belum dapat dimuat dari Firestore.", error))
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
      void saveMkarEvidence(userId, evidenceRecords)
        .catch((error) => console.warn("Portfolio evidence belum tersimpan ke Firestore.", error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [evidenceRecords, remoteReady, userId]);

  const openEvidenceDialog = (seed: Partial<MkarEvidenceSeed> = {}) => {
    setEvidenceDraft({ targetId: seed.targetId ?? MKAR_TARGETS[0]?.id ?? "", assessmentId: seed.assessmentId ?? "", context: "", note: "" });
    setEvidenceError("");
    setEvidenceDialogOpen(true);
  };

  const updateEvidenceDraft = (key: keyof MkarEvidenceDraft, value: string) => {
    setEvidenceDraft((current) => ({ ...current, [key]: value, ...(key === "assessmentId" && value ? { targetId: "" } : {}), ...(key === "targetId" && value ? { assessmentId: "" } : {}) }));
    if (evidenceError) setEvidenceError("");
  };

  const saveEvidence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const context = evidenceDraft.context.trim();
    if (!context) {
      setEvidenceError("Isi alias atau konteks singkat agar evidence bisa ditemukan kembali.");
      return;
    }
    const findings = detectSensitiveIdentifiers(`${context}\n${evidenceDraft.note}`);
    if (findings.length) {
      setEvidenceError("Gunakan alias, bukan identitas langsung pasien.");
      return;
    }
    if (!evidenceDraft.targetId && !evidenceDraft.assessmentId) {
      setEvidenceError("Pilih target kasus/skill atau assessment yang terkait.");
      return;
    }
    setEvidenceRecords((current) => [{ id: mkarEvidenceId(), targetId: evidenceDraft.targetId || undefined, assessmentId: evidenceDraft.assessmentId || undefined, context, note: evidenceDraft.note.trim(), createdAt: new Date().toISOString() }, ...current]);
    setEvidenceDialogOpen(false);
  };

  return <div className="mkar-cockpit">
    <section className="mkar-cockpit-hero">
      <div className="mkar-cockpit-hero-copy">
        <div className="mkar-cockpit-kicker"><span className="mkar-kicker-mark"><KoasisGlyph name="clinical" size={15} /></span><span>Koasis · rotation cockpit</span><ProgressPill label={MKAR_PROFILE.duration} /></div>
        <h1>Rencanakan klinik, buktikan kompetensi.</h1>
        <p>{MKAR_PROFILE.label} disusun sebagai ruang kerja koas: mulai dari prebrief, ikuti kasus, minta feedback, lalu ubah pengalaman menjadi portfolio dan kesiapan ujian.</p>
        <div className="mkar-cockpit-hero-actions"><button type="button" className="mkar-primary-action" onClick={() => onAction({ type: "case" })}><Plus size={15} /> Mulai case workspace</button>{onOpenOps && <button type="button" className="mkar-secondary-action" onClick={onOpenOps}>Clinical workspace <ArrowRight size={14} /></button>}<button type="button" className="mkar-secondary-action" onClick={() => onAction({ type: "workspace" })}>Atur konteks rotasi <ArrowRight size={14} /></button><button type="button" className="mkar-secondary-action" onClick={() => openEvidenceDialog()}><FileText size={14} /> Catat evidence</button></div>
      </div>
      <div className="mkar-hero-status" aria-label="Status profil rotasi">
        <div className="mkar-hero-status-top"><span>Profil kurikulum</span><KoasisGlyph name="workflow" size={17} /></div>
        <strong>{MKAR_PROFILE.shortLabel}</strong>
        <span>{MKAR_PROFILE.learningModel}</span>
        <div className="mkar-hero-status-rule" />
        <div className="mkar-hero-status-row"><span>Evidence tercatat</span><b>{evidenceRecords.length ? `${evidenceRecords.length} item` : "Belum dicatat"}</b></div>
        <small>Progress dihitung dari kegiatan yang kamu catat; verifikasi supervisor tetap terpisah.</small>
      </div>
    </section>

    <section className="mkar-context-strip" aria-label="Konteks rotasi aktif">
      <div className="mkar-context-strip-item"><CalendarDays size={14} /><span><small>Stase</small><strong>{workspace.rotation}</strong></span></div>
      <div className="mkar-context-strip-item"><Layers3 size={14} /><span><small>Unit</small><strong>{workspace.unit}</strong></span></div>
      <div className="mkar-context-strip-item"><Clock3 size={14} /><span><small>Jadwal</small><strong>{workspace.shift}</strong></span></div>
      <button type="button" onClick={() => onAction({ type: "workspace" })}>Edit konteks</button>
    </section>

    <nav className="mkar-cockpit-tabs" aria-label="Rotasi MKAR">
      <button type="button" className={view === "today" ? "active" : ""} onClick={() => setView("today")}><span>Hari ini</span><small>Shift dan next action</small></button>
      <button type="button" className={view === "competency" ? "active" : ""} onClick={() => setView("competency")}><span>Kompetensi</span><small>18 Sub-CPMK dan target</small></button>
      <button type="button" className={view === "assessment" ? "active" : ""} onClick={() => setView("assessment")}><span>Portfolio & ujian</span><small>Assessment dan bukti</small></button>
    </nav>

    {view === "today" && <>
      <section className="mkar-phase-board" aria-label="Siklus belajar MKAR">
        <div className="mkar-section-intro"><div><span className="mkar-eyebrow">Learning loop</span><h2>{activeMkarPhase.label}</h2><p>{activeMkarPhase.description}</p></div><span className="mkar-phase-detail">{activeMkarPhase.detail}</span></div>
        <div className="mkar-phase-track">{MKAR_PHASES.map((phase, index) => <button type="button" key={phase.id} className={`mkar-phase-step ${mkarPhase === phase.id ? "active" : ""}`} onClick={() => setMkarPhase(phase.id)}><span className="mkar-phase-number">{index + 1}</span><span><strong>{phase.label}</strong><small>{phase.shortLabel}</small></span>{index < MKAR_PHASES.length - 1 && <i />}</button>)}</div>
      </section>

      <section className="mkar-summary-grid" aria-label="Ringkasan kebutuhan rotasi">
        <article><span className="mkar-summary-icon"><Target size={16} /></span><span><small>Target skill & prosedur</small><strong>{skillRecorded}<small>/{skills.total}</small></strong><em>{skills.count} jenis · {skillRecorded ? "ada catatan" : "belum dicatat"}</em></span></article>
        <article><span className="mkar-summary-icon"><UserRound size={16} /></span><span><small>Target kasus klinis</small><strong>{caseRecorded}<small>/{cases.total}</small></strong><em>{cases.count} topik · {caseRecorded ? "ada catatan" : "belum dicatat"}</em></span></article>
        <article><span className="mkar-summary-icon"><ClipboardCheck size={16} /></span><span><small>Task hari ini</small><strong>{completedTasks}<small>/{tasks.length}</small></strong><em>{completedTasks ? "sebagian selesai" : "mulai dari satu output"}</em></span></article>
      </section>

      <section className="mkar-main-grid">
        <article className="mkar-panel mkar-today-panel">
          <div className="mkar-panel-heading"><div><span className="mkar-eyebrow">Today / {SHIFT_PHASE_LABELS[activeShiftPhase]}</span><h2>{workspace.goal}</h2></div><span className="mkar-panel-count">{completedTasks}/{tasks.length}</span></div>
          <div className="mkar-task-progress"><span style={{ width: `${tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0}%` }} /></div>
          <div className="mkar-task-list">{tasks.map((task) => <div className={`mkar-task-row ${task.done ? "done" : ""}`} key={task.id}><button type="button" className="mkar-task-check" onClick={() => onToggleTask(task.id)} aria-label={task.done ? `Tandai ${task.label} belum selesai` : `Tandai ${task.label} selesai`}>{task.done && <Check size={12} />}</button><button type="button" className="mkar-task-copy" onClick={() => TASK_TO_ACTION[task.id] && onAction(TASK_TO_ACTION[task.id] as MkarCockpitAction)}><strong>{task.label}</strong><small>{task.detail}</small></button><ChevronRight size={14} /></div>)}</div>
          <div className="mkar-phase-switcher"><span>Mode shift</span>{(["before", "during", "after"] as ShiftPhase[]).map((phase) => <button type="button" key={phase} className={activeShiftPhase === phase ? "active" : ""} onClick={() => onShiftPhaseChange(phase)}>{SHIFT_PHASE_LABELS[phase]}</button>)}</div>
        </article>

        <article className="mkar-panel mkar-start-panel">
          <div className="mkar-panel-heading"><div><span className="mkar-eyebrow">Mulai dari sini</span><h2>Pilih output terdekat.</h2></div><BookOpenCheck size={16} /></div>
          <div className="mkar-start-list">
            <button type="button" onClick={() => onAction({ type: "case" })}><span className="mkar-start-mark"><KoasisGlyph name="case" size={16} /></span><span><strong>Case workspace</strong><small>Susun fakta, data hilang, dan pertanyaan supervisor.</small></span><ArrowRight size={14} /></button>
            <button type="button" onClick={() => onAction({ type: "workflow", kind: "visite" })}><span className="mkar-start-mark"><KoasisGlyph name="workflow" size={16} /></span><span><strong>Prebrief visite</strong><small>Prioritas, checklist, dan follow-up yang perlu diverifikasi.</small></span><ArrowRight size={14} /></button>
            <button type="button" onClick={() => onAction({ type: "agent", agentId: "study" })}><span className="mkar-start-mark"><KoasisGlyph name="study" size={16} /></span><span><strong>Study sprint</strong><small>Ubah learning gap menjadi recall dan latihan singkat.</small></span><ArrowRight size={14} /></button>
            <button type="button" onClick={() => onAction({ type: "lapjag" })}><span className="mkar-start-mark"><KoasisGlyph name="report" size={16} /></span><span><strong>Laporan jaga</strong><small>Susun, review, dan buat output editable lewat chat.</small></span><ArrowRight size={14} /></button>
          </div>
        </article>
      </section>

      <section className="mkar-topic-strip"><div><span className="mkar-eyebrow">Coverage map</span><h2>Topik yang perlu kamu temui dan pahami.</h2></div><button type="button" onClick={() => setView("competency")}>Lihat seluruh target <ArrowRight size={13} /></button><div className="mkar-topic-grid">{MKAR_CLINICAL_TOPIC_GROUPS.map((group) => <div key={group.label}><strong>{group.label}</strong><p>{group.topics}</p></div>)}</div></section>
    </>}

    {view === "competency" && <section className="mkar-detail-view">
      <div className="mkar-detail-intro"><div><span className="mkar-eyebrow">Competency map</span><h2>18 Sub-CPMK yang harus terlihat buktinya.</h2><p>Setiap kegiatan klinik, feedback, dan artifact nanti akan dipetakan ke kompetensi yang relevan. {evidenceRecords.length ? `${evidenceRecords.length} evidence sudah tercatat; pemetaan ke rubrik tetap perlu review supervisor.` : "Mulai dari satu kegiatan yang benar-benar kamu lakukan."}</p></div><span className="mkar-empty-status">{evidenceRecords.length ? <><Check size={13} /> {evidenceRecords.length} evidence</> : <><CircleAlert size={13} /> Belum ada evidence</>}</span></div>
      <div className="mkar-competency-grid">{MKAR_SUB_CPMK.map((outcome) => <article key={outcome.id}><span className="mkar-outcome-number">{String(outcome.id).padStart(2, "0")}</span><div><strong>{outcome.label}</strong><small>Belum ada bukti terverifikasi</small></div><ChevronRight size={14} /></article>)}</div>
      <div className="mkar-target-section"><div className="mkar-section-intro"><div><span className="mkar-eyebrow">Minimum exposure</span><h2>Target kasus dan keterampilan</h2><p>Catat pengalaman nyata atau simulasi secara eksplisit. Jangan mencampur keduanya.</p></div><button type="button" className="mkar-secondary-action" onClick={() => openEvidenceDialog()}>Tambah evidence <Plus size={14} /></button></div><div className="mkar-target-grid">{MKAR_TARGETS.map((target) => <article key={target.id}><div><strong>{target.label}</strong><small>{target.note || (target.category === "case" ? "Kasus klinis" : "Keterampilan")}</small></div><span><b>{targetCount(target.id)}</b> / {target.target} {target.unit}</span><button type="button" onClick={() => openEvidenceDialog({ targetId: target.id })}>Catat <Plus size={11} /></button></article>)}</div></div>
    </section>}

    {view === "assessment" && <section className="mkar-detail-view">
      <div className="mkar-detail-intro"><div><span className="mkar-eyebrow">Portfolio & assessment</span><h2>Bukti yang harus kamu kumpulkan sebelum ujian.</h2><p>Assessment formatif membantu menemukan gap. Assessment sumatif punya bobot, tetapi semua tetap perlu supervisor dan rubrik resmi.</p></div><span className="mkar-empty-status"><ShieldCheck size={13} /> {evidenceRecords.length ? `${evidenceRecords.length} evidence` : "Review manusia wajib"}</span></div>
      <div className="mkar-assessment-grid">{MKAR_ASSESSMENTS.map((assessment) => <article key={assessment.id} className={assessment.kind === "sumatif" ? "sumatif" : "formatif"}><div className="mkar-assessment-top"><span className="mkar-assessment-kind">{assessment.kind}</span><strong>{assessment.weight}</strong></div><h3>{assessment.label}</h3><p>{assessment.description}</p><div className="mkar-assessment-footer"><span><b>{assessmentCount(assessment.id)} evidence</b> · {assessment.required}</span><div className="mkar-assessment-actions"><button type="button" onClick={() => openEvidenceDialog({ assessmentId: assessment.id })}>Catat <Plus size={11} /></button><button type="button" onClick={() => assessment.agentId === "lapjag" ? onAction({ type: "lapjag" }) : onAction({ type: "agent", agentId: assessment.agentId })}>Mulai <ArrowRight size={13} /></button></div></div></article>)}</div>
      <div className="mkar-exam-note"><FileText size={16} /><div><strong>Exam readiness, bukan prediksi nilai.</strong><p>Koasis akan menilai kesiapan berdasarkan exposure, feedback, latihan, dan data yang kamu masukkan—bukan menggantikan keputusan akademik modul.</p></div></div>
    </section>}

    <footer className="mkar-cockpit-footer"><ShieldCheck size={13} /><span>{MKAR_PROFILE.sourceNote}</span><span className="mkar-footer-separator">·</span><span>Gunakan alias pasien dan jangan kirim identitas langsung.</span></footer>
    <MkarEvidenceDialog open={evidenceDialogOpen} draft={evidenceDraft} error={evidenceError} onChange={updateEvidenceDraft} onClose={() => setEvidenceDialogOpen(false)} onSubmit={saveEvidence} />
  </div>;
}
