import { CodeBlock } from "@aicss/react/code-block";
import { DataTable } from "@aicss/react/data-table";
import { TextResponse } from "@aicss/react/text-response";
import { ThinkingState } from "@aicss/react/thinking-state";
import { Check, FileText, Gauge, ShieldCheck, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { AgentChatAttachment } from "../lib/agentChatClient";
import { KOASIS_REASONING_LEVELS, normalizeKoasisReasoning, type KoasisReasoningLevel } from "../lib/koasisModels";
import { MessageActions } from "./aicss-public/message-actions/MessageActions";
import { ReasoningEffort } from "./aicss-public/reasoning-effort/ReasoningEffort";
import { SecureInput } from "./aicss-public/secure-input/SecureInput";
import { StreamingText } from "./aicss-public/streaming-text/StreamingText";
import { ThinkingReasoning } from "./aicss-public/thinking-reasoning/ThinkingReasoning";

const KOASIS_THINKING_STEPS = [
  "Membaca permintaan dan konteks kerja yang sedang aktif.",
  "Memisahkan tujuan, fakta yang tersedia, dan informasi yang masih belum ada.",
  "Menentukan struktur jawaban yang paling berguna untuk pekerjaan ini.",
  "Mengecek batasan privasi, sumber, dan asumsi sebelum melanjutkan.",
  "Menyusun output yang bisa kamu review sebelum dipakai.",
  "Menandai ketidakpastian dan langkah berikutnya jika masih ada gap.",
] as const;

export function AicssThinkingSurface({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="koasis-aicss-thinking" role="status" aria-live="polite">
      <span className="koasis-aicss-thinking-pulse" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="koasis-aicss-thinking-copy">
        <span className="koasis-aicss-thinking-label"><ThinkingState /><strong>{label}</strong></span>
        <small>{detail}</small>
      </span>
    </div>
  );
}

export function AicssTextResponse({ children }: { children: ReactNode }) {
  return <div className="koasis-aicss-response"><TextResponse>{children}</TextResponse></div>;
}

export function AicssThinkingReasoning({ sentences = KOASIS_THINKING_STEPS }: { sentences?: readonly string[] }) {
  return <div className="koasis-aicss-thinking-reasoning"><ThinkingReasoning sentences={sentences} /></div>;
}

export function AicssCodeBlock({ lang, code }: { lang: string; code: string }) {
  return <div className="koasis-aicss-code"><CodeBlock lang={lang || "text"} code={code} /></div>;
}

export type AicssTableRow = { model: string; context: string; price: string };

export function AicssDataTable({ rows }: { rows: AicssTableRow[] }) {
  return <div className="koasis-aicss-table"><DataTable rows={rows} /></div>;
}

export function KoasisComparisonTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="koasis-comparison-table" role="table" aria-label="Tabel perbandingan" style={{ "--comparison-columns": headers.length } as CSSProperties}>
    <div className="koasis-comparison-row head" role="row">{headers.map((header) => <span role="columnheader" key={header}>{header}</span>)}</div>
    <div className="koasis-comparison-body">{rows.map((row, rowIndex) => <div className="koasis-comparison-row" role="row" key={`comparison-${rowIndex}`}>{headers.map((_, cellIndex) => <span role="cell" key={`comparison-${rowIndex}-${cellIndex}`}>{row[cellIndex] || "—"}</span>)}</div>)}</div>
  </div>;
}

export function KoasisDiffBlock({ code }: { code: string }) {
  return <div className="koasis-diff-block" role="region" aria-label="Perubahan kode">
    {code.split("\n").map((line, index) => {
      const kind = line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : "context";
      return <div className={`koasis-diff-line ${kind}`} key={`diff-${index}`}><span>{kind === "added" ? "+" : kind === "removed" ? "−" : " "}</span><code>{line || " "}</code></div>;
    })}
  </div>;
}

export type KoasisTodoItem = { label: string; detail?: string; done?: boolean };

