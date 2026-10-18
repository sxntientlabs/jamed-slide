import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, type UIEvent as ReactUIEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Bell, BookOpen, Check, ChevronDown, Cloud, DoorOpen, ExternalLink, FileText, FolderPlus, GitBranch, GraduationCap, Grid2X2, Link2, LoaderCircle, LogOut, Menu, Monitor, Moon, MoreHorizontal, Network, Paperclip, PanelLeft, Plus, Puzzle, RotateCcw, Search, Shapes, ShieldCheck, SlidersHorizontal, Square, SquarePen, Star, Sun, X } from "lucide-react";
import { useAuth, userInitial } from "./AuthGate";
import { KoasisGlyph, type KoasisGlyphName } from "./KoasisGlyph";
import { KoasisCaseBrief } from "./KoasisCaseBrief";
import { KoasisWorkspacePanel, type KoasisWorkspace, type WorkspaceTask } from "./KoasisWorkspacePanel";
import { KoasisWorkflowDialog, type KoasisWorkflowKind } from "./KoasisWorkflowDialog";
import { MkarRotationCockpit, type MkarCockpitAction } from "./MkarRotationCockpit";
import { KoasisClinicalWorkspace } from "./KoasisClinicalWorkspace";
import { AicssCodeBlock, AicssDataTable, AicssSecureInputDemo, AicssTextResponse, AicssThinkingReasoning, AicssThinkingSurface, KoasisApprovalCard, KoasisAttachmentPreview, KoasisAudioWaves, KoasisCitation, KoasisComparisonTable, KoasisDiffBlock, KoasisImageProcessing, KoasisMessageActions, KoasisReasoningEffort, KoasisRunTrace, KoasisStreamingText, KoasisTodoList, type AicssTableRow, type KoasisRunEvent } from "./AicssAgentSurfaces";
import { AgentChatError, sendAgentChat, type AgentChatAttachment, type AgentChatMessage, type AgentRunStatus } from "../lib/agentChatClient";
import { searchEvidenceSources, type EvidenceSource } from "../lib/evidenceSearchClient";
import { AGENT_DEFINITIONS, AGENT_GROUPS, agentNeedsExternalSource, normalizeAgentId, type AgentDefinition, type AgentGroup, type AgentId } from "../lib/agentCatalog";
import { DEFAULT_KOASIS_MODEL, DEFAULT_KOASIS_REASONING, KOASIS_MODELS, normalizeKoasisModelId, normalizeKoasisReasoning, type KoasisModelDefinition, type KoasisModelId, type KoasisReasoningLevel } from "../lib/koasisModels";
import { downloadKoasisFileDataUrl, loadKoasisSessions, loadKoasisState, saveKoasisSession, saveKoasisState, uploadKoasisAttachment, uploadKoasisFile, type RemoteChatMessage, type RemoteChatSession, type RemoteKoasisState } from "../lib/koasisRemoteStore";
import { detectSensitiveIdentifiers, redactSensitiveIdentifiers, type SensitiveIdentifierFinding } from "../lib/privacyGuard";

type ThemeMode = "light" | "dark";
type SourceMode = "workspace" | "attachments" | "sources";
type ShiftPhase = "before" | "during" | "after";

type AgentPreset = AgentDefinition & {
  glyph: KoasisGlyphName;
};

function KoasisModelSelector({ activeModel, selectedModelId, open, rootRef, onToggle, onSelect }: { activeModel: KoasisModelDefinition; selectedModelId: KoasisModelId; open: boolean; rootRef: RefObject<HTMLDivElement>; onToggle: () => void; onSelect: (modelId: KoasisModelId) => void }) {
  return <div className="koasis-model-selector-wrap" ref={rootRef}>
    <button type="button" className="koasis-thread-title koasis-model-trigger" title="Pilih model" aria-label="Pilih model" aria-expanded={open} aria-haspopup="menu" onClick={onToggle}>
      <span className="koasis-thread-title-mark"><img className="koasis-model-neuron" src="/brand-icons/neuron.svg" alt="" aria-hidden="true" /></span>
      <span className="koasis-model-trigger-copy"><strong>{activeModel.label}</strong><small>{activeModel.tier}</small></span>
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div className="koasis-model-popover koasis-topbar-model-popover" role="menu" aria-label="Pilih model"><div className="koasis-model-popover-head"><span className="koasis-overline">Model Koasis</span><small>Pilih sesuai kebutuhan dan kedalaman kerja.</small></div>{KOASIS_MODELS.map((model) => <button type="button" className={selectedModelId === model.id ? "active" : ""} key={model.id} onClick={() => onSelect(model.id)} role="menuitemradio" aria-checked={selectedModelId === model.id}><span className="koasis-model-popover-mark" aria-hidden="true" /><span><strong>{model.label}</strong><small><b>{model.tier}</b> · {model.description}</small></span></button>)}</div>}
  </div>;
}

type ChatMessage = AgentChatMessage & {
  id: string;
  agentId?: string;
  timestamp: string;
  streaming?: boolean;
  fallback?: boolean;
  error?: boolean;
  retryPrompt?: string;
  action?: "lapjag";
  requestId?: string;
  durationMs?: number;
  sourceMode?: SourceMode;
  reviewRequired?: boolean;
};

type ChatSession = {
  id: string;
  title: string;
  modeId: AgentId;
  updatedAt: number;
  messages: ChatMessage[];
};

const AGENT_GLYPHS: Record<AgentId, KoasisGlyphName> = {
  koasis: "agent",
  study: "study",
  prebrief: "study",
  ward: "workflow",
  case: "case",
  procedure: "plan",
  exam: "exam",
  assessment: "exam",
  guideline: "guideline",
  evidence: "concept",
  presentation: "report",
  messages: "chat",
  lapjag: "report",
};

const AGENT_PRESETS: AgentPreset[] = AGENT_DEFINITIONS.map((agent) => ({ ...agent, glyph: AGENT_GLYPHS[agent.id] }));

function presetsForGroup(group: AgentGroup): AgentPreset[] {
  return AGENT_PRESETS.filter((preset) => preset.group === group);
}

const AGENT_WELCOME: Record<string, string> = {
  koasis: "Halo, aku Koasis Agent. Ceritakan output yang ingin kamu selesaikan hari ini; aku bantu memilih workflow, memecah langkah, dan menjaga konteks kerjamu tetap jelas.",
  study: "Halo, aku Study Desk. Kita bisa mengubah learning gap menjadi sesi recall, latihan klinis, dan exit ticket yang realistis.",
  prebrief: "Halo, aku Clinical Prebrief. Sebelum masuk unit, kita susun fokus anamnesis, pemeriksaan fisik, red flags, dan pertanyaan untuk DPJP.",
  ward: "Halo, aku Ward & Visite. Aku bantu menyiapkan prioritas visite, pertanyaan klarifikasi, handover, dan debrief—tanpa membuat order terapi.",
  case: "Halo, aku Diskusi Kasus. Kita akan memisahkan fakta, interpretasi sementara, data yang hilang, pertanyaan klinis, dan next step review.",
  procedure: "Halo, aku Procedure Coach. Kita latihan persiapan, safety gate, langkah tindakan, stop condition, dan feedback—selalu dengan SOP lokal dan supervisi.",
  exam: "Halo, aku Pemeriksaan Fisik & Skoring. Aku bantu membuat checklist teknik pemeriksaan dan menerapkan scoring rubric yang kamu sebutkan; nilai tetap perlu kamu konfirmasi.",
  assessment: "Halo, aku Assessment Lab. Kita bisa simulasi Mini-CEX, DOPS, OSCE, atau ujian lisan dengan rubric, timebox, feedback, dan retry.",
  guideline: "Halo, aku Guideline Diagnosis. Aku bantu membandingkan kriteria, red flags, dan kebutuhan evidence. Aku tidak akan mengarang guideline atau menutup diagnosis tanpa sumber dan review klinis.",
  evidence: "Halo, aku Evidence Desk. Lampirkan atau sebutkan sumber yang ingin dibandingkan; jika sumber belum tersedia, aku akan menyatakan batasannya dengan jelas.",
  presentation: "Halo, aku Case & Presentation Studio. Kita ubah timeline kasus dan source pack menjadi CBD, makalah, outline PPT, dan latihan tanya jawab.",
  messages: "Halo, aku DPJP Message Desk. Kita buat draft pesan yang ringkas, sopan, alias-only, dan siap kamu review sebelum dikirim.",
  lapjag: "Halo, aku Laporan Jaga. Aku bantu menyiapkan struktur data, review fakta, dan mengarahkanmu ke workspace template PPTX di /lapjag saat dibutuhkan.",
};

const DEFAULT_WORKSPACE: KoasisWorkspace = {
  rotation: "Stase belum diatur",
  unit: "Unit klinis belum diatur",
  shift: "Jadwal belum diatur",
  goal: "Tentukan satu output penting yang ingin selesai hari ini.",
  notes: "",
};

const DEFAULT_TASKS: WorkspaceTask[] = [
  { id: "prepare", label: "Siapkan visite", detail: "Checklist dan pertanyaan pasien", done: false },
  { id: "case", label: "Buat satu case brief", detail: "Gunakan alias, bukan identitas pasien", done: false },
  { id: "debrief", label: "Debrief setelah jaga", detail: "Catat learning gap dan next step", done: false },
];

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  agentId: "koasis",
  role: "assistant",
  content: "Selamat datang di Koasis. Mulai dari satu pekerjaan nyata hari ini—siapkan visite, rapikan kasus, belajar dari learning gap, susun handover, atau lanjutkan laporan jaga. Aku akan bantu memecahnya menjadi output yang bisa kamu review.",
  timestamp: "Sekarang",
};

type HomeAction = {
  id: string;
  glyph: KoasisGlyphName;
  title: string;
  detail: string;
  prompt: string;
};

const HOME_ACTIONS: HomeAction[] = [
  { id: "plan", glyph: "workflow", title: "Plan", detail: "Turn an idea into a clear next step", prompt: "Help me plan this task. First clarify the desired outcome, then break it into the smallest useful steps and identify what you need from me." },
  { id: "research", glyph: "concept", title: "Research", detail: "Find signal and synthesize what matters", prompt: "Help me research this topic. Clarify the question, identify trustworthy sources to check, compare the key findings, and flag uncertainty." },
  { id: "create", glyph: "case", title: "Create", detail: "Shape a rough idea into a polished draft", prompt: "Help me turn this rough idea into a clear draft. Ask only the most important questions, then propose a structure and a first version." },
  { id: "analyze", glyph: "guideline", title: "Analyze", detail: "Organize information and surface the gaps", prompt: "Help me analyze the information I provide. Separate facts from assumptions, surface missing pieces, and recommend the next useful action." },
];

type HomeStudioVisual = "sources" | "apps" | "learn";

const HOME_STUDIO_CARDS: Array<{ id: string; label: string; title: string; detail: string; glyph: KoasisGlyphName; tone: string; visual: HomeStudioVisual; prompt: string }> = [
  { id: "research", label: "Research", title: "Guidelines, papers, and evidence", detail: "Find sources worth reading", glyph: "concept", tone: "blueprint", visual: "sources", prompt: "Help me research this topic with trustworthy medical sources. Clarify the question, identify the best databases and guidelines to check, compare the evidence, and flag uncertainty." },
  { id: "create", label: "Create", title: "Slides, images, and drafts", detail: "Give an idea a clear shape", glyph: "case", tone: "layers", visual: "apps", prompt: "Help me create a polished output from this idea. Propose the structure, ask the key questions, and draft a strong first version." },
  { id: "learn", label: "Learn", title: "Study with a focused assistant", detail: "Bring a question, file, or learning gap", glyph: "chat", tone: "canvas", visual: "learn", prompt: "Help me learn this topic with an active study workflow. Start by clarifying my learning goal, then guide me with explanation, recall questions, and a short exit ticket." },
];

const HOME_RECENT_CARDS: Array<{ id: string; type: string; title: string; detail: string; tone: string; prompt: string }> = [
  { id: "recent-plan", type: "Task", title: "Make a plan from a messy brief", detail: "A clear starting point", tone: "sunset", prompt: "Help me turn this messy brief into a concise plan with a clear outcome and next steps." },
  { id: "recent-research", type: "Research", title: "Compare two approaches", detail: "Trade-offs, evidence, and a recommendation", tone: "dashboard", prompt: "Help me compare two approaches. Build a decision table with benefits, limitations, evidence needed, and a recommendation framework." },
  { id: "recent-draft", type: "Draft", title: "Turn notes into a first draft", detail: "Structure before polish", tone: "paper", prompt: "Help me turn these notes into a structured first draft. Keep unknowns visible and do not invent details." },
];

type ManusPage = "home" | "computers" | "agents" | "library" | "creations" | "automations" | "plugins";

const MANUS_LIBRARY_ITEMS = [
  { title: "Catatan rotasi dan learning gaps", detail: "Koasis workspace", time: "Hari ini", kind: "notes" },
  { title: "Evidence pack — guideline pilihan", detail: "Evidence Desk", time: "Kemarin", kind: "document" },
  { title: "Template presentasi kasus", detail: "Case & Presentation Studio", time: "12 Okt", kind: "slides" },
  { title: "Checklist tindakan terawasi", detail: "Procedure Coach", time: "10 Okt", kind: "document" },
];

