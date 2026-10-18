import type { AgentId } from "./agentCatalog";

export type OpsSurface = "clinical" | "shift" | "case" | "assessment" | "tools";
export type OpsStage = "before" | "during" | "after";
export type CaptureKind = "encounter" | "procedure" | "monitoring" | "feedback";

export type OpsEncounter = {
  id: string;
  alias: string;
  setting: string;
  kind: CaptureKind;
  summary: string;
  nextStep: string;
  createdAt: string;
};

export type OpsAssessmentAttempt = {
  id: string;
  assessmentId: string;
  note: string;
  createdAt: string;
};

export type ProcedureDefinition = {
  id: string;
  label: string;
  setting: string;
  description: string;
  safetyGate: string;
  steps: readonly string[];
  sourceLabel: string;
};

export type CalculatorId = "bmi" | "map" | "shock-index" | "bsa";

export type CalculatorDefinition = {
  id: CalculatorId;
  label: string;
  shortDescription: string;
  inputs: readonly { key: string; label: string; unit: string; placeholder: string }[];
  formula: string;
  sourceLabel: string;
};

export type MessageTemplate = {
  id: string;
  label: string;
  purpose: string;
  body: string;
  fields: readonly string[];
};

export type AssessmentLabDefinition = {
  id: string;
  label: string;
  kind: "formative" | "summative";
  description: string;
  agentId: AgentId;
  checklist: readonly string[];
};

export const CLINICAL_DAY_BLOCKS = [
  { id: "handover", label: "Laporan jaga", stage: "before" as OpsStage, detail: "Ambil handover dari shift malam dan tandai hal yang perlu diverifikasi.", agentId: "ward" as AgentId },
  { id: "bedside", label: "Bedside teaching", stage: "before" as OpsStage, detail: "Siapkan materi anamnesis, pemeriksaan fisik, dan penalaran sesuai DPJP.", agentId: "prebrief" as AgentId },
  { id: "rotation", label: "Rotasi unit", stage: "during" as OpsStage, detail: "Poli, bangsal, IGD, perina, atau unit sesuai jadwal hari ini.", agentId: "ward" as AgentId },
  { id: "follow-up", label: "Follow-up pasien", stage: "during" as OpsStage, detail: "Bangun timeline longitudinal dari fakta yang benar-benar ditemukan.", agentId: "case" as AgentId },
  { id: "discussion", label: "Diskusi kelompok", stage: "after" as OpsStage, detail: "Ubah kasus atau topik menjadi CBD, presentasi, dan bahan PPT.", agentId: "presentation" as AgentId },
] as const;

export const SHIFT_FLOW = [
  { id: "standby", label: "Standby", detail: "Siap di unit dan pahami jalur eskalasi." },
  { id: "triage", label: "Pasien baru", detail: "Triase, anamnesis, pemeriksaan fisik, dan data awal." },
  { id: "action", label: "Tindakan", detail: "Bantu sesuai instruksi dan batas supervisi." },
  { id: "monitor", label: "Monitoring", detail: "Catat waktu, nilai, respons, dan perubahan." },
  { id: "handover", label: "Handover", detail: "Ringkas kondisi, action list, dan contingency." },
  { id: "report", label: "Laporan", detail: "Review fakta lalu teruskan ke template PPTX." },
] as const;

