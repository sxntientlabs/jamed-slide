import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { KoasisGlyph, type KoasisGlyphName } from "./KoasisGlyph";

export type KoasisFlowField = {
  key: string;
  label: string;
  hint?: string;
  placeholder: string;
  rows?: number;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type KoasisQuestionFlowProps = {
  open: boolean;
  busy: boolean;
  resetKey: string;
  eyebrow: string;
  title: string;
  description: string;
  glyph: KoasisGlyphName;
  note: string;
  fields: KoasisFlowField[];
  initialValues?: Record<string, string>;
  submitLabel?: string;
  buildPrompt: (values: Record<string, string>) => string;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
};

function valuesFromInitial(fields: KoasisFlowField[], initialValues: Record<string, string> = {}) {
  return Object.fromEntries(fields.map((field) => [field.key, initialValues[field.key] || ""]));
}

export function KoasisQuestionFlow({
  open,
  busy,
  resetKey,
  eyebrow,
  title,
  description,
  glyph,
  note,
  fields,
  initialValues,
  submitLabel = "Mulai workflow",
  buildPrompt,
  onClose,
  onSubmit,
}: KoasisQuestionFlowProps) {
  const [values, setValues] = useState<Record<string, string>>(() => valuesFromInitial(fields, initialValues));
  const [step, setStep] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const field = fields[step] || fields[0];
  const value = field ? values[field.key] || "" : "";
  const isLastStep = step >= fields.length - 1;
  const canContinue = !field?.required || Boolean(value.trim());
  const progressLabel = `${Math.min(step + 1, fields.length)} dari ${fields.length}`;
  const inputId = `koasis-flow-${resetKey}-${field?.key || "answer"}`;

  useEffect(() => {
    if (!open) return;
    setValues(valuesFromInitial(fields, initialValues));
    setStep(0);
    const frame = window.requestAnimationFrame(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [fields, initialValues, open, resetKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  const update = (nextValue: string) => {
    if (!field) return;
    setValues((current) => ({ ...current, [field.key]: nextValue }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!field || busy || !canContinue) return;
    if (isLastStep) {
      onSubmit(buildPrompt(values));
      return;
    }
    setStep((current) => current + 1);
  };

  const skip = () => {
    if (!field || busy || field.required) return;
    if (isLastStep) onSubmit(buildPrompt(values));
    else setStep((current) => current + 1);
  };

  const goBack = () => {
    if (!busy) setStep((current) => Math.max(0, current - 1));
  };

  const goForward = () => {
    if (!busy && canContinue) {
      if (isLastStep) onSubmit(buildPrompt(values));
      else setStep((current) => current + 1);
    }
  };

  if (!open || !field) return null;

  return (
    <section ref={cardRef} className="koasis-question-flow" aria-labelledby={`${resetKey}-title`}>
      <header className="koasis-question-flow-head">
        <div className="koasis-question-flow-heading">
          <span className="koasis-question-flow-icon"><KoasisGlyph name={glyph} size={18} /></span>
          <div>
            <span className="koasis-overline">{eyebrow}</span>
            <h2 id={`${resetKey}-title`}>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="koasis-question-flow-controls">
          <button type="button" aria-label="Pertanyaan sebelumnya" onClick={goBack} disabled={busy || step === 0}><ChevronLeft size={17} /></button>
          <span>{progressLabel}</span>
          <button type="button" aria-label="Pertanyaan berikutnya" onClick={goForward} disabled={busy || !canContinue}><ChevronRight size={17} /></button>
          <button type="button" className="koasis-question-flow-close" onClick={onClose} disabled={busy} aria-label="Tutup workflow"><X size={17} /></button>
        </div>
      </header>

      <div className="koasis-question-flow-note"><span className="koasis-question-flow-note-mark">K</span><span>{note}</span></div>

      <form className="koasis-question-flow-form" onSubmit={submit}>
        <div className="koasis-question-flow-question">
          <span className="koasis-overline">Pertanyaan {step + 1}</span>
          <h3>{field.label}</h3>
          {field.hint && <p>{field.hint}</p>}
          {field.options ? (
            <div className="koasis-question-flow-options" role="listbox" aria-label={field.label}>
              {field.options.map((option, index) => {
                const selected = value === option.value;
                return <button type="button" role="option" aria-selected={selected} className={selected ? "selected" : ""} key={option.value} onClick={() => update(option.value)}><span className="koasis-question-flow-number">{index + 1}</span><span>{option.label}</span>{selected && <Check size={15} />}</button>;
              })}
            </div>
          ) : (
            <div className="koasis-question-flow-answer">
              {field.rows ? <textarea id={inputId} autoFocus value={value} onChange={(event) => update(event.target.value)} placeholder={field.placeholder} rows={field.rows} aria-required={field.required} /> : <input id={inputId} autoFocus value={value} onChange={(event) => update(event.target.value)} placeholder={field.placeholder} aria-required={field.required} />}
            </div>
          )}
        </div>

        <footer className="koasis-question-flow-actions">
          <span>{field.required ? "Wajib diisi untuk melanjutkan" : "Boleh dilewati, bisa dilengkapi nanti"}</span>
          <div>
            {!field.required && <button type="button" className="koasis-question-flow-skip" onClick={skip} disabled={busy}>{isLastStep ? "Lewati & mulai" : "Lewati"}</button>}
            <button type="submit" className="koasis-question-flow-submit" disabled={busy || !canContinue}>{isLastStep ? submitLabel : "Lanjut"}<ArrowRight size={15} /></button>
          </div>
        </footer>
      </form>
    </section>
  );
}
