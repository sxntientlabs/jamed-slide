"use client";

import styles from "./StreamingText.module.css";
import { useEffect, useRef, useState } from "react";

export function StreamingText({ text }: { text: string }) {
  const [shown, setShown] = useState("");
  const shownRef = useRef("");
  const targetRef = useRef(text);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = text;

    // Keep already-revealed output when a new provider chunk arrives. The old
    // implementation restarted from character zero for every chunk, which
    // made a live answer visibly jump and replay itself.
    if (shownRef.current && !text.startsWith(shownRef.current)) {
      shownRef.current = "";
      setShown("");
    }

    const reveal = () => {
      const target = targetRef.current;
      const current = shownRef.current;
      if (current.length >= target.length) {
        frameRef.current = null;
        return;
      }
      const remaining = target.length - current.length;
      const step = Math.max(1, Math.min(18, Math.ceil(remaining / 2)));
      const next = target.slice(0, current.length + step);
      shownRef.current = next;
      setShown(next);
      frameRef.current = window.requestAnimationFrame(reveal);
    };

    if (shownRef.current.length < text.length && frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(reveal);
    }

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [text]);

  const streaming = shown.length < text.length;
  return (
    <p className={styles.prose} aria-live="polite">
      {shown}
      <span className={streaming ? styles.caret + " " + styles.caretSteady : styles.caret} />
    </p>
  );
}
