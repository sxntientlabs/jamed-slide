export type KoasisModelId = "cito" | "elective" | "executive";
export type KoasisReasoningLevel = "mild" | "moderate" | "severe";
export type KoasisProviderReasoningEffort = "low" | "medium" | "high";

export type KoasisReasoningProfile = {
  id: KoasisReasoningLevel;
  providerEffort: KoasisProviderReasoningEffort;
  temperature: number;
  maxTokens: number;
  instruction: string;
};

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

const KOASIS_REASONING_PROFILES: Readonly<Record<KoasisReasoningLevel, KoasisReasoningProfile>> = {
  mild: {
    id: "mild",
    providerEffort: "low",
    temperature: 0.25,
    maxTokens: 1200,
    instruction: "Gunakan jalur analisis yang ringkas dan langsung. Prioritaskan jawaban utama, satu pemeriksaan konsistensi, dan caveat paling penting; jangan memperpanjang jawaban bila konteks sudah cukup.",
  },
  moderate: {
    id: "moderate",
    providerEffort: "medium",
    temperature: 0.2,
    maxTokens: 1800,
    instruction: "Gunakan analisis seimbang. Periksa kecocokan konteks, bedakan fakta dari asumsi, dan tampilkan alasan singkat, ketidakpastian, serta next step yang relevan.",
  },
  severe: {
    id: "severe",
    providerEffort: "high",
    temperature: 0.15,
    maxTokens: 2800,
    instruction: "Gunakan analisis berlapis untuk tugas kompleks. Uji alternatif yang masuk akal, lakukan pemeriksaan silang terhadap sumber atau data yang tersedia, jelaskan trade-off dan gap, lalu berikan kesimpulan yang dapat diaudit tanpa mengungkap chain-of-thought tersembunyi.",
  },
};

/**
 * Translates the public UI level into real provider controls plus a safe
 * visible-answer contract. The provider effort uses the common
 * OpenAI-compatible `reasoning_effort` values; the other fields keep the
 * difference meaningful even when a gateway does not implement that field.
 */
export function koasisReasoningProfile(value: unknown): KoasisReasoningProfile {
  return KOASIS_REASONING_PROFILES[normalizeKoasisReasoning(value)];
}

export function koasisModelStyleInstructions(value: unknown): string {
  const modelId = normalizeKoasisModelId(value);
  if (modelId === "cito") {
    return "Cito 6.7: jawab langsung dan ringkas. Utamakan poin bernomor atau bullet yang dapat dipindai cepat, langkah konkret, keputusan, dan next action. Gunakan paragraf hanya untuk pembuka atau caveat penting. Hindari pengantar panjang, pengulangan, dan narasi yang tidak membantu.";
  }
  if (modelId === "executive") {
    return "Executive 6.7: berikan penjelasan mendalam yang mayoritas berbentuk paragraf terstruktur. Jelaskan konteks, alasan, implikasi, trade-off, keterbatasan, dan tingkat kepastian secara utuh. Gunakan bullet atau tabel hanya untuk daftar, perbandingan, checklist, atau data yang memang lebih jelas bila dipindai.";
  }
  return "Elective 6.7: seimbangkan paragraf penjelasan dengan bullet atau poin bernomor. Gunakan paragraf untuk sintesis dan alasan, lalu gunakan poin untuk temuan, langkah, perbandingan, atau next action. Jaga jawaban tetap mudah dipindai tanpa menjadi terlalu dangkal.";
}
