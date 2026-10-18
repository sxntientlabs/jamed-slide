export type KoasisModelId = "cito" | "elective" | "executive";
export type KoasisReasoningLevel = "mild" | "moderate" | "severe";

export type KoasisModelDefinition = {
  id: KoasisModelId;
  label: string;
  tier: string;
  description: string;
};

export const KOASIS_MODELS: readonly KoasisModelDefinition[] = [
  {
    id: "cito",
    label: "Cito 6.7",
    tier: "Instant",
    description: "Cepat dan hemat untuk tugas rutin, ringkasan, dan eksplorasi awal.",
  },
  {
    id: "elective",
    label: "Elective 6.7",
    tier: "Balance",
    description: "Seimbang untuk diskusi, analisis, dan pekerjaan klinis sehari-hari.",
  },
  {
    id: "executive",
    label: "Executive 6.7",
    tier: "Premium",
    description: "Lebih teliti untuk kasus kompleks, reasoning mendalam, dan output penting.",
  },
] as const;

export const KOASIS_REASONING_LEVELS: readonly { id: KoasisReasoningLevel; label: string }[] = [
  { id: "mild", label: "Mild" },
  { id: "moderate", label: "Moderate" },
  { id: "severe", label: "Severe" },
] as const;

export const DEFAULT_KOASIS_MODEL: KoasisModelId = "elective";
export const DEFAULT_KOASIS_REASONING: KoasisReasoningLevel = "moderate";

export function normalizeKoasisModelId(value: unknown): KoasisModelId {
  if (value === "cito" || value === "elective" || value === "executive") return value;
  return DEFAULT_KOASIS_MODEL;
}

export function normalizeKoasisReasoning(value: unknown): KoasisReasoningLevel {
  if (value === "mild" || value === "moderate" || value === "severe") return value;
  if (value === "low") return "mild";
  if (value === "medium") return "moderate";
  if (value === "high" || value === "extra-high") return "severe";
  return DEFAULT_KOASIS_REASONING;
}
