import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Check, ChevronRight, FileText, Plus, Settings2, UploadCloud, X } from "lucide-react";
import { KoasisGlyph, type KoasisGlyphName } from "./KoasisGlyph";
import type { KoasisWorkflowKind } from "./KoasisWorkflowDialog";

export type KoasisWorkspace = {
  rotation: string;
  unit: string;
  shift: string;
  goal: string;
  contextFile?: KoasisContextFile;
  notes?: string;
};

export type KoasisContextFileKind = "pdf" | "docx" | "pptx" | "text" | "other";

export type KoasisContextFile = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: KoasisContextFileKind;
  dataUrl?: string;
  storagePath?: string;
};

export type WorkspaceTask = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
};

export type ShiftPhase = "before" | "during" | "after";

type KoasisWorkspacePanelProps = {
  workspace: KoasisWorkspace;
  tasks: WorkspaceTask[];
  onClose: () => void;
  onSaveWorkspace: (workspace: KoasisWorkspace) => void;
  onToggleTask: (taskId: string) => void;
  onAddTask: (label: string) => void;
  onPrompt: (prompt: string) => void;
  activePhase: ShiftPhase;
  onPhaseChange: (phase: ShiftPhase) => void;
  onOpenWorkflow: (kind: KoasisWorkflowKind) => void;
  onOpenCaseBrief: () => void;
};

type WorkflowAction = {
  glyph: KoasisGlyphName;
  label: string;
  detail: string;
  workflow?: KoasisWorkflowKind;
  prompt?: string;
  caseBrief?: boolean;
};

const PHASES: Array<{ id: ShiftPhase; label: string; detail: string }> = [
  { id: "before", label: "Sebelum kerklin & jaga", detail: "Target dan persiapan" },
  { id: "during", label: "Saat kerklin & jaga", detail: "Fakta dan kasus" },
  { id: "after", label: "Setelah kerklin & jaga", detail: "Handover dan belajar" },
];

const CONTEXT_FILE_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown";
const MAX_CONTEXT_FILE_BYTES = 25 * 1024 * 1024;

function fileSizeLabel(bytes: number): string {
  if (!bytes) return "Ukuran tidak tersedia";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function contextFileKind(file: File): KoasisContextFileKind {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
  if (file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || name.endsWith(".pptx")) return "pptx";
  if (file.type.startsWith("text/") || /\.(?:txt|md)$/i.test(name)) return "text";
  return "other";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("File belum bisa dibaca."));
    reader.readAsDataURL(file);
  });
}

function contextFileTypeLabel(file?: KoasisContextFile): string {
  if (!file) return "Belum ada file konteks";
  const type = file.kind === "pdf" ? "PDF" : file.kind === "docx" ? "DOCX" : file.kind === "pptx" ? "PPTX" : file.kind === "text" ? "TXT / MD" : "File";
  return `${type} · ${fileSizeLabel(file.sizeBytes)}`;
}

const ACTIONS: Record<ShiftPhase, WorkflowAction[]> = {
  before: [
    { glyph: "workflow", label: "Siapkan visite", detail: "Prioritas, pertanyaan, follow-up", workflow: "visite" },
    { glyph: "study", label: "Study sprint", detail: "Ubah learning gap jadi sesi fokus", workflow: "study" },
  ],
  during: [
    { glyph: "case", label: "Buat case brief", detail: "Pisahkan fakta dan bagian kosong", caseBrief: true },
    { glyph: "exam", label: "Pemeriksaan & skor", detail: "Teknik dan komponen yang terukur", workflow: "exam" },
    { glyph: "guideline", label: "Cek guideline", detail: "Kriteria, sumber, dan red flags", workflow: "guideline" },
    { glyph: "clinical", label: "Rapikan catatan", detail: "Susun catatan tanpa mengarang data", prompt: "Bantu saya merapikan catatan klinis berikut. Pisahkan fakta terdokumentasi, bagian yang belum ada, pertanyaan klarifikasi, dan next step untuk review. Jangan membuat diagnosis atau terapi final.\n\n" },
  ],
  after: [
    { glyph: "clinical", label: "Handover I-PASS", detail: "Severity, summary, action, contingency, synthesis", workflow: "handover" },
    { glyph: "plan", label: "Debrief jaga", detail: "Temukan learning gap dan next step", prompt: "Bantu saya melakukan debrief setelah jaga. Tanyakan hal yang saya lihat, keputusan yang belum saya pahami, feedback yang saya dapat, risiko yang perlu diverifikasi, dan satu next step belajar.\n\n" },
  ],
};