export const PROCEDURE_CATALOG: readonly ProcedureDefinition[] = [
  {
    id: "ttv-monitoring",
    label: "Monitoring tanda vital",
    setting: "Bangsal · IGD · perina",
    description: "Mencatat parameter secara serial dengan interval dan jalur eskalasi yang jelas.",
    safetyGate: "Konfirmasi instruksi, interval, identitas alias, alat, dan kepada siapa perubahan harus dilaporkan.",
    steps: ["Konfirmasi instruksi dan interval monitoring", "Siapkan alat dan pastikan satuan benar", "Catat waktu, konteks, dan nilai apa adanya", "Bandingkan dengan nilai sebelumnya", "Laporkan perubahan atau red flag kepada supervisor"],
    sourceLabel: "SOP unit + instruksi supervisor",
  },
  {
    id: "ecg",
    label: "Perekaman EKG",
    setting: "IGD · bangsal",
    description: "Checklist persiapan pasien, pemasangan lead, kualitas rekaman, dan dokumentasi.",
    safetyGate: "Pastikan permintaan dan supervisi tersedia; gunakan SOP alat/unit untuk posisi lead dan interpretasi.",
    steps: ["Verifikasi permintaan dan jelaskan tindakan", "Siapkan pasien, privasi, dan alat", "Pasang lead sesuai SOP unit", "Periksa kualitas artefak dan label waktu", "Simpan, dokumentasikan, dan serahkan untuk review"],
    sourceLabel: "SOP unit + manual alat",
  },
  {
    id: "ngt",
    label: "Pemasangan NGT",
    setting: "Bangsal · IGD",
    description: "Latihan alur persiapan dan dokumentasi dengan safety gate yang tegas.",
    safetyGate: "Jangan melakukan tanpa instruksi dan supervisi langsung sesuai kewenangan; konfirmasi metode verifikasi posisi berdasarkan SOP setempat.",
    steps: ["Verifikasi indikasi, kontraindikasi, dan supervisi", "Jelaskan tindakan dan siapkan perlengkapan", "Ikuti langkah teknik sesuai SOP unit", "Hentikan bila muncul tanda bahaya atau pasien tidak toleran", "Verifikasi posisi dan dokumentasikan sesuai SOP"],
    sourceLabel: "SOP unit + supervisor",
  },
  {
    id: "clinical-photo",
    label: "Foto klinis / dokumentasi visual",
    setting: "Semua unit",
    description: "Membantu menyiapkan dokumentasi visual yang etis dan dapat ditelusuri.",
    safetyGate: "Pastikan izin, kebijakan rumah sakit, dan larangan identitas langsung; jangan menyimpan atau membagikan foto tanpa otorisasi.",
    steps: ["Konfirmasi kebutuhan dan izin dokumentasi", "Hilangkan identitas yang tidak diperlukan", "Ambil gambar sesuai kebijakan unit", "Catat konteks dan waktu secara aman", "Simpan atau serahkan hanya melalui kanal resmi"],
    sourceLabel: "Kebijakan institusi + supervisor",
  },
  {
    id: "basic-ultrasound",
    label: "Persiapan USG dasar",
    setting: "IGD · bangsal",
    description: "Membantu menyiapkan pertanyaan, setting, dan dokumentasi; bukan menggantikan operator terlatih.",
    safetyGate: "Gunakan hanya sebagai persiapan belajar di bawah supervisi operator dan protokol institusi.",
    steps: ["Tentukan pertanyaan klinis dan batas pemeriksaan", "Siapkan pasien, posisi, dan alat", "Ikuti protokol pemeriksaan unit", "Catat temuan yang dilihat tanpa menyimpulkan sendiri", "Serahkan interpretasi kepada supervisor"],
    sourceLabel: "Protokol unit + operator tersupervisi",
  },
];

export const CALCULATOR_CATALOG: readonly CalculatorDefinition[] = [
  {
    id: "bmi",
    label: "BMI / IMT umum",
    shortDescription: "Berat dan tinggi menjadi angka IMT; tidak otomatis menentukan status gizi anak.",
    inputs: [{ key: "weightKg", label: "Berat badan", unit: "kg", placeholder: "Contoh 18.5" }, { key: "heightCm", label: "Tinggi badan", unit: "cm", placeholder: "Contoh 110" }],
    formula: "berat (kg) ÷ tinggi² (m)",
    sourceLabel: "Formula matematis; interpretasi sesuai usia, jenis kelamin, dan standar yang dipilih",
  },
  {
    id: "map",
    label: "Mean arterial pressure",
    shortDescription: "Estimasi numerik dari tekanan sistolik dan diastolik untuk bahan belajar.",
    inputs: [{ key: "systolic", label: "Sistolik", unit: "mmHg", placeholder: "Contoh 100" }, { key: "diastolic", label: "Diastolik", unit: "mmHg", placeholder: "Contoh 60" }],
    formula: "(sistolik + 2 × diastolik) ÷ 3",
    sourceLabel: "Formula estimasi; jangan dipakai sendirian untuk keputusan klinis",
  },
  {
    id: "shock-index",
    label: "Shock index",
    shortDescription: "Rasio denyut jantung terhadap tekanan sistolik; tampilkan sebagai angka, bukan diagnosis.",
    inputs: [{ key: "heartRate", label: "Denyut jantung", unit: "x/menit", placeholder: "Contoh 120" }, { key: "systolic", label: "Sistolik", unit: "mmHg", placeholder: "Contoh 100" }],
    formula: "denyut jantung ÷ sistolik",
    sourceLabel: "Formula rasio; cut-off harus mengikuti konteks, usia, dan sumber yang dipilih",
  },
  {
    id: "bsa",
    label: "Body surface area",
    shortDescription: "Estimasi luas permukaan tubuh dengan formula Mosteller.",
    inputs: [{ key: "weightKg", label: "Berat badan", unit: "kg", placeholder: "Contoh 18.5" }, { key: "heightCm", label: "Tinggi badan", unit: "cm", placeholder: "Contoh 110" }],
    formula: "√((tinggi (cm) × berat (kg)) ÷ 3600)",
    sourceLabel: "Formula Mosteller; verifikasi tujuan penggunaan dan kebijakan lokal",
  },
];