const MANUS_PLUGIN_CARDS = [
  { name: "Evidence sources", detail: "Cari sumber, guideline, dan artikel untuk direview.", kind: "evidence" },
  { name: "Clinical calculator", detail: "Jalankan kalkulator dan scoring dengan input terstruktur.", kind: "calculator" },
  { name: "Koasis workspace", detail: "Gunakan konteks stase, task, dan case brief bersama agent.", kind: "workspace" },
  { name: "Document studio", detail: "Ubah catatan menjadi makalah, handover, atau slide.", kind: "document" },
  { name: "Calendar & shifts", detail: "Baca jadwal dan siapkan prebrief sebelum rotasi.", kind: "calendar" },
  { name: "Message desk", detail: "Buat draft pesan DPJP yang ringkas dan siap direview.", kind: "message" },
];

type KoasisSlashCommand = {
  command: string;
  label: string;
  description: string;
  kind: string;
  instruction: string;
};

const KOASIS_SLASH_COMMANDS: readonly KoasisSlashCommand[] = [
  { command: "review", label: "Review", description: "Review konteks dan draft yang sedang aktif", kind: "evidence", instruction: "Gunakan plugin review untuk menilai konteks dan draft aktif. Tunjukkan bagian yang sudah kuat, gap, risiko asumsi, dan next action yang perlu direview manusia." },
  { command: "explain", label: "Explain", description: "Jelaskan topik, file, atau bagian yang dipilih", kind: "document", instruction: "Gunakan plugin explain untuk menjelaskan materi yang relevan secara bertahap, dengan bahasa yang jelas dan tandai bagian yang membutuhkan sumber atau verifikasi." },
  { command: "branch", label: "Branch", description: "Mulai pekerjaan lanjutan yang lebih fokus", kind: "workspace", instruction: "Gunakan plugin branch untuk memecah pekerjaan ini menjadi thread kerja lanjutan yang fokus. Sarankan tujuan, konteks minimum, dan langkah pertama." },
  { command: "improve", label: "Improve", description: "Usulkan perbaikan untuk draft atau rencana", kind: "calculator", instruction: "Gunakan plugin improve untuk mengusulkan perbaikan yang konkret pada draft atau rencana. Prioritaskan kejelasan, kelengkapan, dan hal yang bisa langsung ditindaklanjuti." },
];

type ComposerPalette = "mention" | "command" | null;

type ComposerTrigger = {
  type: Exclude<ComposerPalette, null>;
  query: string;
  start: number;
};

function getComposerTrigger(value: string): ComposerTrigger | null {
  const match = value.match(/(?:^|[\s\n])([@/])([a-zA-Z0-9_-]*)$/);
  if (!match || !match[1]) return null;
  const tokenStart = (match.index ?? 0) + match[0].lastIndexOf(match[1]);
  return { type: match[1] === "@" ? "mention" : "command", query: match[2]?.toLowerCase() || "", start: tokenStart };
}

function resolveSlashCommand(value: string): { command: KoasisSlashCommand; rest: string } | null {
  const match = value.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = KOASIS_SLASH_COMMANDS.find((item) => item.command === match[1]?.toLowerCase());
  return command ? { command, rest: match[2]?.trim() || "" } : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderComposerText(value: string): ReactNode {
  if (!value) return null;
  const mentionLabels = AGENT_PRESETS.map((preset) => `@${preset.label}`).sort((a, b) => b.length - a.length).map(escapeRegExp);
  const commandTokens = KOASIS_SLASH_COMMANDS.map((command) => `/${command.command}`).map(escapeRegExp);
  const tokenPattern = new RegExp(`(${[...mentionLabels, ...commandTokens].join("|")})(?=$|[\\s.,!?;:)\\]}])`, "gi");
  const rendered: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) rendered.push(<span key={`composer-text-${cursor}`}>{value.slice(cursor, start)}</span>);
    rendered.push(<span className="koasis-composer-token" key={`composer-token-${start}`}>{match[0]}</span>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) rendered.push(<span key={`composer-text-${cursor}`}>{value.slice(cursor)}</span>);
  return rendered;
}

const MANUS_COMPUTER_CARDS = [
  { title: "Run clinical workflows", detail: "Keep reports, reminders, and review checklists running around the clock.", tags: ["Koasis", "Workflow"], tone: "workflow" },
  { title: "Study with a private workspace", detail: "Prepare cases, exams, and learning sprints in a focused environment.", tags: ["Private", "Study"], tone: "study" },
  { title: "Build & host your tools", detail: "Turn a useful idea into a small assistant or workflow for your rotation.", tags: ["Build", "Workspace"], tone: "build" },
  { title: "Create a case studio", detail: "Keep a longitudinal case, sources, notes, and presentation in one place.", tags: ["Case", "Studio"], tone: "case" },
  { title: "Use your own files", detail: "Bring de-identified notes and source packs into a reviewable task.", tags: ["Files", "Review"], tone: "files" },
  { title: "Connect your devices", detail: "Continue a task from the devices you use during the day.", tags: ["Mobile", "Desktop"], tone: "devices" },
];

function HomeStudioKicker({ visual, label }: { visual: HomeStudioVisual; label: string }) {
  const icons = visual === "sources"
    ? ["/brand-icons/pubmed.svg", "/brand-icons/scopus.svg", "/brand-icons/cochrane.svg"]
    : visual === "apps"
      ? ["/brand-icons/google-docs.svg", "/brand-icons/google-slides.svg", "/brand-icons/google-sheets.svg"]
      : ["/brand-icons/google-chat.svg"];

  return <span className="koasis-manus-card-kicker">
    <span className={`koasis-studio-kicker-icons ${visual === "learn" ? "single" : ""}`} aria-hidden="true">
      {icons.map((src) => <img key={src} src={src} alt="" />)}
    </span>
    {label}
  </span>;
}

function HomeStudioArt({ visual }: { visual: HomeStudioVisual }) {
  if (visual === "sources") return <span className="koasis-manus-studio-art koasis-manus-studio-art-medical" aria-hidden="true">
    <img src="/brand-icons/syringe-outline.svg" alt="" />
    <img src="/brand-icons/stethoscope-outline.svg" alt="" />
  </span>;
  return <span className="koasis-manus-studio-art" aria-hidden="true"><i /><i /><i /></span>;
}

function ManusPluginIcon({ kind }: { kind: string }) {
  if (kind === "evidence") return <BookOpen size={16} />;
  if (kind === "calculator") return <Shapes size={16} />;
  if (kind === "workspace") return <KoasisGlyph name="agent" size={16} />;
  if (kind === "document") return <FileText size={16} />;
  if (kind === "calendar") return <Monitor size={16} />;
  if (kind === "message") return <GitBranch size={16} />;
  return <Puzzle size={16} />;
}

type AgentStarter = {
  title: string;
  detail: string;
  prompt?: string;
  workflow?: KoasisWorkflowKind;
};

type PendingPrivacyReview = {
  prompt: string;
  attachments: AgentChatAttachment[];
  findings: SensitiveIdentifierFinding[];
};

const AGENT_STARTERS: Record<string, AgentStarter[]> = {
  koasis: [
    { title: "Susun rencana shift", detail: "Ubah pekerjaan hari ini menjadi next action", prompt: "Bantu susun rencana shift hari ini menjadi 3 next action yang realistis." },
    { title: "Rapikan prioritas", detail: "Pisahkan urgent, penting, dan bisa ditunda", prompt: "Bantu aku memilah pekerjaan koas hari ini menjadi urgent, penting, dan bisa ditunda." },
    { title: "Atur konteks stase", detail: "Mulai dari unit, jadwal, dan fokus kerja", prompt: "Bantu aku menentukan konteks stase dan fokus kerja hari ini dengan pertanyaan singkat." },
  ],
  study: [
    { title: "Buat study sprint", detail: "Sesi fokus dengan recall dan exit ticket", prompt: "Buat study sprint 25 menit untuk memahami topik yang akan aku sebutkan." },
    { title: "Uji pemahamanku", detail: "Mulai dari pertanyaan recall klinis", prompt: "Uji pemahamanku dengan 5 pertanyaan recall klinis, satu per satu, tanpa langsung memberi jawaban." },
    { title: "Cari learning gap", detail: "Petakan bagian yang belum kukuasai", prompt: "Bantu petakan learning gap dari kasus atau topik ini, lalu susun urutan belajar yang paling efisien." },
  ],
  prebrief: [
    { title: "Prebrief bedside", detail: "Anamnesis, PF, red flags, pertanyaan DPJP", prompt: "Buat prebrief bedside teaching untuk spesialisasi dan kasus yang akan aku sebutkan." },
    { title: "Siapkan rotasi unit", detail: "Fokus poli, bangsal, IGD, atau perina", prompt: "Bantu aku menyiapkan fokus belajar sebelum masuk unit ini: target, alat, pertanyaan, dan hal yang perlu diverifikasi." },
    { title: "Review sebelum visite", detail: "Ringkas materi yang perlu aktif di kepala", prompt: "Buat checklist review 10 menit sebelum visite berdasarkan konteks rotasiku." },
  ],
  ward: [
    { title: "Siapkan visite", detail: "Prioritas, pertanyaan, dan follow-up", prompt: "Bantu siapkan checklist visite yang ringkas: prioritas, pertanyaan klarifikasi, dan follow-up." },
    { title: "Susun handover", detail: "Gunakan I-PASS yang reviewable", workflow: "handover" },
    { title: "Debrief setelah jaga", detail: "Catat kejadian, learning gap, dan next step", prompt: "Bantu buat format debrief setelah jaga yang memisahkan fakta, refleksi, dan learning gap." },
  ],
  case: [
    { title: "Buat case brief", detail: "Fakta, interpretasi, dan data yang hilang", prompt: "Bantu ubah catatan kasus ini menjadi case brief dengan fakta terdokumentasi, interpretasi sementara, dan data yang hilang." },
    { title: "Susun differential", detail: "Bandingkan hipotesis tanpa mengunci diagnosis", prompt: "Bantu susun differential diagnosis sebagai hipotesis yang perlu diverifikasi, beserta data pendukung dan penyangkal." },
    { title: "Cari pertanyaan penting", detail: "Tentukan informasi berikutnya yang paling bernilai", prompt: "Dari kasus ini, bantu pilih 5 pertanyaan atau data tambahan yang paling penting untuk diklarifikasi." },
  ],
  procedure: [
    { title: "Latihan langkah tindakan", detail: "Persiapan, safety gate, urutan, feedback", prompt: "Latih aku untuk prosedur ini secara interaktif dengan rubric, critical error, dan retry plan." },
    { title: "Siapkan DOPS", detail: "Checklist yang bisa diamati supervisor", prompt: "Buat checklist persiapan DOPS untuk prosedur ini dan pisahkan langkah wajib dari variasi SOP lokal." },
    { title: "Debrief tindakan", detail: "Apa yang dilakukan dan yang perlu diperbaiki", prompt: "Bantu debrief tindakan ini: fakta, teknik yang sudah dilakukan, risiko, feedback, dan next practice." },
  ],
  exam: [
    { title: "Buat checklist pemeriksaan", detail: "Langkah teknik, keselamatan, dan temuan", workflow: "exam" },
    { title: "Terapkan scoring", detail: "Gunakan rubric yang disebutkan dan tandai yang kosong", prompt: "Bantu terapkan scoring system yang akan aku sebutkan. Jangan mengisi nilai yang belum diukur." },
    { title: "Latihan OSCE", detail: "Simulasi instruksi, observasi, dan feedback", prompt: "Simulasikan latihan OSCE untuk pemeriksaan ini: beri instruksi satu tahap, tunggu jawabanku, lalu beri feedback." },
  ],
  assessment: [
    { title: "Simulasi Mini-CEX", detail: "Anamnesis, PF, reasoning, feedback", prompt: "Mulai simulasi Mini-CEX interaktif dengan timebox dan rubric; beri satu instruksi dulu." },
    { title: "Simulasi DOPS", detail: "Tindakan langsung dengan critical error", prompt: "Mulai simulasi DOPS untuk prosedur yang akan aku sebutkan dengan checklist dan critical error." },
    { title: "Latihan ujian lisan", detail: "Jawab, review, ulangi", prompt: "Buat sesi ujian lisan klinis satu pertanyaan per giliran dengan feedback setelah jawabanku." },
  ],
  guideline: [
    { title: "Bandingkan kriteria", detail: "Kriteria, red flags, dan batas evidence", workflow: "guideline" },
    { title: "Cari red flags", detail: "Susun tanda bahaya yang perlu diverifikasi", prompt: "Bantu susun daftar red flags dan data yang perlu segera diverifikasi untuk keluhan ini." },
    { title: "Siapkan pertanyaan guideline", detail: "Buat query yang siap dicari di sumber resmi", prompt: "Bantu ubah pertanyaan klinisku menjadi query pencarian guideline yang spesifik dan dapat diverifikasi." },
  ],
  evidence: [
    { title: "Review sumber", detail: "PICO, klaim utama, dan keterbatasan", workflow: "evidence" },
    { title: "Bandingkan dua sumber", detail: "Tunjukkan persamaan dan perbedaan evidence", prompt: "Bantu bandingkan dua sumber ini dengan tabel klaim, populasi, hasil, dan keterbatasan." },
    { title: "Buat evidence brief", detail: "Ringkas evidence tanpa citation palsu", prompt: "Buat evidence brief dari sumber yang tersedia dan tandai bagian yang belum bisa disimpulkan." },
  ],
  presentation: [
    { title: "Bangun case presentation", detail: "Timeline, problem representation, slide", prompt: "Bantu susun outline presentasi kasus dari catatan ini, pisahkan fakta, interpretasi, dan data yang hilang." },
    { title: "Rancang makalah", detail: "Struktur dan source pack", prompt: "Bantu rancang struktur makalah kasus dengan source pack yang dapat diverifikasi." },
    { title: "Latihan tanya jawab", detail: "Antisipasi pertanyaan diskusi", prompt: "Simulasikan pertanyaan penguji untuk presentasi kasus ini satu per satu." },
  ],
  messages: [
    { title: "Minta feedback", detail: "Draft sopan dan langsung ke tujuan", prompt: "Buat draft chat ke DPJP untuk meminta feedback atas kegiatan hari ini." },
    { title: "Laporkan pasien baru", detail: "Konteks ringkas dan permintaan jelas", prompt: "Buat draft chat laporan pasien baru berdasarkan alias dan fakta yang akan aku isi." },
    { title: "Konfirmasi presentasi", detail: "Deadline dan kesiapan bahan", prompt: "Buat draft chat untuk mengonfirmasi jadwal dan bahan presentasi kasus ke DPJP." },
  ],
  lapjag: [
    { title: "Review data laporan", detail: "Cek kelengkapan dan bagian yang kosong", prompt: "Bantu review data laporan jaga ini: pisahkan fakta, data kosong, dan bagian yang perlu dikonfirmasi." },
    { title: "Susun alur laporan", detail: "Siapkan struktur sebelum masuk template", prompt: "Bantu susun struktur laporan jaga yang dapat diaudit tanpa mengarang data pasien." },
    { title: "Siapkan output PPTX", detail: "Tentukan data yang perlu disiapkan", prompt: "Bantu buat checklist persiapan sebelum aku melanjutkan laporan jaga ke output PPTX." },
  ],
};