export function KoasisWorkspacePanel({
  workspace,
  tasks,
  onClose,
  onSaveWorkspace,
  onToggleTask,
  onAddTask,
  onPrompt,
  activePhase,
  onPhaseChange,
  onOpenWorkflow,
  onOpenCaseBrief,
}: KoasisWorkspacePanelProps) {
  const [editing, setEditing] = useState(false);
  const [draftWorkspace, setDraftWorkspace] = useState(workspace);
  const [fileError, setFileError] = useState("");
  const [draggingFile, setDraggingFile] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const completedTasks = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;

  const beginEditing = () => {
    setDraftWorkspace(workspace);
    setFileError("");
    setEditing(true);
  };

  const handleContextFile = async (file: File) => {
    setFileError("");
    if (file.size > MAX_CONTEXT_FILE_BYTES) {
      setFileError("File terlalu besar. Gunakan file maksimal 25 MB.");
      return;
    }
    const kind = contextFileKind(file);
    if (kind === "other") {
      setFileError("Format belum didukung. Gunakan PDF, DOCX, PPTX, TXT, atau MD.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setDraftWorkspace((current) => ({ ...current, contextFile: { name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, kind, dataUrl } }));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "File belum bisa dibaca. Coba pilih file lain.");
    }
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingFile(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleContextFile(file);
  };

  const saveWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const contextFile = draftWorkspace.contextFile;
    const notes = (draftWorkspace.notes || "").trim();
    onSaveWorkspace({
      ...draftWorkspace,
      rotation: contextFile?.name || "Stase belum diatur",
      unit: contextFile ? "Konteks dari modul stase" : "Unit klinis belum diatur",
      shift: contextFile ? "Jadwal mengikuti konteks stase" : "Jadwal belum diatur",
      goal: notes || "Tentukan satu output penting hari ini.",
      notes,
    });
    setEditing(false);
  };

  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = newTask.trim();
    if (!label) return;
    onAddTask(label);
    setNewTask("");
    setAddingTask(false);
  };

  const handleAction = (action: WorkflowAction) => {
    if (action.workflow) onOpenWorkflow(action.workflow);
    else if (action.caseBrief) onOpenCaseBrief();
    else if (action.prompt) onPrompt(action.prompt);
  };

  return (
    <aside className="koasis-workspace-panel" aria-label="Workspace context Koasis">
      <div className="koasis-panel-header"><div><span className="koasis-overline">Workspace context</span><strong>Konteks stase</strong><small>Satu modul untuk menjaga agent tetap berada di jalur rotasimu.</small></div><button type="button" className="koasis-panel-close" onClick={onClose} aria-label="Tutup ruang kerja" title="Tutup ruang kerja"><X size={16} /></button></div>

      {editing ? <form className="koasis-context-editor" onSubmit={saveWorkspace}>
        <div className="koasis-context-intro"><span className="koasis-context-intro-mark"><FileText size={16} /></span><div><strong>Upload modul atau BPKM</strong><p>Gunakan satu file utama sebagai konteks belajar, unit, jadwal, dan target stase.</p></div></div>
        <div className={`koasis-context-dropzone ${draggingFile ? "dragging" : ""} ${draftWorkspace.contextFile ? "has-file" : ""}`} onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDraggingFile(true); }} onDragLeave={() => setDraggingFile(false)} onDrop={handleFileDrop}>
          <input ref={fileInputRef} type="file" accept={CONTEXT_FILE_ACCEPT} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleContextFile(file); event.currentTarget.value = ""; }} />
          {draftWorkspace.contextFile ? <><span className="koasis-context-file-mark"><FileText size={18} /></span><span className="koasis-context-file-copy"><strong>{draftWorkspace.contextFile.name}</strong><small>{contextFileTypeLabel(draftWorkspace.contextFile)}</small></span><button type="button" className="koasis-context-file-change" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>Ganti</button><button type="button" className="koasis-context-file-remove" aria-label="Hapus file konteks" title="Hapus file konteks" onClick={(event) => { event.stopPropagation(); setDraftWorkspace((current) => ({ ...current, contextFile: undefined })); }}><X size={14} /></button></> : <><span className="koasis-context-upload-mark"><UploadCloud size={19} /></span><span className="koasis-context-upload-copy"><strong>Tarik file ke sini</strong><small>PDF, DOCX, PPTX, TXT, atau MD · maks. 25 MB</small><button type="button" className="koasis-context-select" onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>Pilih file</button></span></>}
        </div>
        {fileError && <p className="koasis-context-file-error" role="alert">{fileError}</p>}
        <label className="koasis-context-notes"><span>Catatan tambahan <em>opsional</em></span><textarea value={draftWorkspace.notes || ""} onChange={(event) => setDraftWorkspace((current) => ({ ...current, notes: event.target.value }))} placeholder="Contoh: besok bedside teaching jantung; fokus anamnesis, PF, dan pertanyaan untuk DPJP…" rows={4} /></label>
        <div className="koasis-context-help"><span>Tip</span><p>Catatan ini menjadi arah kerja agent, bukan pengganti SOP atau arahan DPJP.</p></div>
        <div className="koasis-context-editor-actions"><button type="button" className="koasis-button-secondary" onClick={() => setEditing(false)}>Batal</button><button type="submit" className="koasis-button-primary">Simpan konteks</button></div>
      </form> : <>
        <button type="button" className={`koasis-context-card ${workspace.contextFile ? "has-file" : "empty"}`} onClick={beginEditing}>
          <span className="koasis-context-card-mark"><FileText size={17} /></span>
          <span><small>Modul konteks stase</small><strong>{workspace.contextFile?.name || "Belum ada file"}</strong><em>{contextFileTypeLabel(workspace.contextFile)}</em></span>
          <Settings2 size={14} />
        </button>
        {!workspace.contextFile && <button type="button" className="koasis-context-empty-action" onClick={beginEditing}><Plus size={13} /> Tambah file stase</button>}
        {workspace.notes?.trim() && <div className="koasis-focus-card"><span className="koasis-overline">Catatan tambahan</span><p>{workspace.notes}</p></div>}
      </>}

      {!editing && <>
        <div className="koasis-phase-tabs" role="tablist" aria-label="Tahap kerja">
          {PHASES.map((item) => <button type="button" role="tab" aria-selected={activePhase === item.id} className={activePhase === item.id ? "active" : ""} key={item.id} onClick={() => onPhaseChange(item.id)}><strong>{item.label}</strong><small>{item.detail}</small></button>)}
        </div>

        <section className="koasis-panel-section">
          <div className="koasis-section-heading"><div><span className="koasis-overline">Checklist</span><strong>Rencana hari ini</strong></div><span className="koasis-progress-label">{completedTasks}/{tasks.length}</span></div>
          <div className="koasis-progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="koasis-task-list">{tasks.map((task) => <button type="button" className={`koasis-task ${task.done ? "done" : ""}`} key={task.id} onClick={() => onToggleTask(task.id)}><span className="koasis-task-check">{task.done && <Check size={11} />}</span><span><strong>{task.label}</strong><small>{task.detail}</small></span></button>)}</div>
          {addingTask ? <form className="koasis-add-task" onSubmit={addTask}><input autoFocus value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="Tugas baru…" aria-label="Tugas baru" /><button type="submit" aria-label="Simpan tugas"><Check size={14} /></button><button type="button" aria-label="Batal tambah tugas" onClick={() => { setAddingTask(false); setNewTask(""); }}><X size={14} /></button></form> : <button type="button" className="koasis-add-task-trigger" onClick={() => setAddingTask(true)}><Plus size={14} /> Tambah task</button>}
        </section>

        <section className="koasis-panel-section">
          <div className="koasis-section-heading"><div><span className="koasis-overline">Next action</span><strong>{PHASES.find((item) => item.id === activePhase)?.label}</strong></div><small>{ACTIONS[activePhase].length} workflow</small></div>
          <div className="koasis-action-list">{ACTIONS[activePhase].map((action) => <button type="button" key={action.label} onClick={() => handleAction(action)}><span className="koasis-action-mark"><KoasisGlyph name={action.glyph} size={15} /></span><span><strong>{action.label}</strong><small>{action.detail}</small></span><ChevronRight size={14} /></button>)}</div>
        </section>

        <div className="koasis-safety-note"><span className="koasis-safety-mark">K</span><span><strong>Review tetap di tanganmu</strong><small>Gunakan alias pasien. Output AI bukan keputusan klinis.</small></span></div>
      </>}
    </aside>
  );
}
