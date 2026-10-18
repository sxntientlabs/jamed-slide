import type { AgentId } from "./agentCatalog";

export type MkarPhaseId = "orientasi" | "latihan" | "umpan-balik";

export type MkarTarget = {
  id: string;
  label: string;
  category: "skill" | "case";
  target: number;
  unit: string;
  note: string;
};

export type MkarAssessment = {
  id: string;
  label: string;
  kind: "formatif" | "sumatif";
  weight: string;
  required: string;
  agentId: AgentId;
  description: string;
};

export const MKAR_PROFILE = {
  id: "mkar-2025",
  label: "Modul Kesehatan Anak & Remaja",
  shortLabel: "MKAR",
  duration: "9 minggu",
  learningModel: "Orientasi · Latihan · Umpan balik",
  sourceNote: "Profil kurikulum berdasarkan BPKM yang diunggah; guideline klinis harus memakai sumber terbaru.",
} as const;

export const MKAR_PHASES: ReadonlyArray<{
  id: MkarPhaseId;
  label: string;
  shortLabel: string;
  description: string;
  detail: string;
}> = [
  {
    id: "orientasi",
    label: "Orientasi",
    shortLabel: "Siapkan",
    description: "Pahami tujuan, sumber, dan checklist sebelum masuk klinik.",
    detail: "Kuliah, flipped classroom, praktikum, bedside teaching",
  },
  {
    id: "latihan",
    label: "Latihan klinik",
    shortLabel: "Lakukan",
    description: "Uji pengetahuan lewat pasien, simulasi, dan diskusi kasus.",
    detail: "Poli, bangsal, IGD/jaga, neonatologi, mentoring",
  },
  {
    id: "umpan-balik",
    label: "Umpan balik",
    shortLabel: "Buktikan",
    description: "Kunci pengalaman menjadi feedback, portfolio, dan next step.",
    detail: "Mini-CEX, CbD, DOPS, logbook, refleksi",
  },
];

export const MKAR_SUB_CPMK: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "Profesionalisme dan sikap klinis" },
  { id: 2, label: "Anamnesis dan pemeriksaan fisik sesuai usia" },
  { id: 3, label: "Memilih dan menginterpretasi pemeriksaan penunjang" },
  { id: 4, label: "Penalaran klinis berbasis patofisiologi" },
  { id: 5, label: "Diagnosis kerja dan diagnosis banding" },
  { id: 6, label: "Tata laksana rasional rawat jalan dan rawat inap" },
  { id: 7, label: "Antropometri dan interpretasi kurva pertumbuhan" },
  { id: 8, label: "Asuhan nutrisi anak" },
  { id: 9, label: "Imunisasi" },
  { id: 10, label: "Skrining tumbuh kembang dan pubertas" },
  { id: 11, label: "Resusitasi dan kegawatdaruratan anak" },
  { id: 12, label: "Resusitasi dan pemeriksaan bayi baru lahir" },
  { id: 13, label: "Perawatan rutin bayi baru lahir" },
  { id: 14, label: "Edukasi pemeliharaan kesehatan sesuai usia" },
  { id: 15, label: "Edukasi penyakit anak untuk keluarga" },
  { id: 16, label: "Etik kedokteran" },
  { id: 17, label: "Patient safety" },
  { id: 18, label: "Analisis data, tinjauan pustaka, presentasi kasus" },
];

