import type { ParsedSlide, SlideRole, TemplateSlideGuide, TemplateSlideInclusion, TemplateSlidePatientScope } from "../types";

const EXAMPLE_SIGNAL = /(?:slide\s+ini\s+(?:cuma|hanya)|hanya\s+contoh|contoh\s+(?:slide|kasus|materi)|sample\s+(?:slide|case|patient)|dummy|jangan\s+(?:dimasukkan|dipakai)|hapus\s+aja|tidak\s+nyambung|ga\s+nyambung|educational|cat\s*mudpiles|high\s+anion\s+gap|penyebab\s+asidosis)/i;
const OPTIONAL_SIGNAL = /(?:opsional|optional|bila\s+ada|jika\s+ada|kalau\s+sesuai|if\s+applicable|tambahan\s+bila)/i;

export function normalizeSlideInclusion(value: unknown, fallback: TemplateSlideInclusion = "routine"): TemplateSlideInclusion {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (/(?:example|contoh|sample|dummy)/.test(normalized)) return "example";
  if (/(?:optional|opsional|tambahan)/.test(normalized)) return "optional";
  if (/(?:routine|required|wajib|rutin)/.test(normalized)) return "routine";
  return fallback;
}

export function inferSlideInclusion(text: string, role?: string, index?: number, profileId?: string): {
  inclusion: TemplateSlideInclusion;
  include: boolean;
  reason?: string;
} {
  const haystack = text.replace(/\s+/g, " ").trim();
  // The built-in Lapjag contract has one known educational CAT/MUDPILES
  // slide. Do not classify real AGD/lab data as an example just because a
  // clinical diagnosis contains words such as "high anion gap".
  if (profileId === "lapjag") {
    if (index === 18) return { inclusion: "example", include: false, reason: "Diagram edukatif/sample; tidak dibawa ke laporan rutin." };
    return { inclusion: "routine", include: true };
  }
  if (EXAMPLE_SIGNAL.test(haystack)) {
    return { inclusion: "example", include: false, reason: "Terdeteksi sebagai contoh/edukasi atau instruksi internal template." };
  }
  if (OPTIONAL_SIGNAL.test(haystack)) {
    return { inclusion: "optional", include: false, reason: "Konten ditandai opsional; pengguna dapat menyertakannya dari mapping." };
  }
  // A purely visual educational slide without a patient data slot is safer as
  // optional when the template does not identify it as a clinical section.
  if (role === "unknown" && !haystack) {
    return { inclusion: "optional", include: false, reason: "Slide belum memiliki konteks klinis yang terbaca." };
  }
  return { inclusion: "routine", include: true };
}

export function slideInclusion(slide: Pick<ParsedSlide, "inclusion" | "include">): TemplateSlideInclusion {
  return slide.inclusion || "routine";
}

export function slideIsIncluded(slide: Pick<ParsedSlide, "include">): boolean {
  return slide.include !== false;
}

export function guideInclusion(guide: Pick<TemplateSlideGuide, "inclusion" | "include">): TemplateSlideInclusion {
  return guide.inclusion || "routine";
}

export function guideIsIncluded(guide: Pick<TemplateSlideGuide, "include">): boolean {
  return guide.include !== false;
}

export function normalizePatientScope(value: unknown, fallback: TemplateSlidePatientScope = "static"): TemplateSlidePatientScope {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/(?:all|all_patients|summary|ringkasan|semua_pasien)/.test(normalized)) return "all_patients";
  if (/(?:focus|focus_patient|primary|utama|selected|pasien_utama)/.test(normalized)) return "focus_patient";
  if (/(?:static|statis|none|tanpa_pasien)/.test(normalized)) return "static";
  return fallback;
}

export function inferPatientScope(role: SlideRole | string, repeat: boolean): TemplateSlidePatientScope {
  if (role === "shift_summary") return "all_patients";
  return repeat ? "focus_patient" : "static";
}