function KoasisMark({ className = "" }: { className?: string }) {
  return <img className={`koasis-mark ${className}`.trim()} src="/koasis-favicon.png" alt="" aria-hidden="true" />;
}

function currentTime(): string {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function newSession(id = `chat-${Date.now()}`): ChatSession {
  return { id, title: "Percakapan baru", modeId: "koasis", updatedAt: Date.now(), messages: [{ ...INITIAL_MESSAGE, id: `welcome-${id}` }] };
}

function toRemoteMessage(message: ChatMessage): RemoteChatMessage {
  const remote: RemoteChatMessage = {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  };
  if (message.agentId !== undefined) remote.agentId = message.agentId;
  if (message.fallback !== undefined) remote.fallback = message.fallback;
  if (message.error !== undefined) remote.error = message.error;
  if (message.retryPrompt !== undefined) remote.retryPrompt = message.retryPrompt;
  if (message.action !== undefined) remote.action = message.action;
  if (message.requestId !== undefined) remote.requestId = message.requestId;
  if (message.durationMs !== undefined) remote.durationMs = message.durationMs;
  if (message.sourceMode !== undefined) remote.sourceMode = message.sourceMode;
  if (message.reviewRequired !== undefined) remote.reviewRequired = message.reviewRequired;
  const attachments = message.attachments?.map(({ name, mimeType, kind, storagePath }) => ({
    name,
    mimeType,
    kind,
    ...(storagePath !== undefined ? { storagePath } : {}),
  }));
  if (attachments?.length) remote.attachments = attachments;
  return remote;
}

function toRemoteSession(session: ChatSession): RemoteChatSession {
  return {
    id: session.id,
    title: session.title,
    modeId: session.modeId,
    updatedAt: session.updatedAt,
    messages: session.messages.filter((message) => !message.streaming).slice(-40).map(toRemoteMessage),
  };
}

function fromRemoteSession(session: RemoteChatSession): ChatSession {
  return {
    id: session.id,
    title: session.title,
    modeId: normalizeAgentId(session.modeId),
    updatedAt: session.updatedAt || Date.now(),
    messages: session.messages.map((message) => ({ ...message })),
  };
}

function toRemoteState(workspace: KoasisWorkspace, tasks: WorkspaceTask[], preferences: RemoteKoasisState["preferences"]): RemoteKoasisState {
  const remoteWorkspace: RemoteKoasisState["workspace"] = {
    rotation: workspace.rotation,
    unit: workspace.unit,
    shift: workspace.shift,
    goal: workspace.goal,
    notes: workspace.notes || "",
  };
  if (workspace.contextFile) {
    remoteWorkspace.contextFile = {
      name: workspace.contextFile.name,
      mimeType: workspace.contextFile.mimeType,
      sizeBytes: workspace.contextFile.sizeBytes,
      kind: workspace.contextFile.kind,
      ...(workspace.contextFile.storagePath !== undefined ? { storagePath: workspace.contextFile.storagePath } : {}),
    };
  }
  return {
    schemaVersion: 1,
    workspace: remoteWorkspace,
    tasks: tasks.slice(0, 100),
    preferences,
  };
}

function fromRemoteState(state: RemoteKoasisState): { workspace: KoasisWorkspace; tasks: WorkspaceTask[] } {
  return {
    workspace: {
      rotation: typeof state.workspace.rotation === "string" ? state.workspace.rotation : DEFAULT_WORKSPACE.rotation,
      unit: typeof state.workspace.unit === "string" ? state.workspace.unit : DEFAULT_WORKSPACE.unit,
      shift: typeof state.workspace.shift === "string" ? state.workspace.shift : DEFAULT_WORKSPACE.shift,
      goal: typeof state.workspace.goal === "string" ? state.workspace.goal : DEFAULT_WORKSPACE.goal,
      notes: typeof state.workspace.notes === "string" ? state.workspace.notes : "",
      contextFile: state.workspace.contextFile ? {
        name: state.workspace.contextFile.name,
        mimeType: state.workspace.contextFile.mimeType,
        sizeBytes: state.workspace.contextFile.sizeBytes,
        kind: state.workspace.contextFile.kind,
        storagePath: state.workspace.contextFile.storagePath,
      } : undefined,
    },
    tasks: state.tasks.map((task) => ({ id: task.id, label: task.label, detail: task.detail, done: task.done })),
  };
}

function attachmentKind(file: File): AgentChatAttachment["kind"] | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("audio/")) return "audio";
  return undefined;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File tidak bisa dibaca."));
    reader.onerror = () => reject(reader.error ?? new Error("File tidak bisa dibaca."));
    reader.readAsDataURL(file);
  });
}

function fallbackReply(prompt: string): string {
  const normalized = prompt.toLowerCase();
  if (/laporan|jaga|template|pptx/.test(normalized)) return "Agent sedang tidak tersambung, tetapi workflow Laporan Jaga tetap bisa dibuka dari menu kiri. Untuk jawaban AI, coba kirim ulang saat koneksi backend tersedia.";
  if (/belajar|konsep|ujian|study/.test(normalized)) return "Agent sedang tidak tersambung. Simpan dulu target belajarmu; setelah koneksi kembali, Koasis akan menyusun recall, latihan klinis, dan exit ticket tanpa mengarang sumber.";
  if (/visite|pasien|kasus|catatan|handover/.test(normalized)) return "Agent sedang tidak tersambung. Catatanmu belum diproses. Jangan gunakan draft offline sebagai keputusan klinis; coba kirim ulang setelah koneksi kembali.";
  return "Agent sedang tidak tersambung. Draft ini belum diproses dan belum boleh dianggap sebagai output klinis. Coba lagi sebentar.";
}

function renderInlineText(value: string, keyPrefix: string): ReactNode {
  const chunks = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g).filter((chunk) => chunk !== "");
  return chunks.map((chunk, index) => {
    if (chunk.startsWith("**") && chunk.endsWith("**")) return <strong key={`${keyPrefix}-strong-${index}`}>{chunk.slice(2, -2)}</strong>;
    if (chunk.startsWith("`") && chunk.endsWith("`")) return <code key={`${keyPrefix}-code-${index}`}>{chunk.slice(1, -1)}</code>;
    if (/^\[\d+\]$/.test(chunk)) return <KoasisCitation key={`${keyPrefix}-citation-${index}`} number={chunk.slice(1, -1)} />;
    return <span key={`${keyPrefix}-text-${index}`}>{chunk}</span>;
  });
}

