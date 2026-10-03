import type { CSSProperties, HTMLAttributes } from "react";

export type KoasisIconName =
  | "overview"
  | "report"
  | "archive"
  | "patient"
  | "review"
  | "template"
  | "generate"
  | "evidence"
  | "radiology"
  | "safety"
  | "security"
  | "settings"
  | "help"
  | "spark"
  | "upload"
  | "workflow"
  | "insight"
  | "activity"
  | "audio"
  | "file";

type KoasisIconAsset =
  | "overview"
  | "report"
  | "care"
  | "review"
  | "template"
  | "generate"
  | "evidence"
  | "radiology"
  | "patient"
  | "settings"
  | "help"
  | "spark";

const ICON_ASSET: Record<KoasisIconName, KoasisIconAsset> = {
  overview: "overview",
  workflow: "overview",
  report: "report",
  archive: "report",
  file: "report",
  patient: "patient",
  safety: "care",
  security: "care",
  review: "review",
  template: "template",
  generate: "generate",
  upload: "generate",
  evidence: "evidence",
  activity: "evidence",
  audio: "evidence",
  radiology: "radiology",
  settings: "settings",
  help: "help",
  spark: "spark",
  insight: "spark",
};

export type KoasisIconProps = Omit<HTMLAttributes<HTMLSpanElement>, "name"> & {
  name: KoasisIconName;
  size?: number | string;
};

const iconClass = (name: KoasisIconName, className?: string) =>
  ["koasis-icon", `koasis-icon-${name}`, className].filter(Boolean).join(" ");

export function KoasisIcon({ name, size = 18, className, style, ...spanProps }: KoasisIconProps) {
  const asset = ICON_ASSET[name];
  const accessible = Boolean(spanProps["aria-label"]);
  const iconStyle: CSSProperties = {
    ...style,
    width: size,
    height: size,
    backgroundImage: `url("/koasis-icons/${asset}.png")`,
  };

  return (
    <span
      {...spanProps}
      className={iconClass(name, className)}
      style={iconStyle}
      data-koasis-icon={name}
      aria-hidden={accessible ? undefined : true}
      role={accessible ? "img" : spanProps.role}
    />
  );
}
