import { KoasisQuestionFlow, type KoasisFlowField } from "./KoasisQuestionFlow";

export type CaseBriefValues = {
  alias: string;
  complaint: string;
  history: string;
  exam: string;
  investigations: string;
  question: string;
};

type KoasisCaseBriefProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
};

const CASE_FIELDS: KoasisFlowField[] = [
  { key: "alias", label: "Apa alias pasiennya?", hint: "Gunakan alias, bukan nama atau nomor rekam medis.", placeholder: "Contoh: P-07" },
  { key: "complaint", label: "Apa keluhan utamanya?", placeholder: "Alasan utama pasien datang atau dirawat.", rows: 2 },
  { key: "history", label: "Apa riwayat atau konteks pentingnya?", placeholder: "Kronologi, riwayat relevan, obat/alergi yang terdokumentasi…", rows: 3 },
  { key: "exam", label: "Apa temuan pemeriksaannya?", placeholder: "Temuan atau tanda vital yang tersedia…", rows: 3 },
  { key: "investigations", label: "Apa pemeriksaan penunjangnya?", placeholder: "Lab, imaging, atau evidence lain…", rows: 3 },
  { key: "question", label: "Output apa yang kamu butuhkan?", placeholder: "Contoh: buat ringkasan visite dan daftar hal yang perlu saya klarifikasi", rows: 2 },
];

function buildCasePrompt(values: Record<string, string>): string {
  const sections = [
    ["Alias pasien", values.alias],
    ["Keluhan utama", values.complaint],
    ["Riwayat / konteks", values.history],
    ["Pemeriksaan", values.exam],
    ["Pemeriksaan penunjang", values.investigations],
    ["Pertanyaan atau output yang dibutuhkan", values.question],
  ];
  return `Bantu saya merapikan case brief berikut menjadi struktur yang bisa direview. Bedakan fakta yang terdokumentasi, bagian yang belum ada, pertanyaan klinis, dan next step belajar. Jangan mengisi data yang kosong dan jangan membuat diagnosis atau terapi final.\n\n${sections.map(([label, value]) => `${label}: ${value?.trim() || "(belum diisi)"}`).join("\n")}`;
}

export function KoasisCaseBrief({ open, busy, onClose, onSubmit }: KoasisCaseBriefProps) {
  return <KoasisQuestionFlow open={open} busy={busy} resetKey="case-brief" eyebrow="Case workspace" title="Buat case brief" description="Bangun ringkasan kasus sedikit demi sedikit, lalu kirim sebagai draft yang bisa kamu review." glyph="case" note="Gunakan alias, bukan nama atau nomor rekam medis. Draft hanya dikirim ketika kamu menekan tombol mulai." fields={CASE_FIELDS} submitLabel="Kirim ke Koasis" buildPrompt={buildCasePrompt} onClose={onClose} onSubmit={onSubmit} />;
}