export const MESSAGE_TEMPLATES: readonly MessageTemplate[] = [
  { id: "new-patient", label: "Laporan pasien baru", purpose: "Minta arahan awal tanpa mengunci diagnosis", fields: ["alias", "unit", "summary"], body: "Dok, izin melaporkan pasien alias {alias} di {unit}. Keluhan/temuan utama: {summary}. Mohon arahan untuk prioritas pemeriksaan dan hal yang perlu saya siapkan. Saya tetap menunggu konfirmasi dan supervisi." },
  { id: "assessment-request", label: "Meminta Mini-CEX / DOPS", purpose: "Meminta waktu penilaian dengan konteks yang jelas", fields: ["alias", "assessment", "time"], body: "Dok, izin bertanya. Saya ingin meminta penilaian {assessment} pada pasien alias {alias}, bila berkenan. Apakah ada waktu yang sesuai, atau ada pasien/prosedur tertentu yang perlu saya siapkan?" },
  { id: "follow-up-update", label: "Update follow-up", purpose: "Mengirim perubahan penting secara ringkas", fields: ["alias", "update", "nextStep"], body: "Dok, izin update follow-up alias {alias}. Perubahan/temuan sejak terakhir: {update}. Hal yang sudah dilakukan: {nextStep}. Mohon koreksi bila ada data yang perlu saya lengkapi atau eskalasi." },
  { id: "feedback-request", label: "Meminta feedback", purpose: "Mengubah pengalaman menjadi feedback yang actionable", fields: ["activity", "question"], body: "Dok, setelah kegiatan {activity}, saya ingin meminta feedback singkat terutama untuk: {question}. Saya akan mencatat poin perbaikan dan mencoba ulang sesuai arahan." },
  { id: "presentation-confirm", label: "Konfirmasi presentasi", purpose: "Memastikan format dan deadline diskusi", fields: ["topic", "deadline"], body: "Dok, izin konfirmasi untuk presentasi topik/kasus {topic}. Target saya menyelesaikan draft sebelum {deadline}. Apakah ada fokus, format, atau sumber utama yang perlu saya prioritaskan?" },
];