export function KoasisTodoList({ items }: { items: KoasisTodoItem[] }) {
  const [checked, setChecked] = useState(() => items.map((item) => Boolean(item.done)));
  return <div className="koasis-todo-list" role="list" aria-label="To-do list agent">
    {items.map((item, index) => <button type="button" className={`koasis-todo-item ${checked[index] ? "done" : ""}`} role="listitem" key={`${item.label}-${index}`} onClick={() => setChecked((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}>
      <span className="koasis-todo-check" aria-hidden="true">{checked[index] && <Check size={10} />}</span><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
    </button>)}
  </div>;
}

export type { KoasisReasoningLevel } from "../lib/koasisModels";

export function KoasisReasoningEffort({ value, modelLabel = "Elective 6.7", onChange }: { value: KoasisReasoningLevel; modelLabel?: string; onChange: (value: KoasisReasoningLevel) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedValue = normalizeKoasisReasoning(value);
  const index = KOASIS_REASONING_LEVELS.findIndex((level) => level.id === normalizedValue);
  const label = KOASIS_REASONING_LEVELS[index]?.label || "Moderate";

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="koasis-reasoning-control" ref={rootRef} data-component="reasoning-effort">
    <button type="button" className="koasis-reasoning-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label="Reasoning effort" onClick={() => setOpen((current) => !current)}>
      <Gauge size={13} aria-hidden="true" /><small>{label}</small><span className="koasis-reasoning-chevron" aria-hidden="true">⌄</span>
    </button>
    {open && <div className="koasis-reasoning-popover" role="dialog" aria-label="Reasoning effort">
      <div className="koasis-reasoning-popover-head"><strong>Reasoning effort</strong><span>{modelLabel} · {label}</span></div>
      <div className="koasis-public-reasoning-effort"><ReasoningEffort value={index} onChange={(next) => onChange(KOASIS_REASONING_LEVELS[next]?.id || "moderate")} /></div>
    </div>}
  </div>;
}

export function KoasisAudioWaves({ active = false, label = "Audio" }: { active?: boolean; label?: string }) {
  return <span className={`koasis-audio-waves ${active ? "active" : ""}`} role="img" aria-label={label}>{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</span>;
}

export function KoasisStreamingText({ active, text = "" }: { active: boolean; text?: string }) {
  return active ? <span className="koasis-aicss-streaming" aria-label="Jawaban sedang dibuat"><StreamingText text={text} /></span> : null;
}

export function KoasisAttachmentPreview({ attachment, onRemove }: { attachment: AgentChatAttachment; onRemove: () => void }) {
  return <div className={`koasis-attachment-preview ${attachment.kind}`} role="group" aria-label={attachment.name} title={attachment.name}>
    {attachment.kind === "image" ? <img src={attachment.dataUrl} alt="" /> : <span className="koasis-attachment-preview-mark">{attachment.kind === "audio" ? <KoasisAudioWaves active label="Audio attachment" /> : <FileText size={20} />}</span>}
    <button type="button" aria-label={`Hapus ${attachment.name}`} title={`Hapus ${attachment.name}`} onClick={onRemove}><X size={13} /></button>
  </div>;
}

export function KoasisImageProcessing({ attachment, onRemove }: { attachment: AgentChatAttachment; onRemove: () => void }) {
  if (attachment.kind !== "image") return <KoasisAttachmentPreview attachment={attachment} onRemove={onRemove} />;
  return <div className="koasis-attachment-preview image-processing" role="group" aria-label={attachment.name} title={attachment.name}>
    <img src={attachment.dataUrl} alt="" /><button type="button" aria-label={`Hapus ${attachment.name}`} title={`Hapus ${attachment.name}`} onClick={onRemove}><X size={13} /></button>
  </div>;
}

export function KoasisSecureInput({ detail }: { detail: string }) {
  return <div className="koasis-secure-input"><ShieldCheck size={13} /><span><strong>Secure input</strong><small>{detail}</small></span></div>;
}

export function AicssSecureInputDemo() {
  return <div className="koasis-aicss-secure-demo"><SecureInput preset="login" title="Secure input" description="Credentials stay in the secure input surface before a connected computer uses them." continueLabel="Fill securely" dismissLabel="Dismiss" onContinue={() => undefined} /></div>;
}

export function KoasisApprovalCard({ findings, attachmentName, onDismiss, onSanitize }: { findings: string[]; attachmentName?: string; onDismiss: () => void; onSanitize: () => void }) {
  return <section className="koasis-approval-card" role="alertdialog" aria-labelledby="koasis-approval-title">
    <div className="koasis-approval-card-head"><span className="koasis-approval-card-mark"><ShieldCheck size={17} /></span><div><span className="koasis-overline">Approval gate</span><h2 id="koasis-approval-title">Review sebelum dikirim</h2></div><button type="button" aria-label="Tutup approval gate" title="Tutup" onClick={onDismiss}><X size={15} /></button></div>
    <p>Koasis menemukan data identitas langsung: <strong>{findings.join(", ")}</strong>. Data ini belum dikirim ke AI.</p>
    <KoasisSecureInput detail="Anonimkan teks sebelum melanjutkan. Attachment tetap perlu kamu periksa manual." />
    {attachmentName && <div className="koasis-approval-attachment"><FileText size={13} /><span>{attachmentName}</span><small>Periksa isi file manual</small></div>}
    <div className="koasis-approval-actions"><button type="button" className="koasis-button-secondary" onClick={onDismiss}>Kembali</button><button type="button" className="koasis-button-primary" onClick={onSanitize}><ShieldCheck size={13} /> Anonimkan di composer</button></div>
  </section>;
}

export type KoasisRunEvent = {
  phase: "accepted" | "preparing" | "generating" | "finalizing";
  message: string;
};

const RUN_PHASE_LABELS: Record<KoasisRunEvent["phase"], string> = {
  accepted: "Diterima",
  preparing: "Konteks",
  generating: "Menyusun",
  finalizing: "Review",
};

export function KoasisRunTrace({ events, activePhase }: { events: KoasisRunEvent[]; activePhase?: KoasisRunEvent["phase"] }) {
  const [expanded, setExpanded] = useState(false);
  if (!events.length) return null;
  const latest = events[events.length - 1];
  return <div className="koasis-run-trace">
    <button type="button" className="koasis-run-trace-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      <span className="koasis-run-trace-pulse" aria-hidden="true" /><span>Workflow · {RUN_PHASE_LABELS[latest.phase]}</span><small>{expanded ? "Sembunyikan" : "Lihat status"}</small>
    </button>
    {expanded && <div className="koasis-run-trace-list">{events.map((event, index) => <div className={`koasis-run-trace-item ${event.phase === activePhase ? "active" : "done"}`} key={`${event.phase}-${index}`}><span className="koasis-run-trace-node">{event.phase === activePhase ? <span /> : <Check size={10} />}</span><span><strong>{RUN_PHASE_LABELS[event.phase]}</strong><small>{event.message}</small></span></div>)}</div>}
  </div>;
}

export function KoasisCitation({ number, label, displayLabel, extraCount, onClick }: { number: string; label?: string; displayLabel?: string; extraCount?: number; onClick?: () => void }) {
  return (
    <button type="button" className="koasis-citation-chip" title={label || `Buka referensi ${number}`} aria-label={label || `Referensi ${number}`} onClick={onClick}>
      {displayLabel ? <><span className="koasis-citation-source">{displayLabel}</span><span className="koasis-citation-index">[{number}]</span>{extraCount && extraCount > 0 ? <span className="koasis-citation-more">+{extraCount}</span> : null}</> : `[${number}]`}
    </button>
  );
}

export function KoasisMessageActions({ text, showRetry, onRetry }: { text: string; showRetry?: boolean; onRetry?: () => void }) {
  return <div className="koasis-aicss-actions-shell" aria-label="Aksi jawaban"><MessageActions text={text} />{showRetry && onRetry && <button type="button" className="koasis-message-retry" onClick={onRetry}>Coba lagi</button>}</div>;
}
