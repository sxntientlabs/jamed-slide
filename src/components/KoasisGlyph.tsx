import type { SVGProps } from "react";

export type KoasisGlyphName =
  | "agent"
  | "study"
  | "clinical"
  | "report"
  | "concept"
  | "plan"
  | "case"
  | "exam"
  | "guideline"
  | "workflow"
  | "chat"
  | "light"
  | "dark";

type KoasisGlyphProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: KoasisGlyphName;
  size?: number;
};

function GlyphDrawing({ name }: { name: KoasisGlyphName }) {
  switch (name) {
    case "agent":
      return (
        <>
          <circle cx="12" cy="10.4" r="6.9" />
          <path d="M10.1 9.5v2M13.9 9.5v2" className="koasis-glyph-eye" />
          <g className="koasis-glyph-stethoscope">
            <path d="M7.3 12.8v3.2a4.7 4.7 0 0 0 9.4 0v-2" />
            <path d="M16.7 14v3.3l1.7 1.7" />
            <circle cx="19.5" cy="19.9" r="1.45" className="koasis-glyph-stethoscope-head" />
            <circle cx="19.5" cy="19.9" r=".38" className="koasis-glyph-stethoscope-dot" />
          </g>
        </>
      );
    case "study":
      return (
        <>
          <path d="M4.2 6.4c3.3-.6 5.9.2 7.8 2.4v10c-1.9-2.2-4.5-3-7.8-2.4z" />
          <path d="M19.8 6.4c-3.3-.6-5.9.2-7.8 2.4v10c1.9-2.2 4.5-3 7.8-2.4z" />
          <path d="M7.2 10.1c1.3 0 2.3.3 3.1 1" opacity=".6" />
          <circle cx="17.2" cy="10.4" r="1.05" className="koasis-glyph-dot" />
        </>
      );
    case "clinical":
      return (
        <>
          <path d="M4.3 7.1c2.2-1.5 4.8-2.3 7.7-2.3s5.5.8 7.7 2.3v9.8c-2.2 1.5-4.8 2.3-7.7 2.3s-5.5-.8-7.7-2.3z" />
          <path d="M5.7 12h3.1l1.5-3.3 2.4 6.7 1.7-4 1.2.6h2.7" />
          <circle cx="19.7" cy="7.1" r="1.15" className="koasis-glyph-dot" />
        </>
      );
    case "report":
      return (
        <>
          <path d="M6 4.6h9.1l3 3v11.8H6z" />
          <path d="M15.1 4.6v3h3" />
          <path d="M8.8 12.1h6.5M8.8 15.3h4.8" opacity=".65" />
          <circle cx="8.7" cy="8.5" r="1.05" className="koasis-glyph-dot" />
        </>
      );
    case "concept":
      return (
        <>
          <path d="M5.2 9.4A7.4 7.4 0 0 1 18.8 9M4.7 14.1a7.6 7.6 0 0 0 14.6.1" />
          <path d="M8.1 11.7a4.1 4.1 0 0 1 7.9-.1M8.5 14.3a4.1 4.1 0 0 0 7-.1" opacity=".58" />
          <circle cx="12" cy="12.8" r="1.45" className="koasis-glyph-dot" />
        </>
      );
    case "plan":
      return (
        <>
          <path d="M5.1 17.8c1.1-6.9 3.6-10.7 7.3-10.7 3.1 0 3.1 4 6.4 4" />
          <path d="m16.4 8.7 2.5 2.4-2.5 2.4" />
          <circle cx="5.1" cy="17.8" r="1.3" />
          <circle cx="12.4" cy="7.1" r="1.15" className="koasis-glyph-dot" />
        </>
      );
    case "case":
      return (
        <>
          <path d="M8 5H5v3M16 5h3v3M8 19H5v-3M16 19h3v-3" />
          <path d="M8.2 14.9 11 12l2.5 1.7 2.6-4.3" />
          <circle cx="8.2" cy="14.9" r="1.1" />
          <circle cx="11" cy="12" r="1.1" className="koasis-glyph-dot" />
          <circle cx="16.1" cy="9.4" r="1.1" />
        </>
      );
    case "exam":
      return (
        <>
          <path d="M7 4.8h10v14.4H7z" />
          <path d="M9.6 8.5h4.8M9.6 11.9h4.8M9.6 15.3h2.8" opacity=".62" />
          <path d="m15.5 15.1 1.3 1.3 2.6-3" />
          <circle cx="7" cy="4.8" r="1.1" className="koasis-glyph-dot" />
        </>
      );
    case "guideline":
      return (
        <>
          <path d="M5.2 6.1c2.5-.8 4.7-.4 6.8 1.3v11c-2.1-1.7-4.3-2.1-6.8-1.3z" />
          <path d="M18.8 6.1c-2.5-.8-4.7-.4-6.8 1.3v11c2.1-1.7 4.3-2.1 6.8-1.3z" />
          <path d="M8 10.3c1.1.1 2 .4 2.8 1M16 10.3c-1.1.1-2 .4-2.8 1" opacity=".62" />
          <circle cx="18.8" cy="6.1" r="1.1" className="koasis-glyph-dot" />
        </>
      );
    case "workflow":
      return (
        <>
          <path d="M6.1 7.1h5.2c3.8 0 3.8 4.9 6.6 4.9M17.9 12c-2.8 0-2.8 4.9-6.6 4.9H6.1" />
          <circle cx="6.1" cy="7.1" r="1.3" />
          <circle cx="17.9" cy="12" r="1.3" className="koasis-glyph-dot" />
          <circle cx="6.1" cy="16.9" r="1.3" />
        </>
      );
    case "chat":
      return (
        <>
          <path d="M5.2 6.2h13.6v9.6H11l-4.3 3v-3H5.2z" />
          <path d="M8.1 10h7.8M8.1 12.9h5" opacity=".62" />
          <circle cx="18.8" cy="6.2" r="1.15" className="koasis-glyph-dot" />
        </>
      );
    case "light":
      return (
        <>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M12 4.1v1.8M12 18.1v1.8M4.1 12h1.8M18.1 12h1.8M6.4 6.4l1.3 1.3M16.3 16.3l1.3 1.3M17.6 6.4l-1.3 1.3M7.7 16.3l-1.3 1.3" opacity=".72" />
          <circle cx="12" cy="12" r="1.2" className="koasis-glyph-dot" />
        </>
      );
    case "dark":
      return (
        <>
          <path d="M17.8 5.4a7.3 7.3 0 1 0 .8 12.6A6.6 6.6 0 0 1 17.8 5.4z" />
          <path d="M5.3 8.2c1.1-.9 2.3-1.4 3.7-1.5" opacity=".55" />
          <circle cx="15.7" cy="9.2" r="1.1" className="koasis-glyph-dot" />
        </>
      );
  }
}

export function KoasisGlyph({ name, size = 20, className = "", ...props }: KoasisGlyphProps) {
  const labelled = Boolean(props["aria-label"]);
  return (
    <svg
      {...props}
      className={["koasis-glyph", `koasis-glyph-${name}`, className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
    >
      <GlyphDrawing name={name} />
    </svg>
  );
}