export const ASSESSMENT_LAB: readonly AssessmentLabDefinition[] = [
  { id: "mini-cex", label: "Mini-CEX", kind: "formative", description: "Latihan encounter langsung: pembukaan, anamnesis, pemeriksaan fisik, clinical reasoning, konseling, dan penutupan.", agentId: "assessment", checklist: ["Identifikasi, consent, dan tujuan", "Anamnesis terarah", "Pemeriksaan fisik sistematis", "Ringkasan dan problem representation", "Rencana klarifikasi dan feedback"] },
  { id: "dops", label: "DOPS", kind: "summative", description: "Latihan prosedur dengan safety gate, checklist langkah, komunikasi, dan dokumentasi.", agentId: "procedure", checklist: ["Indikasi dan batas kewenangan", "Alat, pasien, dan infection prevention", "Komunikasi selama tindakan", "Langkah teknik sesuai SOP", "Komplikasi, dokumentasi, dan feedback"] },
  { id: "cbd", label: "CBD", kind: "summative", description: "Diskusi kasus berbasis fakta, hipotesis, data diskriminatif, dan pembelaan clinical reasoning.", agentId: "case", checklist: ["Problem representation", "Data positif dan negatif", "Differential sebagai hipotesis", "Evidence yang relevan", "Pertanyaan dan next step"] },
  { id: "case-presentation", label: "Presentasi kasus", kind: "summative", description: "Dari timeline kasus menuju makalah, slide, dan pertanyaan diskusi yang dapat diverifikasi.", agentId: "presentation", checklist: ["Timeline dan data lengkap", "Struktur makalah", "Referensi tanpa sitasi palsu", "Slide dengan satu pesan per halaman", "Simulasi tanya jawab"] },
  { id: "osce", label: "OSCE", kind: "summative", description: "Station ber-timebox dengan instruksi, rubric, critical error, dan retry.", agentId: "assessment", checklist: ["Pahami task dan waktu", "Buka encounter dengan aman", "Lakukan langkah prioritas", "Komunikasikan temuan", "Tutup dan dokumentasikan"] },
  { id: "mcq", label: "MCQ", kind: "summative", description: "Retrieval practice berbasis blueprint stase, pembahasan pilihan, dan error log.", agentId: "study", checklist: ["Tentukan topik dan level", "Jawab sebelum melihat pembahasan", "Catat alasan pilihan", "Tandai learning gap", "Jadwalkan pengulangan"] },
];

export const CASE_OUTPUTS = [
  { id: "logbook", label: "Logbook", detail: "Ringkas fakta dan aktivitas yang benar-benar dilakukan.", agentId: "case" as AgentId },
  { id: "cbd", label: "CBD brief", detail: "Ubah timeline menjadi bahan diskusi supervisor.", agentId: "case" as AgentId },
  { id: "paper", label: "Makalah", detail: "Susun struktur akademik dan source pack.", agentId: "presentation" as AgentId },
  { id: "slides", label: "PPT kasus", detail: "Buat outline slide dan speaker notes.", agentId: "presentation" as AgentId },
] as const;

export const CAPTURE_KIND_LABELS: Record<CaptureKind, string> = {
  encounter: "Encounter baru",
  procedure: "Tindakan/prosedur",
  monitoring: "Monitoring",
  feedback: "Feedback supervisor",
};

export function calculateClinicalTool(id: CalculatorId, values: Record<string, string>): { value: string; unit: string; note: string } | { error: string } {
  const number = (key: string) => Number(values[key]);
  const required = (keys: string[]) => keys.every((key) => Number.isFinite(number(key)) && number(key) > 0);
  if (id === "bmi") {
    if (!required(["weightKg", "heightCm"])) return { error: "Masukkan berat dan tinggi dengan angka lebih dari 0." };
    const bmi = number("weightKg") / ((number("heightCm") / 100) ** 2);
    return { value: bmi.toFixed(1), unit: "kg/m²", note: "Angka ini bukan klasifikasi status gizi. Anak harus dinilai dengan usia, jenis kelamin, dan standar pertumbuhan yang sesuai." };
  }
  if (id === "map") {
    if (!required(["systolic", "diastolic"])) return { error: "Masukkan tekanan sistolik dan diastolik." };
    return { value: ((number("systolic") + (2 * number("diastolic"))) / 3).toFixed(1), unit: "mmHg", note: "Gunakan sebagai estimasi numerik untuk belajar dan tetap interpretasikan dalam konteks klinis." };
  }
  if (id === "shock-index") {
    if (!required(["heartRate", "systolic"])) return { error: "Masukkan denyut jantung dan tekanan sistolik." };
    return { value: (number("heartRate") / number("systolic")).toFixed(2), unit: "rasio", note: "Jangan gunakan angka ini sendirian untuk menyimpulkan syok atau menentukan terapi." };
  }
  if (!required(["weightKg", "heightCm"])) return { error: "Masukkan berat dan tinggi dengan angka lebih dari 0." };
  return { value: Math.sqrt((number("weightKg") * number("heightCm")) / 3600).toFixed(2), unit: "m²", note: "Verifikasi formula, tujuan penggunaan, dan kebijakan lokal sebelum dipakai dalam konteks klinis." };
}

export function fillMessageTemplate(template: MessageTemplate, values: Record<string, string>): string {
  return template.body.replace(/\{([^}]+)\}/g, (_match, key: string) => values[key]?.trim() || `[${key}]`);
}