export const MKAR_TARGETS: ReadonlyArray<MkarTarget> = [
  { id: "immunization-im", label: "Imunisasi IM", category: "skill", target: 1, unit: "kali", note: "DPT-kombo atau Hepatitis B" },
  { id: "immunization-oral", label: "Imunisasi oral", category: "skill", target: 1, unit: "kali", note: "OPV" },
  { id: "prescription", label: "Penulisan resep", category: "skill", target: 5, unit: "kasus", note: "Review rasionalitas dan keselamatan" },
  { id: "nutrition-status", label: "Penentuan status nutrisi", category: "skill", target: 5, unit: "kasus", note: "Antropometri dan kurva yang sesuai" },
  { id: "nutrition-care", label: "Asuhan nutrisi bayi/anak", category: "skill", target: 2, unit: "kasus", note: "Rencana sesuai usia dan kondisi" },
  { id: "newborn-care", label: "Penanganan bayi baru lahir", category: "skill", target: 1, unit: "kasus", note: "Termasuk pemeriksaan khusus" },
  { id: "puberty", label: "Penentuan status pubertas", category: "skill", target: 1, unit: "kasus", note: "Stadium Tanner" },
  { id: "kpsp", label: "Skrining perkembangan KPSP", category: "skill", target: 2, unit: "kasus", note: "Catat instrumen dan versi" },
  { id: "cholestasis", label: "Kolestasis", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "diarrhea", label: "Diare", category: "case", target: 3, unit: "kasus", note: "" },
  { id: "iron-deficiency-anemia", label: "Anemia defisiensi besi", category: "case", target: 2, unit: "kasus", note: "" },
  { id: "thalassemia", label: "Thalasemia", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "dengue", label: "Demam dengue/DBD", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "measles", label: "Campak", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "typhoid", label: "Demam tifoid", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "asthma", label: "Asma", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "shock", label: "Syok", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "uti", label: "Infeksi saluran kemih", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "neonatal-jaundice", label: "Ikterus neonatorum", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "cns-infection", label: "Infeksi susunan saraf pusat", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "seizure", label: "Kejang", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "tb", label: "Tuberkulosis", category: "case", target: 1, unit: "kasus", note: "" },
  { id: "pneumonia", label: "Pneumonia", category: "case", target: 2, unit: "kasus", note: "" },
  { id: "acute-upper-respiratory", label: "ISPA atas akut", category: "case", target: 1, unit: "kasus", note: "Selesma/rinitis/faringitis/tonsilitis" },
  { id: "congenital-heart-disease", label: "Penyakit jantung bawaan", category: "case", target: 1, unit: "kasus", note: "" },
];

export const MKAR_ASSESSMENTS: ReadonlyArray<MkarAssessment> = [
  { id: "mini-cex", label: "Mini-CEX", kind: "formatif", weight: "0%", required: "3 kali", agentId: "exam", description: "Observasi anamnesis, pemeriksaan fisik, keputusan klinis, konseling, dan profesionalisme." },
  { id: "laporan-jaga", label: "Laporan jaga", kind: "formatif", weight: "0%", required: "Minimal 1", agentId: "lapjag", description: "Kasus kegawatdaruratan yang dirapikan dari fakta terdokumentasi." },
  { id: "cbd", label: "Case-based discussion", kind: "sumatif", weight: "10%", required: "2 kali", agentId: "case", description: "Pasien pribadi dipantau longitudinal dan didiskusikan bersama supervisor." },
  { id: "dops", label: "DOPS", kind: "sumatif", weight: "10%", required: "2 kali", agentId: "exam", description: "Antropometri wajib dan prosedur pilihan dengan observasi langsung." },
  { id: "case-presentation", label: "Presentasi kasus", kind: "sumatif", weight: "10%", required: "1 kali", agentId: "evidence", description: "Naskah, tinjauan pustaka, analisis kasus, dan daftar pustaka." },
  { id: "mcq", label: "Ujian tulis / MCQ", kind: "sumatif", weight: "20%", required: "1 kali", agentId: "study", description: "Latihan retrieval berdasarkan blueprint Sub-CPMK dan error log." },
  { id: "osce", label: "OSCE", kind: "sumatif", weight: "20%", required: "1 kali", agentId: "exam", description: "Latihan station, timebox, checklist, dan feedback yang dapat ditindaklanjuti." },
  { id: "oral", label: "Ujian lisan / pasien", kind: "sumatif", weight: "30%", required: "1 kali", agentId: "case", description: "Latihan memeriksa pasien, menulis status, dan mempertahankan clinical reasoning." },
];

export const MKAR_CLINICAL_TOPIC_GROUPS = [
  { label: "Tumbuh kembang & pencegahan", topics: "Antropometri · nutrisi · ASI · imunisasi · KPSP · pubertas" },
  { label: "Neonatologi", topics: "Bayi baru lahir · ikterus · sepsis · BBLR · resusitasi" },
  { label: "Kedaruratan", topics: "Syok · kejang · sesak · koma · gagal jantung · KAD" },
  { label: "Penyakit anak umum", topics: "Diare · pneumonia · asma · TB · ISK · anemia · DBD" },
] as const;