function pipeCells(line: string): string[] {
  const value = line.trim();
  if (!value.includes("|")) return [];
  return value.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isPipeDivider(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function RichAgentText({ content, enhanced = false }: { content: string; enhanced?: boolean }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<span className="koasis-rich-break" key={`break-${index}`} />);
      continue;
    }
    if (/^```/.test(trimmed)) {
      const lang = trimmed.replace(/^```/, "").trim() || "text";
      const codeLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) {
        codeLines.push(lines[cursor]);
        cursor += 1;
      }
      blocks.push(/^(diff|patch)$/i.test(lang) ? <KoasisDiffBlock key={`diff-${index}`} code={codeLines.join("\n")} /> : <AicssCodeBlock key={`code-${index}`} lang={lang} code={codeLines.join("\n")} />);
      index = cursor < lines.length ? cursor : lines.length;
      continue;
    }
    const headerCells = pipeCells(trimmed);
    const dividerCells = index + 1 < lines.length ? pipeCells(lines[index + 1]) : [];
    if (headerCells.length >= 2 && isPipeDivider(dividerCells)) {
      const rows: string[][] = [];
      let cursor = index + 2;
      while (cursor < lines.length) {
        const cells = pipeCells(lines[cursor]);
        if (cells.length !== headerCells.length) break;
        rows.push(cells);
        cursor += 1;
      }
      if (rows.length) {
        if (headerCells.length === 3 && /model/i.test(headerCells[0]) && /context/i.test(headerCells[1]) && /price/i.test(headerCells[2])) {
          const modelRows: AicssTableRow[] = rows.map((row) => ({ model: row[0], context: row[1], price: row[2] }));
          blocks.push(<AicssDataTable key={`table-${index}`} rows={modelRows} />);
        } else {
          blocks.push(<KoasisComparisonTable key={`comparison-${index}`} headers={headerCells} rows={rows} />);
        }
      }
      index = cursor - 1;
      continue;
    }
    if (/^#{1,3}\s/.test(trimmed)) {
      blocks.push(<h3 key={index}>{renderInlineText(trimmed.replace(/^#{1,3}\s/, ""), `heading-${index}`)}</h3>);
      continue;
    }
    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      const items: Array<{ label: string; done: boolean }> = [];
      let cursor = index;
      while (cursor < lines.length) {
        const todoLine = lines[cursor].trim();
        const match = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(todoLine);
        if (!match) break;
        items.push({ done: match[1].toLowerCase() === "x", label: match[2] });
        cursor += 1;
      }
      blocks.push(<KoasisTodoList key={`todo-${index}`} items={items} />);
      index = cursor - 1;
      continue;
    }
    if (/^[-*]\s/.test(trimmed)) {
      blocks.push(<div className="koasis-rich-bullet" key={index}><i />{renderInlineText(trimmed.replace(/^[-*]\s/, ""), `bullet-${index}`)}</div>);
      continue;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      blocks.push(<div className="koasis-rich-number" key={index}><strong>{trimmed.match(/^\d+/)?.[0]}</strong><span>{renderInlineText(trimmed.replace(/^\d+\.\s/, ""), `number-${index}`)}</span></div>);
      continue;
    }
    blocks.push(<p key={index}>{renderInlineText(line, `paragraph-${index}`)}</p>);
  }
  const body = <div className="koasis-rich-text">{blocks}</div>;
  return enhanced ? <AicssTextResponse>{body}</AicssTextResponse> : body;
}

function MessageBubble({ message, userLabel, onRetry, onAction }: { message: ChatMessage; userLabel: string; onRetry: (message: ChatMessage) => void; onAction: (action: "lapjag") => void }) {
  const assistant = message.role === "assistant";
  const messageAgent = AGENT_PRESETS.find((preset) => preset.id === message.agentId)?.label || "Koasis Agent";
  return <article className={`koasis-message ${assistant ? "assistant" : "user"}`}>
    <div className={`koasis-message-avatar ${assistant ? "assistant" : "user"}`} aria-hidden="true">{assistant ? <KoasisMark className="koasis-message-mark" /> : <span>U</span>}</div>
    <div className="koasis-message-body">
      <div className="koasis-message-meta"><strong>{assistant ? messageAgent : userLabel}</strong><span>{message.timestamp}</span>{message.fallback && <span className="koasis-message-badge warning">Mode offline</span>}{assistant && message.reviewRequired && <span className="koasis-message-badge review">Review wajib</span>}{assistant && message.sourceMode && <span className="koasis-message-badge neutral">{message.sourceMode === "attachments" ? "Attachment context" : message.sourceMode === "sources" ? "Evidence context" : "Workspace context"}</span>}{assistant && message.durationMs && <span title={message.requestId ? `Request ${message.requestId}` : undefined}>{(message.durationMs / 1_000).toFixed(1)} dtk</span>}</div>
      <div className={`koasis-message-text ${message.streaming ? "streaming" : ""}`}>{message.streaming ? <KoasisStreamingText active text={message.content} /> : <RichAgentText content={message.content} enhanced={assistant} />}</div>
      {message.attachments?.map((attachment) => <div className="koasis-message-attachment" key={`${message.id}-${attachment.name}`}><Paperclip size={12} />{attachment.name}</div>)}
      {message.error && <div className="koasis-message-error"><span>Belum terkirim ke agent. Periksa koneksi atau coba lagi.</span>{message.retryPrompt && <button type="button" onClick={() => onRetry(message)}><RotateCcw size={12} /> Coba lagi</button>}</div>}
      {assistant && !message.streaming && !message.error && <KoasisMessageActions text={message.content} />}
      {assistant && message.action === "lapjag" && <button type="button" className="koasis-inline-action" onClick={() => onAction("lapjag")}>Buka Laporan Jaga <ArrowRight size={14} /></button>}
    </div>
  </article>;
}

function AgentThinking({ label, status, events }: { label: string; status: AgentRunStatus | null; events: KoasisRunEvent[] }) {
  const reasoningSentences = useMemo(() => [
    `${label} membaca permintaan dan konteks kerja yang sedang aktif.`,
    "Memisahkan tujuan, fakta yang tersedia, dan informasi yang masih belum ada.",
    status?.message || "Menentukan struktur jawaban yang paling berguna untuk pekerjaan ini.",
    "Mengecek batasan privasi, sumber, dan asumsi sebelum melanjutkan.",
    "Menyusun output yang bisa kamu review sebelum dipakai.",
    "Menandai ketidakpastian dan langkah berikutnya jika masih ada gap.",
  ], [label, status?.message]);
  return <div className="koasis-agent-thinking-stack"><AicssThinkingSurface label={label} detail={status?.message || "Memulai workflow yang aman dan bisa direview…"} /><AicssThinkingReasoning sentences={reasoningSentences} /><KoasisRunTrace events={events} activePhase={status?.phase} /></div>;
}

function HomeSurface({ workspace, tasks, onAction, onOpenWorkspace }: { workspace: KoasisWorkspace; tasks: WorkspaceTask[]; onAction: (action: HomeAction) => void; onOpenWorkspace: () => void }) {
  const completed = tasks.filter((task) => task.done).length;
  return <div className="koasis-home-surface koasis-manus-home">
    <section className="koasis-manus-home-hero">
      <div className="koasis-manus-home-lockup"><img src="/koasis-wordmark.png" alt="Koasis" /></div>
      <h1>What can I help you make?</h1>
      <p>Koasis is an agentic workspace for turning ideas, information, and unfinished work into something useful.</p>
    </section>

    <section className="koasis-manus-studio-grid" aria-label="Start with a capability">
      {HOME_STUDIO_CARDS.map((card) => <button type="button" className={`koasis-manus-studio-card ${card.tone}`} key={card.id} onClick={() => onAction({ id: card.id, glyph: card.glyph, title: card.title, detail: card.detail, prompt: card.prompt })}>
        <span className="koasis-manus-studio-copy"><HomeStudioKicker visual={card.visual} label={card.label} /><strong>{card.title}<ArrowRight size={14} /></strong><small>{card.detail}</small></span>
        <HomeStudioArt visual={card.visual} />
      </button>)}
    </section>

    <div className="koasis-manus-context-row"><span><i />Local workspace</span><span>{completed}/{tasks.length} task selesai</span><button type="button" onClick={onOpenWorkspace}>Atur konteks</button></div>

    <section className="koasis-manus-recent" aria-label="Ideas to start">
      <div className="koasis-manus-section-heading"><span>Ideas to start</span><small>Or bring your own task below</small></div>
      <div className="koasis-manus-recent-grid">{HOME_RECENT_CARDS.map((card) => <button type="button" className={`koasis-manus-recent-card ${card.tone}`} key={card.id} onClick={() => onAction({ id: card.id, glyph: "agent", title: card.title, detail: card.detail, prompt: card.prompt })}><span className="koasis-manus-recent-art" aria-hidden="true"><i /><i /><i /></span><span className="koasis-manus-recent-meta"><small>{card.type}</small><strong>{card.title}</strong><em>{card.detail}</em></span></button>)}</div>
    </section>
  </div>;
}

function ManusPageSurface({ page, onStartTask }: { page: Exclude<ManusPage, "home">; onStartTask: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");

  if (page === "agents") {
    return <section className="manus-page manus-agents-page">
      <div className="manus-agents-hero-mark"><KoasisGlyph name="agent" size={34} /></div>
      <h1>Meet Koasis Specialist Agents</h1>
      <p>Your agent workspace is moving beyond one chat. Choose a specialist, build a focused workflow, and keep the right context with you from task to task.</p>
      <div className="manus-agents-preview" aria-label="Preview of Koasis agent teams"><div className="manus-agents-preview-phone"><i /><i /><i /><i /></div><div className="manus-agents-preview-panel"><span /><span /><span /><strong>Koasis agent workspace</strong><small>Specialists working together</small></div><span className="manus-agents-preview-orb" /></div>
      <div className="manus-agents-actions"><button type="button" className="manus-button-secondary" disabled>Coming soon</button><button type="button" className="manus-button-primary" onClick={onStartTask}>Start a task</button></div>
      <div className="manus-agents-note">Specialist agents for prebrief, case discussion, procedures, evidence, exams, and more.</div>
    </section>;
  }

  if (page === "library") {
    const items = MANUS_LIBRARY_ITEMS.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
    const filters = ["All", "Text & PDF", "Slides", "Spreadsheets", "Images", "Others"];
    return <section className="manus-page manus-library-page">
      <div className="manus-page-heading"><h1>Library</h1><div className="manus-page-heading-actions"><label className="manus-search-field"><Search size={15} /><input aria-label="Search files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" /></label><button type="button" className="manus-icon-button" aria-label="Filter files"><SlidersHorizontal size={15} /></button><button type="button" className="manus-icon-button" aria-label="Change library view"><MoreHorizontal size={16} /></button></div></div>
      <div className="manus-filter-tabs">{filters.map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="manus-list-heading"><span>October 2026</span><small>{items.length} items</small></div>
      <div className="manus-library-list">{items.map((item) => <button type="button" className="manus-library-row" key={item.title} onClick={onStartTask}><span className={`manus-file-icon ${item.kind}`}><FileText size={17} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time><MoreHorizontal size={16} /></button>)}{!items.length && <div className="manus-empty-state"><FileText size={28} /><strong>No files found</strong><small>Try a different search or bring a file into a new task.</small></div>}</div>
    </section>;
  }

  if (page === "creations") {
    const filters = ["All", "Websites", "Games", "Mobile apps"];
    return <section className="manus-page manus-creations-page">
      <div className="manus-page-heading"><h1>Creations</h1><div className="manus-page-heading-actions"><label className="manus-search-field"><Search size={15} /><input aria-label="Search creations" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search creations" /></label><button type="button" className="manus-icon-button" aria-label="Favorite creations"><Star size={16} /></button></div></div>
      <div className="manus-filter-tabs">{filters.map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="manus-empty-state manus-creation-empty"><div className="manus-empty-document"><FileText size={27} /></div><strong>No creations yet</strong><small>Build a website, app, or workspace from a task.</small><button type="button" className="manus-button-primary" onClick={onStartTask}>Build now</button></div>
    </section>;
  }

  if (page === "plugins") {
    const filters = ["All", "Clinical", "Productivity", "Documents", "Development"];
    const plugins = MANUS_PLUGIN_CARDS.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
    return <section className="manus-page manus-plugins-page">
      <div className="manus-page-heading"><h1>Plugins &amp; Clinical Tools</h1><div className="manus-page-heading-actions"><button type="button" className="manus-button-secondary">Manage Connectors</button><button type="button" className="manus-button-primary">Create <ChevronDown size={14} /></button></div></div>
      <div className="manus-plugin-featured"><div><span className="manus-plugin-badge evidence"><BookOpen size={16} /></span><strong>Evidence sources</strong><small>Bring trustworthy clinical sources into a task.</small></div><div><span className="manus-plugin-badge workspace"><Shapes size={16} /></span><strong>Koasis workspace</strong><small>Keep your context and outputs together.</small></div><div><span className="manus-plugin-badge document"><FileText size={16} /></span><strong>Document studio</strong><small>Turn notes into a reviewable artifact.</small></div></div>
      <label className="manus-search-field manus-plugin-search"><Search size={15} /><input aria-label="Search plugins" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" /></label>
      <div className="manus-filter-tabs">{filters.map((item) => <button type="button" className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <div className="manus-plugin-grid">{plugins.map((plugin) => <button type="button" className="manus-plugin-card" key={plugin.name} onClick={onStartTask}><span className={`manus-plugin-badge ${plugin.kind}`}><ManusPluginIcon kind={plugin.kind} /></span><span><strong>{plugin.name}</strong><small>{plugin.detail}</small></span><span className="manus-plugin-add">+</span></button>)}</div>
    </section>;
  }

  if (page === "computers") {
    return <section className="manus-page manus-computers-page">
      <div className="manus-page-heading"><h1>Computers</h1><button type="button" className="manus-button-secondary" onClick={onStartTask}><Plus size={15} /> Create workspace</button></div>
      <h2>Find the perfect setup for you</h2>
      <div className="manus-computer-grid">{MANUS_COMPUTER_CARDS.map((card) => <button type="button" className={`manus-computer-card ${card.tone}`} key={card.title} onClick={onStartTask}><div className="manus-computer-art"><span /><span /><span /></div><div className="manus-computer-copy"><strong>{card.title}</strong><small>{card.detail}</small><span>{card.tags.map((tag) => <em key={tag}>{tag}</em>)}</span></div></button>)}</div>
      <section className="manus-secure-input-section"><div><span className="manus-section-kicker">Agent control</span><h2>Secure input</h2><p>Credentials are collected in a dedicated surface before a connected computer can use them.</p></div><AicssSecureInputDemo /></section>
      <div className="manus-computers-footer"><span>Connect your devices</span><button type="button" className="manus-button-secondary" onClick={onStartTask}><Monitor size={15} /> Connect new device</button><button type="button" className="manus-button-secondary" onClick={onStartTask}><Bell size={15} /> Notifications</button></div>
    </section>;
  }

  if (page === "automations") {
    return <section className="manus-page manus-automations-page">
      <div className="manus-page-heading"><h1>Automations</h1><button type="button" className="manus-button-primary" onClick={onStartTask}><Plus size={15} /> Create automation</button></div>
      <div className="manus-automation-intro"><GitBranch size={24} /><div><strong>Scheduled tasks stay out of your head.</strong><small>Create a repeatable workflow for reminders, study sprints, or review queues.</small></div></div>
      <div className="manus-empty-state"><GitBranch size={28} /><strong>No automations yet</strong><small>Start from a task and decide when it should run.</small><button type="button" className="manus-button-primary" onClick={onStartTask}>Create your first automation</button></div>
    </section>;
  }

  return null;
}

function AgentStartSurface({ preset, onPrompt, onWorkflow }: { preset: AgentPreset; onPrompt: (prompt: string) => void; onWorkflow: (workflow: KoasisWorkflowKind) => void }) {
  const starters = AGENT_STARTERS[preset.id] || AGENT_STARTERS.koasis;
  return <section className="koasis-agent-start" aria-label={`Mulai dengan ${preset.label}`}>
    <div className="koasis-agent-start-heading"><div><span className="koasis-overline">Mulai dari sini</span><h2>Pilih titik awal yang paling dekat.</h2></div><span>{starters.length} cara mulai</span></div>
    <div className="koasis-agent-start-grid">{starters.map((starter) => <button type="button" className="koasis-agent-start-card" key={starter.title} onClick={() => starter.workflow ? onWorkflow(starter.workflow) : starter.prompt && onPrompt(starter.prompt)}><span><strong>{starter.title}</strong><small>{starter.detail}</small></span><ArrowRight size={14} /></button>)}</div>
  </section>;
}

function AgentContractBar({ preset, sourceMode }: { preset: AgentPreset; sourceMode: SourceMode }) {
  const missingRequiredSource = agentNeedsExternalSource(preset.id) && sourceMode !== "attachments" && sourceMode !== "sources";
  const sourceLabel = sourceMode === "sources" ? "Hasil pencarian · verifikasi manual" : preset.sourceLabel;
  return <div className={`koasis-agent-contract ${missingRequiredSource ? "needs-source" : ""}`} aria-label="Kontrak specialist agent">
    <span><ShieldCheck size={13} /><strong>{preset.riskLabel}</strong></span>
    <span><i />{missingRequiredSource ? "Sumber belum tersedia" : sourceLabel}</span>
    <span><Check size={12} />Output draft untuk direview</span>
  </div>;
}

function evidenceSourceReference(source: EvidenceSource): string {
  const identifier = source.doi ? `DOI:${source.doi}` : source.pmid ? `PMID:${source.pmid}` : source.pmcid ? `PMCID:${source.pmcid}` : source.id;
  return `${source.source.toUpperCase()}:${identifier}`;
}

function evidenceProviderLabel(provider: string): string {
  if (provider === "europepmc") return "Europe PMC";
  if (provider === "pubmed") return "PubMed";
  if (provider === "openalex") return "OpenAlex";
  if (provider === "crossref") return "Crossref";
  return provider;
}

function EvidenceSourceSearchPanel({
  query,
  onQueryChange,
  onSubmit,
  busy,
  error,
  results,
  onUseSource,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string;
  results: EvidenceSource[];
  onUseSource: (source: EvidenceSource) => void;
}) {
  return <section className="koasis-evidence-search" aria-label="Cari sumber evidence">
    <div className="koasis-evidence-search-heading">
      <div className="koasis-evidence-search-title"><span className="koasis-evidence-source-mark"><BookOpen size={14} /></span><div><span className="koasis-overline">Evidence desk</span><strong>Cari sumber publik</strong></div></div>
      <span className="koasis-evidence-provider">Federated search</span>
    </div>
    <p className="koasis-evidence-search-copy">Cari guideline, systematic review, atau studi. Hasil hanya metadata/abstract dan tetap harus diverifikasi di sumber asli.</p>
    <form className="koasis-evidence-search-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <Search size={14} aria-hidden="true" />
      <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Contoh: asthma exacerbation guideline" aria-label="Query sumber evidence" maxLength={240} />
      <button type="submit" aria-label="Cari sumber" disabled={busy || query.trim().length < 3}>{busy ? <LoaderCircle size={14} className="koasis-spinner" /> : <ArrowRight size={14} />}</button>
    </form>
    {error && <div className="koasis-evidence-search-error" role="alert">{error}</div>}
    {results.length > 0 && <div className="koasis-evidence-results">
      <div className="koasis-evidence-results-head"><span>Hasil teratas</span><small>{results.length} kandidat · buka sumber sebelum dipakai</small></div>
      {results.map((source) => <article className="koasis-evidence-result" key={evidenceSourceReference(source)}>
        <div className="koasis-evidence-result-top"><div><strong>{source.title}</strong><small>{[source.journal, source.year].filter(Boolean).join(" · ") || "Metadata jurnal belum tersedia"}</small></div><a href={source.url} target="_blank" rel="noreferrer" aria-label={`Buka sumber ${source.title}`} title="Buka sumber asli"><ExternalLink size={13} /></a></div>
        <div className="koasis-evidence-result-meta"><span>{source.authors || "Penulis belum tersedia"}</span><span>{(source.sourceIds || [source.source]).map(evidenceProviderLabel).join(" + ")}</span>{source.doi && <span>DOI {source.doi}</span>}</div>
        {source.abstract && <p>{source.abstract}</p>}
        <div className="koasis-evidence-result-footer"><span className="koasis-evidence-result-id">{evidenceSourceReference(source)}</span>{source.isOpenAccess && <span className="koasis-evidence-open">Open access</span>}{source.retractionStatus === "retracted" && <span className="koasis-evidence-warning">Retraction terdeteksi</span>}{source.retractionStatus === "corrected" && <span className="koasis-evidence-warning">Correction terdeteksi</span>}{typeof source.citedByCount === "number" && <span>{source.citedByCount.toLocaleString("id-ID")} sitasi</span>}<button type="button" onClick={() => onUseSource(source)}><Link2 size={12} />Tambahkan ke konteks</button></div>
      </article>)}
    </div>}
  </section>;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function AgenticChat() {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>(() => [newSession("chat-welcome")]);
  const [activeSessionId, setActiveSessionId] = useState("chat-welcome");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [{ ...INITIAL_MESSAGE }]);
  const [chatTitle, setChatTitle] = useState("Percakapan baru");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AgentChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [agentLibraryOpen, setAgentLibraryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<AgentId>("koasis");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [composerPalette, setComposerPalette] = useState<ComposerPalette>(null);
  const [composerPaletteIndex, setComposerPaletteIndex] = useState(0);
  const [manusPage, setManusPage] = useState<ManusPage>("home");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [showHome, setShowHome] = useState(true);
  const [homeSurface, setHomeSurface] = useState<"chat" | "ops" | "curriculum">("chat");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [selectedModelId, setSelectedModelId] = useState<KoasisModelId>(DEFAULT_KOASIS_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState<KoasisReasoningLevel>(DEFAULT_KOASIS_REASONING);
  const [workspace, setWorkspace] = useState<KoasisWorkspace>(DEFAULT_WORKSPACE);
  const [workspaceTasks, setWorkspaceTasks] = useState<WorkspaceTask[]>(DEFAULT_TASKS);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [shiftPhase, setShiftPhase] = useState<ShiftPhase>("before");
  const [sourceMode, setSourceMode] = useState<SourceMode>("workspace");
  const [caseBriefOpen, setCaseBriefOpen] = useState(false);
  const [workflowKind, setWorkflowKind] = useState<KoasisWorkflowKind | null>(null);
  const [listening, setListening] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [runStatus, setRunStatus] = useState<AgentRunStatus | null>(null);
  const [runTrail, setRunTrail] = useState<KoasisRunEvent[]>([]);
  const [privacyReview, setPrivacyReview] = useState<PendingPrivacyReview | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [evidenceResults, setEvidenceResults] = useState<EvidenceSource[]>([]);
  const [evidenceSearchBusy, setEvidenceSearchBusy] = useState(false);
  const [evidenceSearchError, setEvidenceSearchError] = useState("");
  const [remoteHydrated, setRemoteHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followScrollRef = useRef(true);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerMirrorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const remoteHydratedRef = useRef(false);
  const remoteLoadSucceededRef = useRef(false);

  const accountLabel = user.displayName?.trim() || user.email?.split("@")[0] || "Pengguna";
  const activePreset = AGENT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? AGENT_PRESETS[0];
  const activeModel = KOASIS_MODELS.find((model) => model.id === selectedModelId) ?? KOASIS_MODELS[1];
  const composerTrigger = getComposerTrigger(draft);
  const mentionQuery = composerTrigger?.type === "mention" ? composerTrigger.query : "";
  const commandQuery = composerTrigger?.type === "command" ? composerTrigger.query : "";
  const mentionOptions = AGENT_PRESETS.filter((preset) => `${preset.label} ${preset.shortDescription}`.toLowerCase().includes(mentionQuery)).slice(0, 8);
  const commandOptions = KOASIS_SLASH_COMMANDS.filter((command) => `${command.command} ${command.label} ${command.description}`.toLowerCase().includes(commandQuery)).slice(0, 8);
  const trackRunStatus = (next: AgentRunStatus) => {
    setRunStatus(next);
    setRunTrail((current) => [...current.filter((event) => event.phase !== next.phase), { phase: next.phase, message: next.message }]);
  };
  const filteredSessions = useMemo(() => sessions.filter((session) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const agentLabel = AGENT_PRESETS.find((preset) => preset.id === normalizeAgentId(session.modeId))?.label || "Koasis Agent";
    return `${session.title} ${agentLabel}`.toLowerCase().includes(query);
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20), [searchQuery, sessions]);

  useEffect(() => {
    document.body.classList.add("koasis-agent-body");
    return () => document.body.classList.remove("koasis-agent-body");
  }, []);

  useEffect(() => {
    let disposed = false;
    remoteHydratedRef.current = false;
    remoteLoadSucceededRef.current = false;
    setRemoteHydrated(false);
    void Promise.all([loadKoasisState(user.uid), loadKoasisSessions(user.uid)])
      .then(([remoteState, remoteSessions]) => {
        if (disposed) return;
        remoteLoadSucceededRef.current = true;
        if (remoteState) {
          const restored = fromRemoteState(remoteState);
          setWorkspace(restored.workspace);
          setWorkspaceTasks(restored.tasks.length ? restored.tasks : DEFAULT_TASKS);
          setThemeMode(remoteState.preferences.themeMode);
          setSelectedModelId(normalizeKoasisModelId(remoteState.preferences.modelId));
          setReasoningEffort(normalizeKoasisReasoning(remoteState.preferences.reasoningEffort));
          setWorkspacePanelOpen(Boolean(remoteState.preferences.workspacePanelOpen));
          if (remoteState.preferences.shiftPhase) setShiftPhase(remoteState.preferences.shiftPhase);
        }
        if (remoteSessions.length) {
          const restoredSessions = remoteSessions.map(fromRemoteSession);
          const firstSession = restoredSessions[0];
          setSessions(restoredSessions);
          setActiveSessionId(firstSession.id);
          setMessages(firstSession.messages);
          setChatTitle(firstSession.title);
          setSelectedPresetId(normalizeAgentId(firstSession.modeId));
        }
      })
      .catch((error) => {
        console.warn("Koasis remote state belum dapat dimuat; sesi ini tetap berjalan di memory.", error);
      })
      .finally(() => {
        if (!disposed) {
          remoteHydratedRef.current = true;
          setRemoteHydrated(true);
        }
      });
    return () => {
      disposed = true;
      remoteHydratedRef.current = false;
      remoteLoadSucceededRef.current = false;
    };
  }, [user.uid]);

  useEffect(() => {
    setSessions((current) => current.map((session) => session.id === activeSessionId ? { ...session, title: chatTitle, modeId: selectedPresetId, updatedAt: Date.now(), messages: messages.slice(-40) } : session));
  }, [activeSessionId, chatTitle, messages, selectedPresetId]);

  useEffect(() => {
    if (!remoteHydrated || !remoteHydratedRef.current || !remoteLoadSucceededRef.current) return;
    const timer = window.setTimeout(() => {
      void saveKoasisState(user.uid, toRemoteState(workspace, workspaceTasks, {
        themeMode,
        modelId: selectedModelId,
        reasoningEffort,
        workspacePanelOpen,
        shiftPhase,
      })).catch((error) => console.warn("Koasis workspace belum tersimpan ke Firestore.", error));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [reasoningEffort, remoteHydrated, selectedModelId, shiftPhase, themeMode, user.uid, workspace, workspacePanelOpen, workspaceTasks]);

  useEffect(() => {
    if (!remoteHydrated || !remoteHydratedRef.current || !remoteLoadSucceededRef.current) return;
    const timer = window.setTimeout(() => {
      void Promise.all(sessions.slice(0, 30).map((session) => saveKoasisSession(user.uid, toRemoteSession(session))))
        .catch((error) => console.warn("Riwayat chat Koasis belum tersimpan ke Firestore.", error));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [remoteHydrated, sessions, user.uid]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || showHome || !followScrollRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: streamingMessageId ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streamingMessageId, busy, showHome]);

  useEffect(() => {
    if (!showHome) return;
    followScrollRef.current = true;
    setShowJumpToLatest(false);
    const frame = window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0, behavior: "auto" }));
    return () => window.cancelAnimationFrame(frame);
  }, [showHome]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 126)}px`;
  }, [draft]);

  useEffect(() => {
    if (!toolsOpen && !modelMenuOpen && !engineMenuOpen && !composerPalette) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (composerWrapRef.current?.contains(target) || modelSelectorRef.current?.contains(target))) return;
      setToolsOpen(false);
      setModelMenuOpen(false);
      setEngineMenuOpen(false);
      setComposerPalette(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [composerPalette, engineMenuOpen, modelMenuOpen, toolsOpen]);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        startNewChat();
      }
      if (event.key === "Escape") {
        setModelMenuOpen(false);
        setEngineMenuOpen(false);
        setToolsOpen(false);
        setComposerPalette(null);
        setMobileSidebarOpen(false);
        setWorkflowKind(null);
        setCaseBriefOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const openLegacyWorkspace = () => window.location.assign("/lapjag");
  const toggleTheme = () => setThemeMode((current) => current === "dark" ? "light" : "dark");
  const toggleWorkspacePanel = () => setWorkspacePanelOpen((current) => !current);
  const openManusPage = (page: Exclude<ManusPage, "home">) => {
    requestControllerRef.current?.abort();
    setManusPage(page);
    setShowHome(true);
    setMoreMenuOpen(false);
    setAgentLibraryOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setToolsOpen(false);
    setWorkflowKind(null);
    setCaseBriefOpen(false);
    setWorkspacePanelOpen(false);
    setMobileSidebarOpen(false);
  };
  const returnToManusHome = () => {
    setManusPage("home");
    openHomeSurface("chat");
  };
  const openHomeSurface = (surface: "chat" | "ops" | "curriculum") => {
    setManusPage("home");
    setShowHome(true);
    setHomeSurface(surface);
    setSelectedPresetId("koasis");
    setSourceMode("workspace");
    setAgentLibraryOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setToolsOpen(false);
    setMoreMenuOpen(false);
    setMobileSidebarOpen(false);
  };

  const handleEvidenceSearch = async () => {
    const query = evidenceQuery.trim();
    if (query.length < 3 || evidenceSearchBusy) return;
    const findings = detectSensitiveIdentifiers(query);
    if (findings.length) {
      setEvidenceSearchError("Query tidak boleh memuat identitas langsung atau data pasien. Gunakan istilah klinis yang dianonimkan.");
      return;
    }
    setEvidenceSearchBusy(true);
    setEvidenceSearchError("");
    try {
      const authToken = await user.getIdToken();
      const response = await searchEvidenceSources(query, { authToken, limit: 5 });
      setEvidenceResults(response.results);
      const failedProviders = response.providers?.filter((provider) => provider.status === "error") || [];
      if (failedProviders.length) {
        setEvidenceSearchError(`Hasil parsial: ${failedProviders.map((provider) => evidenceProviderLabel(provider.provider)).join(", ")} tidak merespons. Sumber yang tampil tetap perlu diverifikasi manual.`);
      } else if (!response.results.length) {
        setEvidenceSearchError("Belum ada hasil yang cukup relevan. Coba ubah istilah atau tambahkan populasi/intervensi.");
      }
    } catch (error) {
      setEvidenceSearchError(error instanceof Error ? error.message : "Pencarian sumber gagal. Coba lagi.");
    } finally {
      setEvidenceSearchBusy(false);
    }
  };

  const addEvidenceSourceToContext = (source: EvidenceSource) => {
    const reference = evidenceSourceReference(source);
    const contextBlock = [
      `[${reference}] Kandidat sumber dari federated evidence search — verifikasi manual sebelum dipakai untuk keputusan klinis.`,
      `Judul: ${source.title}`,
      `Jurnal/tahun: ${[source.journal, source.year].filter(Boolean).join(" · ") || "Tidak tercantum"}`,
      source.authors ? `Penulis: ${source.authors}` : "",
      source.sourceIds?.length ? `Provider metadata: ${source.sourceIds.map(evidenceProviderLabel).join(", ")}` : `Provider metadata: ${evidenceProviderLabel(source.source)}`,
      source.doi ? `DOI: ${source.doi}` : "",
      source.pmid ? `PMID: ${source.pmid}` : "",
      source.pmcid ? `PMCID: ${source.pmcid}` : "",
      source.publicationTypes?.length ? `Tipe publikasi: ${source.publicationTypes.join(", ")}` : "",
      source.retractionStatus === "retracted" ? "Integrity warning: provider metadata menandai kemungkinan retraction; jangan gunakan sebagai evidence valid tanpa pemeriksaan sumber asli." : "",
      source.abstract ? `Abstract (potongan): ${source.abstract.slice(0, 900)}` : "Metadata tersedia; abstract tidak tersedia pada hasil ini.",
      `Sumber asli: ${source.url}`,
      source.fullTextUrl ? `Tautan full text/provider: ${source.fullTextUrl}` : "",
    ].filter(Boolean).join("\n");
    setDraft((current) => `${current}${current.trim() ? "\n\n" : ""}${contextBlock}`);
    setSourceMode("sources");
    setToolsOpen(false);
    setEvidenceSearchError("");
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleConversationScroll = () => {
    const container = scrollRef.current;
    if (!container || showHome) return;
    const distanceFromLatest = container.scrollHeight - container.scrollTop - container.clientHeight;
    const atLatest = distanceFromLatest <= 72;
    followScrollRef.current = atLatest;
    setShowJumpToLatest(!atLatest && container.scrollHeight > container.clientHeight + 24);
  };

  const jumpToLatest = () => {
    const container = scrollRef.current;
    if (!container) return;
    followScrollRef.current = true;
    setShowJumpToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  };

  const startNewChat = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    followScrollRef.current = true;
    setShowJumpToLatest(false);
    const next = newSession();
    setSessions((current) => [next, ...current.filter((session) => session.id !== next.id)].slice(0, 30));
    setActiveSessionId(next.id);
    setMessages(next.messages);
    setChatTitle(next.title);
    setSelectedPresetId("koasis");
    setDraft("");
    setAttachments([]);
    setAttachmentError("");
    setComposerPalette(null);
    setSourceMode("workspace");
    setBusy(false);
    setStreamingMessageId(null);
    setRunStatus(null);
    setRunTrail([]);
    setPrivacyReview(null);
    setWorkflowKind(null);
    setCaseBriefOpen(false);
    setEvidenceQuery("");
    setEvidenceResults([]);
    setEvidenceSearchError("");
    setShowHome(true);
    setManusPage("home");
    setHomeSurface("chat");
    setAgentLibraryOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setToolsOpen(false);
    setComposerPalette(null);
    setMoreMenuOpen(false);
    setMobileSidebarOpen(false);
  };

  const openSession = (session: ChatSession) => {
    requestControllerRef.current?.abort();
    followScrollRef.current = true;
    setShowJumpToLatest(false);
    setActiveSessionId(session.id);
    setMessages(session.messages);
    setChatTitle(session.title);
    setSelectedPresetId(normalizeAgentId(session.modeId));
    setDraft("");
    setAttachments([]);
    setAttachmentError("");
    setShowHome(false);
    setManusPage("home");
    setSourceMode("workspace");
    setMobileSidebarOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setToolsOpen(false);
    setComposerPalette(null);
    setBusy(false);
    setRunStatus(null);
    setRunTrail([]);
    setPrivacyReview(null);
    setWorkflowKind(null);
    setCaseBriefOpen(false);
    setEvidenceQuery("");
    setEvidenceResults([]);
    setEvidenceSearchError("");
  };

  const selectAgent = (preset: AgentPreset) => {
    setSelectedPresetId(preset.id);
    setManusPage("home");
    setAgentLibraryOpen(false);
    setMessages((current) => current.length === 1 && current[0]?.role === "assistant"
      ? [{ ...current[0], id: `welcome-${preset.id}`, agentId: preset.id, content: AGENT_WELCOME[preset.id] || AGENT_WELCOME.koasis }
      ]
      : current);
    setShowHome(false);
    setMobileSidebarOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setToolsOpen(false);
    setComposerPalette(null);
    setRunStatus(null);
    setRunTrail([]);
    setWorkflowKind(null);
    setCaseBriefOpen(false);
  };

  const toggleWorkspaceTask = (taskId: string) => setWorkspaceTasks((current) => current.map((task) => task.id === taskId ? { ...task, done: !task.done } : task));
  const addWorkspaceTask = (label: string) => setWorkspaceTasks((current) => [...current, { id: `task-${Date.now()}`, label, detail: "Task pribadi dari workspace", done: false }]);
  const saveWorkspace = (nextWorkspace: KoasisWorkspace) => {
    void (async () => {
      const contextFile = nextWorkspace.contextFile;
      if (contextFile?.dataUrl && !contextFile.storagePath) {
        try {
          const stored = await uploadKoasisFile(user.uid, {
            name: contextFile.name,
            mimeType: contextFile.mimeType,
            dataUrl: contextFile.dataUrl,
          }, "context");
          if (stored) {
            nextWorkspace = {
              ...nextWorkspace,
              contextFile: { ...contextFile, storagePath: stored.storagePath, dataUrl: undefined },
            };
          }
        } catch (error) {
          console.warn("Modul konteks belum berhasil diunggah ke Firebase Storage; file hanya tersedia selama sesi ini.", error);
        }
      }
      setWorkspace(nextWorkspace);
    })();
  };
  const openWorkflow = (kind: KoasisWorkflowKind) => {
    const agentForWorkflow: Record<KoasisWorkflowKind, AgentId> = { visite: "ward", study: "study", handover: "ward", exam: "exam", guideline: "guideline", evidence: "evidence" };
    setSelectedPresetId(agentForWorkflow[kind] || "koasis");
    setSourceMode("workspace");
    setShowHome(false);
    setManusPage("home");
    setCaseBriefOpen(false);
    setWorkflowKind(kind);
    setToolsOpen(false);
    setModelMenuOpen(false);
    setEngineMenuOpen(false);
    setMobileSidebarOpen(false);
  };

  const selectModel = (modelId: KoasisModelId) => {
    setSelectedModelId(modelId);
    setEngineMenuOpen(false);
    setToolsOpen(false);
  };
  const toggleModelMenu = () => {
    setEngineMenuOpen((current) => !current);
    setModelMenuOpen(false);
    setToolsOpen(false);
  };

  const updateAssistant = (assistantId: string, content: string, streaming: boolean, options?: { agentId?: AgentId; fallback?: boolean; error?: boolean; retryPrompt?: string; action?: "lapjag"; requestId?: string; durationMs?: number; sourceMode?: SourceMode; reviewRequired?: boolean }) => {
    setMessages((current) => {
      const nextMessage: ChatMessage = { id: assistantId, agentId: options?.agentId || activePreset.id, role: "assistant", content, timestamp: current.find((message) => message.id === assistantId)?.timestamp || currentTime(), streaming, ...options };
      const existingIndex = current.findIndex((message) => message.id === assistantId);
      if (existingIndex < 0) return [...current, nextMessage];
      const next = [...current];
      next[existingIndex] = nextMessage;
      return next;
    });
  };

  const submitPrompt = (rawPrompt: string, attached: AgentChatAttachment[] = attachments, skipPrivacyReview = false) => {
    const workspaceFile = workspace.contextFile;
    const workspaceAttachment: AgentChatAttachment | null = sourceMode === "workspace" && workspaceFile && workspaceFile.kind === "pdf" && (workspaceFile.dataUrl || workspaceFile.storagePath)
      ? { name: workspaceFile.name, mimeType: workspaceFile.mimeType, kind: "pdf", dataUrl: workspaceFile.dataUrl, ...(workspaceFile.storagePath ? { storagePath: workspaceFile.storagePath } : {}) }
      : null;
    const messageAttachments = [...attached, workspaceAttachment].filter((item, index, items): item is AgentChatAttachment => Boolean(item) && items.findIndex((candidate) => candidate?.name === item?.name && candidate?.dataUrl === item?.dataUrl) === index);
    const attachmentSummary = messageAttachments.map((item) => item.name).join(", ");
    const prompt = rawPrompt.trim() || (attachmentSummary ? `Baca dan rangkum attachment ${attachmentSummary}.` : "");
    if (!prompt || busy) return;
    const slashCommand = resolveSlashCommand(prompt);
    const requestPrompt = slashCommand
      ? `${slashCommand.command.instruction}\n\n${slashCommand.rest ? `Permintaan pengguna:\n${slashCommand.rest}` : "Terapkan command ini pada konteks kerja yang sedang aktif."}`
      : prompt;
    if (!skipPrivacyReview) {
      const findings = detectSensitiveIdentifiers(prompt);
      if (findings.length) {
        setPrivacyReview({ prompt, attachments: messageAttachments, findings });
        setModelMenuOpen(false);
        setEngineMenuOpen(false);
        setToolsOpen(false);
        setComposerPalette(null);
        return;
      }
    }
    followScrollRef.current = true;
    setShowJumpToLatest(false);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: prompt, attachments: messageAttachments.length ? messageAttachments : undefined, timestamp: currentTime() };
    setMessages((current) => [...current, userMessage]);
    setChatTitle(prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt);
    setShowHome(false);
    setManusPage("home");
    setDraft("");
    setAttachments([]);
    setAttachmentError("");
    setToolsOpen(false);
    setEngineMenuOpen(false);
    setComposerPalette(null);
    setBusy(true);
    trackRunStatus({ phase: "accepted", message: "Menyiapkan permintaan" });
    const preset = activePreset;
    const assistantId = `assistant-${Date.now()}`;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    let streamedContent = "";
    const action: ChatMessage["action"] = /laporan|jaga|template|pptx/i.test(prompt) ? "lapjag" : undefined;
    const requestUserMessage = requestPrompt === prompt ? userMessage : { ...userMessage, content: requestPrompt };

    void (async () => {
      try {
        const authToken = await user.getIdToken();
        const hydratedRequestAttachments = requestUserMessage.attachments?.length
          ? await Promise.all(requestUserMessage.attachments.map(async (attachment) => {
            if (attachment.dataUrl || !attachment.storagePath) return attachment;
            try {
              return { ...attachment, dataUrl: await downloadKoasisFileDataUrl(attachment.storagePath) };
            } catch (error) {
              console.warn(`Attachment ${attachment.name} belum dapat diunduh dari Firebase Storage.`, error);
              return attachment;
            }
          }))
          : undefined;
        const outgoingRequestUserMessage = hydratedRequestAttachments ? { ...requestUserMessage, attachments: hydratedRequestAttachments } : requestUserMessage;
        const response = await sendAgentChat(
          [...messages, outgoingRequestUserMessage].map(({ role, content, attachments }) => ({ role, content, attachments })),
          preset.id,
          {
            signal: controller.signal,
            authToken,
            context: {
              rotation: workspace.rotation,
              unit: workspace.unit,
              shift: workspace.shift,
              goal: workspace.notes?.trim() || workspace.goal,
              notes: workspace.notes,
              contextFileName: workspace.contextFile?.name,
              contextFileType: workspace.contextFile?.mimeType,
              activeTasks: workspaceTasks.filter((task) => !task.done).map((task) => task.label),
              phase: shiftPhase,
              sourceMode,
              sessionTitle: chatTitle,
              modelId: selectedModelId,
              reasoningEffort,
            },
            onDelta: (content) => {
              streamedContent = content;
              setStreamingMessageId(assistantId);
              updateAssistant(assistantId, content, true, { agentId: preset.id, action });
            },
            onStatus: trackRunStatus,
          },
        );
        updateAssistant(assistantId, response.content, false, { agentId: preset.id, action, requestId: response.requestId, durationMs: response.durationMs, sourceMode, reviewRequired: response.reviewRequired });
      } catch (error) {
        if (controller.signal.aborted) return;
        const privacyBlocked = error instanceof AgentChatError && error.code === "privacy_review_required";
        if (privacyBlocked) {
          setPrivacyReview({ prompt, attachments: messageAttachments, findings: detectSensitiveIdentifiers(prompt) });
          updateAssistant(assistantId, "Permintaan dihentikan sebelum diproses karena terdeteksi identitas langsung. Anonimkan data lalu kirim ulang.", false, { agentId: preset.id, error: true, retryPrompt: prompt, action });
        } else if (streamedContent.trim()) updateAssistant(assistantId, `${streamedContent.trimEnd()}\n\nRespons terputus sebelum selesai. Coba kirim ulang bila jawaban belum lengkap.`, false, { agentId: preset.id, error: true, retryPrompt: prompt, action });
        else updateAssistant(assistantId, fallbackReply(prompt), false, { agentId: preset.id, fallback: true, error: true, retryPrompt: prompt, action });
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setBusy(false);
          setStreamingMessageId(null);
          setRunStatus(null);
          setRunTrail([]);
        }
      }
    })();
  };

  const handleRetry = (message: ChatMessage) => {
    if (message.retryPrompt) submitPrompt(message.retryPrompt, message.attachments || []);
  };

  const handleAction = (action: "lapjag") => {
    if (action === "lapjag") openLegacyWorkspace();
  };

  const chooseComposerOption = (optionIndex = composerPaletteIndex) => {
    const trigger = getComposerTrigger(draft);
    if (!trigger) {
      setComposerPalette(null);
      return;
    }
    if (trigger.type === "mention") {
      const preset = mentionOptions[optionIndex];
      if (!preset) return;
      setSelectedPresetId(preset.id);
      setManusPage("home");
      setAgentLibraryOpen(false);
      setModelMenuOpen(false);
      setEngineMenuOpen(false);
      setToolsOpen(false);
      const nextDraft = `${draft.slice(0, trigger.start)}@${preset.label} ${draft.slice(draft.length)}`;
      setDraft(nextDraft);
      setComposerPalette(null);
      setComposerPaletteIndex(0);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    const command = commandOptions[optionIndex];
    if (!command) return;
    const nextDraft = `${draft.slice(0, trigger.start)}/${command.command} ${draft.slice(draft.length)}`;
    setDraft(nextDraft);
    setComposerPalette(null);
    setComposerPaletteIndex(0);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt(draft, attachments);
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const paletteOptionsLength = composerPalette === "mention" ? mentionOptions.length : commandOptions.length;
    if (composerPalette && paletteOptionsLength > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setComposerPaletteIndex((current) => (current + 1) % paletteOptionsLength);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setComposerPaletteIndex((current) => (current - 1 + paletteOptionsLength) % paletteOptionsLength);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setComposerPalette(null);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chooseComposerOption();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPrompt(draft, attachments);
    }
  };

  const handleComposerScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    if (!composerMirrorRef.current) return;
    composerMirrorRef.current.scrollTop = event.currentTarget.scrollTop;
    composerMirrorRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    event.currentTarget.value = "";
    setAttachmentError("");
    const nextAttachments: AgentChatAttachment[] = [];
    const textParts: string[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        errors.push(`${file.name}: file terlalu besar (batas 8 MB).`);
        continue;
      }
      if (file.type.startsWith("text/") || /\.(?:txt|csv|tsv)$/i.test(file.name)) {
        try {
          textParts.push(await file.text());
        } catch {
          errors.push(`${file.name}: file teks belum bisa dibaca.`);
        }
        continue;
      }
      const kind = attachmentKind(file);
      if (!kind) {
        errors.push(`${file.name}: gunakan TXT, CSV, TSV, PDF, gambar, atau audio.`);
        continue;
      }
      try {
        const attachment: AgentChatAttachment = { name: file.name, mimeType: file.type || `${kind}/*`, kind, dataUrl: await readFileAsDataUrl(file) };
        try {
          const stored = await uploadKoasisAttachment(user.uid, attachment);
          nextAttachments.push(stored ? { ...attachment, storagePath: stored.storagePath } : attachment);
        } catch {
          nextAttachments.push(attachment);
          errors.push(`${file.name}: upload Firebase Storage gagal; file hanya tersedia selama sesi ini.`);
        }
      } catch {
        errors.push(`${file.name}: attachment belum bisa dibaca.`);
      }
    }
    const availableSlots = Math.max(0, 4 - attachments.length);
    if (nextAttachments.length > availableSlots) errors.push("Maksimal 4 attachment aktif dalam satu pesan.");
    if (textParts.length) {
      setDraft((current) => `${current}${current.trim() ? "\n\n" : ""}${textParts.join("\n\n")}`);
      setSourceMode("attachments");
    }
    if (nextAttachments.length && availableSlots > 0) {
      setAttachments((current) => [...current, ...nextAttachments].filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name && candidate.dataUrl === item.dataUrl) === index).slice(0, 4));
      setSourceMode("attachments");
    }
    if (errors.length) setAttachmentError(errors[0]);
  };

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const speechApi = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Constructor = speechApi.SpeechRecognition || speechApi.webkitSpeechRecognition;
    if (!Constructor) {
      setAttachmentError("Voice input tidak tersedia di browser ini. Kamu bisa tetap mengetik atau melampirkan audio.");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = "id-ID";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript || "").join(" ").trim();
      if (transcript) setDraft((current) => `${current}${current.trim() ? " " : ""}${transcript}`);
    };
    recognition.onerror = () => { setAttachmentError("Voice input gagal menangkap suara. Coba lagi atau ketik manual."); setListening(false); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setAttachmentError("");
    setListening(true);
    recognition.start();
  };

  const handleHomeAction = (action: HomeAction) => {
    setSelectedPresetId("koasis");
    setSourceMode("workspace");
    setManusPage("home");
    setShowHome(false);
    setWorkflowKind(null);
    setCaseBriefOpen(false);
    submitPrompt(action.prompt, []);
  };

  const handleMkarAction = (action: MkarCockpitAction) => {
    if (action.type === "workspace") {
      setWorkspacePanelOpen(true);
      return;
    }
    if (action.type === "case") {
      setSelectedPresetId("case");
      setSourceMode("workspace");
      setShowHome(false);
      setWorkflowKind(null);
      setCaseBriefOpen(true);
      return;
    }
    if (action.type === "lapjag") {
      openLegacyWorkspace();
      return;
    }
    if (action.type === "workflow") {
      openWorkflow(action.kind);
      return;
    }
    const preset = AGENT_PRESETS.find((item) => item.id === action.agentId);
    if (preset) selectAgent(preset);
  };

  const movePrivacyReviewToComposer = () => {
    if (!privacyReview) return;
    setDraft(redactSensitiveIdentifiers(privacyReview.prompt));
    setAttachments(privacyReview.attachments);
    setSourceMode(privacyReview.attachments.length ? "attachments" : sourceMode);
    setPrivacyReview(null);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const manusPageTitle: Record<Exclude<ManusPage, "home">, string> = { computers: "Computers", agents: "Specialist Agents", library: "Library", creations: "Creations", automations: "Automations", plugins: "Plugins & Clinical Tools" };

  return <div data-theme={themeMode} className={`agentic-shell koasis-shell manus-shell theme-${themeMode} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${workspacePanelOpen ? "workspace-panel-open" : "workspace-panel-closed"}`}>
    {mobileSidebarOpen && <button type="button" className="agentic-sidebar-scrim" aria-label="Tutup sidebar" onClick={() => setMobileSidebarOpen(false)} />}
    <aside className={`agentic-sidebar koasis-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}>
      <div className="agentic-sidebar-top koasis-sidebar-top"><button type="button" className={`agentic-sidebar-brand koasis-sidebar-brand ${sidebarCollapsed ? "collapsed-toggle" : ""}`} aria-label={sidebarCollapsed ? "Buka sidebar" : "Koasis"} title={sidebarCollapsed ? "Buka sidebar" : undefined} onClick={() => { if (sidebarCollapsed) setSidebarCollapsed(false); }}><KoasisMark className="agentic-sidebar-mark" /><div className="koasis-sidebar-wordmark"><img src="/koasis-wordmark.png" alt="Koasis — Your Clinical Oasis" /></div></button><div className="manus-sidebar-top-actions"><button type="button" className="manus-sidebar-search-trigger" aria-label="Search" title="Search" onClick={() => setSidebarSearchOpen((current) => !current)}><Search size={16} /><kbd>⌘ K</kbd></button><button type="button" className="agentic-sidebar-collapse koasis-sidebar-collapse" aria-label="Ciutkan sidebar" title="Ciutkan sidebar" aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}><PanelLeft size={17} /></button></div></div>
      <button type="button" className={`agentic-new-chat koasis-new-chat ${manusPage === "home" && showHome ? "active" : ""}`} onClick={startNewChat} title="New task"><SquarePen size={16} /><span>New task</span></button>
      {sidebarSearchOpen && <div className="manus-sidebar-search-field"><Search size={14} /><input autoFocus aria-label="Search tasks" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search tasks" /></div>}

      <div className="koasis-sidebar-scroll manus-sidebar-nav">
        <button type="button" className={`manus-nav-item ${manusPage === "computers" ? "active" : ""}`} onClick={() => openManusPage("computers")}><Monitor size={16} /><span>Computers</span></button>
        <button type="button" className={`manus-nav-item ${manusPage === "agents" ? "active" : ""}`} onClick={() => openManusPage("agents")}><KoasisGlyph name="agent" size={19} /><span>Specialist Agents</span><em>Asistole!</em></button>
        <button type="button" className={`manus-nav-item ${manusPage === "library" ? "active" : ""}`} onClick={() => openManusPage("library")}><BookOpen size={16} /><span>Library</span></button>
        <button type="button" className={`manus-nav-item ${manusPage === "creations" ? "active" : ""}`} onClick={() => openManusPage("creations")}><Shapes size={16} /><span>Creations</span></button>
        <button type="button" className={`manus-nav-item ${manusPage === "automations" ? "active" : ""}`} onClick={() => openManusPage("automations")}><GitBranch size={16} /><span>Automations</span></button>
        <button type="button" className={`manus-nav-item ${manusPage === "plugins" ? "active" : ""}`} onClick={() => openManusPage("plugins")}><Grid2X2 size={16} /><span>Plugins &amp; Clinical Tools</span></button>
        <div className="manus-more-wrap"><button type="button" className={`manus-nav-item ${moreMenuOpen ? "active" : ""}`} onClick={() => setMoreMenuOpen((current) => !current)}><MoreHorizontal size={17} /><span>More</span></button>{moreMenuOpen && <div className="manus-more-menu"><button type="button" onClick={() => setMoreMenuOpen(false)}><DoorOpen size={14} /> Ruang Koas</button><button type="button" onClick={() => openManusPage("agents")}><GraduationCap size={14} /> Skills</button><button type="button" onClick={() => { setManusPage("home"); setMoreMenuOpen(false); }}><SlidersHorizontal size={14} /> Personalization</button></div>}</div>

        <div className="manus-sidebar-divider" />
        <div className="manus-sidebar-section-title">Projects</div>
        <button type="button" className="manus-nav-item" onClick={() => openHomeSurface("ops")}><FolderPlus size={16} /><span>New project</span></button>
        <div className="manus-sidebar-divider" />
        <div className="manus-sidebar-section-title">Tasks</div>
        <div className="koasis-chat-list manus-task-list">{filteredSessions.filter((session) => session.title !== "Percakapan baru").map((session) => <button type="button" title={session.title} className={`koasis-chat-row ${session.id === activeSessionId && manusPage === "home" && !showHome ? "active" : ""}`} key={session.id} onClick={() => openSession(session)}><span className="koasis-chat-row-mark" /><span><strong>{session.title}</strong><small>{AGENT_PRESETS.find((preset) => preset.id === normalizeAgentId(session.modeId))?.label || "Koasis Agent"} · {new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" }).format(new Date(session.updatedAt))}</small></span></button>)}{!filteredSessions.filter((session) => session.title !== "Percakapan baru").length && <div className="koasis-empty-chat">Belum ada task.</div>}</div>
      </div>

      <div className="koasis-sidebar-bottom manus-sidebar-bottom"><div className="manus-notification-card"><Bell size={16} /><p>Receive a browser notification and sound when tasks complete.</p><div><button type="button">Not now</button><button type="button" className="manus-button-primary">Turn on</button></div></div><div className="agentic-user-card koasis-user-card"><div className="agentic-user-avatar">{userInitial(user)}</div><div><strong>{accountLabel}</strong><span>{user.email || "Akun Firebase"}</span></div><button type="button" className="manus-user-icon" aria-label="Perangkat" title="Perangkat"><Monitor size={15} /></button><button type="button" className="manus-user-icon" aria-label="Notifikasi" title="Notifikasi"><Bell size={15} /></button><button type="button" className="agentic-user-action" aria-label="Keluar" title="Keluar" onClick={() => { void signOut(); }}><LogOut size={15} /></button></div></div>
    </aside>

    <main className="agentic-main koasis-main">
      <header className={`agentic-topbar koasis-topbar ${manusPage !== "home" ? "manus-page-topbar" : ""}`}><div className="agentic-topbar-left"><button type="button" className="agentic-mobile-menu koasis-mobile-menu" aria-label="Buka menu" aria-expanded={mobileSidebarOpen} onClick={() => setMobileSidebarOpen((current) => !current)}>{mobileSidebarOpen ? <X size={19} /> : <Menu size={19} />}</button>{manusPage === "home" ? <KoasisModelSelector activeModel={activeModel} selectedModelId={selectedModelId} open={engineMenuOpen} rootRef={modelSelectorRef} onToggle={toggleModelMenu} onSelect={selectModel} /> : <div className="manus-page-title"><strong>{manusPageTitle[manusPage]}</strong></div>}</div>{manusPage === "home" && !showHome && <div className="koasis-current-thread-title"><strong>{chatTitle}</strong></div>}<div className="agentic-topbar-actions koasis-topbar-actions">{manusPage === "home" && <button type="button" className="koasis-context-toggle" aria-label={workspacePanelOpen ? "Tutup konteks kerja" : "Buka konteks kerja"} aria-expanded={workspacePanelOpen} onClick={toggleWorkspacePanel}><Network size={15} strokeWidth={1.8} aria-hidden="true" /><span>{showHome && homeSurface === "chat" ? "Konteks" : "Shift board"}</span></button>}<button type="button" className="koasis-theme-toggle" aria-label={themeMode === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"} title={themeMode === "dark" ? "Mode terang" : "Mode gelap"} aria-pressed={themeMode === "dark"} onClick={toggleTheme}>{themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}<span>{themeMode === "dark" ? "Dark" : "Light"}</span></button><div className="agentic-topbar-avatar" aria-label={`Akun ${accountLabel}`} title={accountLabel}>{userInitial(user)}</div></div></header>

      <div className={`koasis-content ${workspacePanelOpen ? "with-board" : "without-board"}`}>
        <section className="koasis-conversation">
          <div className="koasis-conversation-scroll" ref={scrollRef} onScroll={handleConversationScroll}>
        {manusPage !== "home" ? <ManusPageSurface page={manusPage} onStartTask={startNewChat} /> : showHome ? homeSurface === "chat" ? <HomeSurface workspace={workspace} tasks={workspaceTasks} onAction={handleHomeAction} onOpenWorkspace={() => setWorkspacePanelOpen(true)} /> : homeSurface === "ops" ? <KoasisClinicalWorkspace userId={user.uid} workspace={workspace} tasks={workspaceTasks} activeShiftPhase={shiftPhase} onShiftPhaseChange={setShiftPhase} onAction={handleMkarAction} onToggleTask={toggleWorkspaceTask} onOpenWorkspace={() => setWorkspacePanelOpen(true)} onOpenCurriculum={() => openHomeSurface("curriculum")} /> : <MkarRotationCockpit userId={user.uid} workspace={workspace} tasks={workspaceTasks} activeShiftPhase={shiftPhase} onShiftPhaseChange={setShiftPhase} onAction={handleMkarAction} onToggleTask={toggleWorkspaceTask} onOpenOps={() => openHomeSurface("ops")} /> : <><div className="koasis-thread-head"><span className="koasis-overline">{activeSession?.title || "Percakapan"}</span><h1>{activePreset.label}</h1><p>{activePreset.purpose}</p><AgentContractBar preset={activePreset} sourceMode={sourceMode} /></div>{!messages.some((message) => message.role === "user") && !busy && <AgentStartSurface preset={activePreset} onPrompt={(prompt) => submitPrompt(prompt, [])} onWorkflow={openWorkflow} />}</>}
            {manusPage === "home" && !showHome && <><div className="koasis-message-list">{messages.map((message) => <MessageBubble key={message.id} message={message} userLabel={accountLabel} onRetry={handleRetry} onAction={handleAction} />)}{busy && !streamingMessageId && <AgentThinking label={activePreset.label} status={runStatus} events={runTrail} />}</div>{caseBriefOpen && <KoasisCaseBrief open={caseBriefOpen} busy={busy} onClose={() => { setCaseBriefOpen(false); }} onSubmit={(prompt) => { setCaseBriefOpen(false); submitPrompt(prompt, []); }} />}{workflowKind && <KoasisWorkflowDialog open={Boolean(workflowKind)} busy={busy} kind={workflowKind} onClose={() => setWorkflowKind(null)} onSubmit={(prompt) => { setWorkflowKind(null); submitPrompt(prompt, []); }} />}</>}
          </div>
          {showJumpToLatest && <button type="button" className="koasis-jump-latest" onClick={jumpToLatest}><ArrowDown size={14} /> Terbaru</button>}
          {manusPage === "home" && <div className="koasis-composer-area">
            <div className="koasis-composer-wrap" ref={composerWrapRef}>
              {privacyReview && <KoasisApprovalCard findings={privacyReview.findings.map((finding) => finding.label)} attachmentName={privacyReview.attachments.map((item) => item.name).join(", ") || undefined} onDismiss={() => setPrivacyReview(null)} onSanitize={movePrivacyReviewToComposer} />}
              {attachmentError && <div className="koasis-attachment-error" role="alert">{attachmentError}</div>}
              <div className="koasis-composer-toolbar"><div className="koasis-toolbar-left"><button type="button" className="koasis-toolbar-tool" onClick={() => { setToolsOpen((current) => !current); setModelMenuOpen(false); setEngineMenuOpen(false); }} aria-expanded={toolsOpen} aria-haspopup="dialog"><SlidersHorizontal size={13} /> {sourceMode === "attachments" ? "Attachment context" : sourceMode === "sources" ? "Evidence context" : <><Cloud size={13} /> Cloud</>}<ChevronDown size={12} /></button><button type="button" className="koasis-toolbar-mode" title="Ganti specialist agent" onClick={() => { setModelMenuOpen((current) => !current); setEngineMenuOpen(false); setToolsOpen(false); }} aria-label="Pilih specialist agent" aria-expanded={modelMenuOpen} aria-haspopup="menu"><KoasisGlyph name={activePreset.glyph} size={13} /> {activePreset.label}</button><KoasisReasoningEffort value={reasoningEffort} modelLabel={activeModel.label} onChange={setReasoningEffort} /></div><span>Enter kirim · Shift + Enter baris baru</span></div>
              <form className={`koasis-composer ${attachments.length ? "has-attachments" : ""}`} onSubmit={handleSubmit}>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf,audio/*,.txt,.csv,.tsv" multiple hidden onChange={(event) => { void handleFile(event); }} />
                {composerPalette && (composerPalette === "mention" ? mentionOptions : commandOptions).length > 0 && <div className={`koasis-composer-palette ${composerPalette}`} role="listbox" aria-label={composerPalette === "mention" ? "Pilih specialist agent" : "Pilih plugin command"}>
                  <div className="koasis-composer-palette-head"><div><strong>{composerPalette === "mention" ? "Spawn specialist agent" : "Plugin commands"}</strong><small>{composerPalette === "mention" ? "Pilih agent untuk menangani pesan ini." : "Pilih command untuk menjalankan plugin pada konteks aktif."}</small></div><kbd>{composerPalette === "mention" ? "@" : "/"}</kbd></div>
                  <div className="koasis-composer-palette-list">
                    {composerPalette === "mention" ? mentionOptions.map((preset, index) => <button type="button" role="option" aria-selected={composerPaletteIndex === index} className={composerPaletteIndex === index ? "active" : ""} key={preset.id} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseComposerOption(index)}><span className="koasis-composer-palette-icon"><KoasisGlyph name={preset.glyph} size={15} /></span><span><strong>{preset.label}</strong><small>{preset.shortDescription}</small></span><em>agent</em></button>) : commandOptions.map((command, index) => <button type="button" role="option" aria-selected={composerPaletteIndex === index} className={composerPaletteIndex === index ? "active" : ""} key={command.command} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseComposerOption(index)}><span className="koasis-composer-palette-icon"><ManusPluginIcon kind={command.kind} /></span><span><strong>/{command.command}</strong><small>{command.description}</small></span><em>{command.label}</em></button>)}
                  </div>
                </div>}
                {attachments.length > 0 && <div className="koasis-composer-attachments" aria-label="File attachments">{attachments.map((item) => <div key={`${item.name}-${item.dataUrl}`} className="koasis-composer-attachment-tile">{item.kind === "image" ? <KoasisImageProcessing attachment={item} onRemove={() => setAttachments((current) => current.filter((candidate) => candidate.dataUrl !== item.dataUrl))} /> : <KoasisAttachmentPreview attachment={item} onRemove={() => setAttachments((current) => current.filter((candidate) => candidate.dataUrl !== item.dataUrl))} />}</div>)}</div>}
                <button type="button" className="koasis-composer-button" aria-label="Lampirkan file" title="Lampirkan file" disabled={busy} onClick={() => fileInputRef.current?.click()}><Plus size={18} /></button>
                <div className="koasis-composer-text-layer"><div ref={composerMirrorRef} className="koasis-composer-text-mirror" aria-hidden="true">{renderComposerText(draft)}</div><textarea ref={composerRef} rows={1} value={draft} disabled={busy} onChange={(event) => { const value = event.target.value; const trigger = getComposerTrigger(value); setDraft(value); setComposerPalette(trigger?.type ?? null); setComposerPaletteIndex(0); if (attachmentError) setAttachmentError(""); }} onKeyDown={handleComposerKeyDown} onScroll={handleComposerScroll} placeholder={showHome ? "Tulis pertanyaan atau tugasmu…" : "Apa yang sedang kamu kerjakan?"} aria-label="Tulis pesan ke agent" /></div>
                <button type="button" className={`koasis-composer-button ${listening ? "active" : ""}`} aria-label={listening ? "Hentikan voice input" : "Gunakan voice input"} title={listening ? "Hentikan voice input" : "Voice input"} disabled={busy} onClick={toggleVoice}><span className="koasis-mic-mark" aria-hidden="true"><i /><i /><i /></span></button>
                <button type="submit" className="koasis-send-button" aria-label="Kirim pesan" disabled={busy || (!draft.trim() && !attachments.length)}>{busy ? <LoaderCircle size={15} className="koasis-spinner" /> : <ArrowUp size={16} />}</button>
              </form>
              {attachments.length > 0 && <div className="koasis-attachment-privacy"><ShieldCheck size={12} />Pastikan file sudah dianonimkan; Koasis tidak dapat menjamin mendeteksi identitas di dalam file.</div>}
              {toolsOpen && <div className="koasis-tools-popover" role="dialog" aria-label="Tools dan sumber"><div className="koasis-tools-heading"><div><span className="koasis-overline">Context pesan</span><strong>Pilih cara Koasis membaca input.</strong></div><button type="button" aria-label="Tutup tools" onClick={() => setToolsOpen(false)}><X size={14} /></button></div><button type="button" aria-label="Gunakan workspace context" className={sourceMode === "workspace" ? "active" : ""} onClick={() => { setSourceMode("workspace"); setToolsOpen(false); }}><span className="koasis-tool-radio" /><span><strong>Workspace context</strong><small>Gunakan stase, fokus, task, dan percakapan aktif.</small></span></button><button type="button" aria-label="Gunakan evidence source context" className={sourceMode === "sources" ? "active" : ""} onClick={() => { if (evidenceResults.length) setSourceMode("sources"); else setEvidenceSearchError("Cari atau tambahkan minimal satu sumber dulu."); }}><span className="koasis-tool-radio" /><span><strong>Evidence source context</strong><small>{evidenceResults.length ? `${evidenceResults.length} kandidat hasil pencarian tersedia.` : "Cari sumber publik dari Evidence Desk."}</small></span></button><button type="button" aria-label="Gunakan attachment atau catatan" className={sourceMode === "attachments" ? "active" : ""} onClick={() => { setSourceMode("attachments"); setToolsOpen(false); }}><span className="koasis-tool-radio" /><span><strong>Attachment / catatan</strong><small>{attachments.length ? `${attachments.length} attachment siap dipakai sebagai evidence.` : "Lampirkan file atau tempel catatan sebelum mengirim."}</small></span></button>{(activePreset.id === "evidence" || activePreset.id === "guideline") && <EvidenceSourceSearchPanel query={evidenceQuery} onQueryChange={(value) => { setEvidenceQuery(value); if (evidenceSearchError) setEvidenceSearchError(""); }} onSubmit={handleEvidenceSearch} busy={evidenceSearchBusy} error={evidenceSearchError} results={evidenceResults} onUseSource={addEvidenceSourceToContext} />}<div className="koasis-tools-disclaimer">Sumber hasil pencarian adalah kandidat metadata/abstract. Koasis tidak menganggapnya sebagai rekomendasi klinis final sebelum sumber asli direview.</div></div>}
              {modelMenuOpen && <div className="koasis-mode-popover" role="menu" aria-label="Pilih specialist agent">{AGENT_GROUPS.map((group) => <div className="koasis-mode-group" key={group.id}><div className="koasis-mode-group-label">{group.label}</div>{presetsForGroup(group.id).map((preset) => <button type="button" className={selectedPresetId === preset.id ? "active" : ""} key={preset.id} onClick={() => selectAgent(preset)}><span className="koasis-mode-popover-mark"><KoasisGlyph name={preset.glyph} size={15} /></span><span><strong>{preset.label}</strong><small>{preset.shortDescription}</small></span></button>)}</div>)}</div>}
            </div>
            <div className="koasis-composer-note"><ShieldCheck size={11} /> Sesi privat · identitas langsung dicek sebelum kirim · keputusan klinis tetap di tanganmu.</div>
          </div>}
        </section>
        {workspacePanelOpen && <KoasisWorkspacePanel workspace={workspace} tasks={workspaceTasks} activePhase={shiftPhase} onPhaseChange={setShiftPhase} onClose={() => setWorkspacePanelOpen(false)} onSaveWorkspace={saveWorkspace} onToggleTask={toggleWorkspaceTask} onAddTask={addWorkspaceTask} onPrompt={(prompt) => submitPrompt(prompt, [])} onOpenWorkflow={openWorkflow} onOpenCaseBrief={() => { setSelectedPresetId("case"); setSourceMode("workspace"); setCaseBriefOpen(true); }} />}
      </div>
    </main>
  </div>;
}
