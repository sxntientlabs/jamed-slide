import { useMemo } from "react";
import { KoasisQuestionFlow, type KoasisFlowField } from "./KoasisQuestionFlow";
import type { KoasisGlyphName } from "./KoasisGlyph";

export type KoasisWorkflowKind = "visite" | "study" | "handover" | "exam" | "guideline" | "evidence";

type WorkflowValues = Record<string, string>;

type KoasisWorkflowDialogProps = {
  open: boolean;
  busy: boolean;
  kind: KoasisWorkflowKind;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
};

const WORKFLOW_COPY: Record<KoasisWorkflowKind, {
  eyebrow: string;
  title: string;
  description: string;
  glyph: KoasisGlyphName;
  fields: KoasisFlowField[];
}> = {
  visite: {
    eyebrow: "Before rounds",
    title: "Siapkan visite",
    description: "Buat rencana yang bisa kamu bawa ke bangsal: prioritas, pertanyaan, pemeriksaan, dan follow-up.",
    glyph: "workflow",
    fields: [
      { key: "target", label: "Apa fokus visite kali ini?", hint: "Ruangan, kelompok pasien, atau tujuan utama.", placeholder: "Contoh: pasien baru di bangsal anak", required: true },
      { key: "priority", label: "Apa yang paling perlu dicek atau diklarifikasi?", placeholder: "Tulis prioritas yang sudah kamu tahu…", rows: 2 },
      { key: "known", label: "Data awal apa yang sudah tersedia?", placeholder: "Tulis data yang sudah terdokumentasi. Jangan masukkan nama atau nomor rekam medis.", rows: 3 },
      { key: "output", label: "Output apa yang ingin kamu bawa?", placeholder: "Contoh: checklist singkat dan pertanyaan untuk supervisor", rows: 2 },
    ],
  },
  study: {
    eyebrow: "Learning loop",
    title: "Buat study sprint",
    description: "Ubah learning gap menjadi satu sesi belajar yang realistis, dengan recall dan latihan klinis.",
    glyph: "study",
    fields: [
      { key: "topic", label: "Topik atau learning gap apa yang ingin kamu kuasai?", hint: "Satu topik agar sesi tetap fokus.", placeholder: "Contoh: pendekatan sesak pada anak", required: true },
      { key: "level", label: "Sejauh apa pemahamanmu saat ini?", placeholder: "Contoh: baru paham definisi, belum bisa menyusun pendekatan", rows: 2 },
      { key: "time", label: "Berapa waktu yang tersedia?", placeholder: "Contoh: 25 menit malam ini" },
      { key: "output", label: "Output akhir seperti apa yang kamu butuhkan?", placeholder: "Contoh: 5 pertanyaan recall dan satu algoritme ringkas", rows: 2 },
    ],
  },
  handover: {
    eyebrow: "After shift",
    title: "Susun handover I-PASS",
    description: "Rapikan handoff menjadi lima bagian yang konsisten dan tutup dengan synthesis by receiver.",
    glyph: "clinical",
    fields: [
      { key: "severity", label: "Bagaimana illness severity pasien?", hint: "Pilih sesuai penilaian tim; jangan menebak.", placeholder: "", required: true, options: [{ value: "belum ditentukan", label: "Belum ditentukan" }, { value: "stabil", label: "Stabil" }, { value: "watcher", label: "Watcher / perlu perhatian" }, { value: "unstable", label: "Tidak stabil" }] },
      { key: "summary", label: "Apa patient summary yang perlu diteruskan?", hint: "Gunakan alias, bukan identitas langsung.", placeholder: "Ringkasan masalah, perjalanan klinis, dan keadaan terkini yang terdokumentasi.", rows: 3, required: true },
      { key: "actions", label: "Apa action list yang masih terbuka?", placeholder: "Tugas, pemantauan, dan siapa yang bertanggung jawab.", rows: 3 },
      { key: "contingency", label: "Apa yang perlu diwaspadai dan kapan eskalasi?", placeholder: "Situation awareness & contingency planning.", rows: 3 },
      { key: "synthesis", label: "Apa yang harus dibacakan ulang oleh penerima?", placeholder: "Poin untuk synthesis by receiver dan konfirmasi.", rows: 2 },
    ],
  },
  exam: {
    eyebrow: "Clinical skills",
    title: "Pemeriksaan & skoring",
    description: "Siapkan teknik pemeriksaan atau hitung skor secara transparan dari rubric dan nilai yang benar-benar tersedia.",
    glyph: "exam",
    fields: [
      { key: "task", label: "Bantuan seperti apa yang kamu butuhkan?", placeholder: "", required: true, options: [{ value: "checklist", label: "Checklist pemeriksaan" }, { value: "score", label: "Hitung scoring system" }, { value: "osce", label: "Latihan OSCE" }] },
      { key: "topic", label: "Pemeriksaan atau nama skor apa yang dipakai?", hint: "Sebutkan nama dan versi jika meminta skor.", placeholder: "Contoh: pemeriksaan neurologis ekstremitas / CURB-65", required: true },
      { key: "context", label: "Apa konteks pasiennya?", placeholder: "Usia, setting, keluhan, dan keterbatasan yang relevan. Gunakan alias.", rows: 2 },
      { key: "measured", label: "Nilai apa yang sudah diukur?", placeholder: "Tuliskan tiap komponen dan nilainya. Biarkan kosong jika belum diperiksa.", rows: 3 },
      { key: "rubric", label: "Rubric atau sumber apa yang dipakai?", hint: "Wajib untuk perhitungan skor.", placeholder: "Nama guideline, versi, atau tempel kriteria yang digunakan.", rows: 2 },
    ],
  },
  guideline: {
    eyebrow: "Diagnostic criteria",
    title: "Cek kriteria guideline",
    description: "Petakan pertanyaan klinis ke guideline yang jelas—organisasi, versi, populasi, dan batas penerapannya.",
    glyph: "guideline",
    fields: [
      { key: "question", label: "Pertanyaan klinis apa yang ingin dijawab?", placeholder: "Diagnosis atau kriteria apa yang ingin dinilai?", required: true },
      { key: "population", label: "Siapa populasinya dan di setting mana?", placeholder: "Usia, layanan primer/IGD/bangsal, komorbid penting.", rows: 2 },
      { key: "documented", label: "Data apa yang sudah terdokumentasi?", placeholder: "Temuan yang akan dipetakan ke setiap kriteria. Gunakan alias.", rows: 3 },
      { key: "source", label: "Guideline apa yang tersedia?", hint: "Tulis organisasi, judul, versi, dan tahun atau lampirkan sumber di composer.", placeholder: "Contoh: WHO / IDAI / PERKI, judul, versi/tahun.", rows: 2 },
      { key: "output", label: "Output seperti apa yang kamu butuhkan?", placeholder: "Contoh: tabel kriteria terpenuhi / belum / tidak diketahui.", rows: 2 },
    ],
  },
  evidence: {
    eyebrow: "Evidence appraisal",
    title: "Buat evidence brief",
    description: "Tetapkan pertanyaan dan sumber sebelum menilai temuan, relevansi, serta keterbatasannya.",
    glyph: "concept",
    fields: [
      { key: "question", label: "Apa pertanyaan PICO atau fokus review-nya?", placeholder: "Population, intervention/exposure, comparator, outcome.", rows: 2, required: true },
      { key: "decision", label: "Untuk keputusan apa evidence ini dipakai?", placeholder: "Belajar, diskusi kasus, presentasi, atau pertanyaan supervisor?", rows: 2 },
      { key: "sources", label: "Sumber apa yang sudah tersedia?", hint: "Lampirkan file di composer setelah form ini bila perlu.", placeholder: "Judul, DOI/URL, organisasi, atau nama file sumber.", rows: 3 },
      { key: "output", label: "Format output seperti apa yang kamu butuhkan?", placeholder: "Contoh: tabel populasi–hasil–keterbatasan dan take-home message.", rows: 2 },
    ],
  },
};

function buildWorkflowPrompt(kind: KoasisWorkflowKind, values: WorkflowValues): string {
  const copy = WORKFLOW_COPY[kind];
  const body = copy.fields.map((field) => `${field.label}: ${values[field.key]?.trim() || "(belum diisi)"}`).join("\n");
  const rules: Record<KoasisWorkflowKind, string> = {
    visite: "Susun menjadi: tujuan visite, prioritas, pertanyaan yang perlu diklarifikasi, checklist data/pemeriksaan, dan follow-up. Tandai bagian yang belum ada.",
    study: "Susun menjadi: learning objective, recall awal, penjelasan inti, latihan klinis singkat, dan exit ticket. Jangan mengarang guideline atau angka; tandai hal yang perlu dibaca dari sumber.",
    handover: "Susun I-PASS: illness severity, patient summary, action list, situation awareness & contingency planning, dan synthesis by receiver. Bedakan fakta dari hal yang perlu diverifikasi. Jangan membuat diagnosis atau instruksi terapi baru.",
    exam: "Jika checklist: tampilkan persiapan/consent, posisi, urutan teknik, temuan yang dicari, dan stop/escalation condition. Jika skor: tampilkan rubric/versi, setiap komponen, nilai yang tersedia, komponen kosong, aritmetika, dan batas interpretasi. Jangan mengarang temuan atau nilai.",
    guideline: "Tulis sumber/versi/populasi terlebih dahulu, lalu petakan setiap kriteria menjadi terpenuhi, tidak terpenuhi, atau belum diketahui. Jika sumber belum tersedia, buat rencana verifikasi dan jangan menyatakan kesimpulan guideline.",
    evidence: "Susun pertanyaan PICO, provenance setiap sumber, desain/populasi, temuan utama, keterbatasan, relevansi, dan bagian yang belum bisa disimpulkan. Jangan mengarang sitasi atau angka.",
  };
  return `Saya ingin menggunakan workflow Koasis: ${copy.title}.\n\n${body}\n\nInstruksi output: ${rules[kind]}\nGunakan bahasa Indonesia yang ringkas dan actionable untuk koas. Jangan mengisi data yang kosong dan jangan menuliskan identitas pasien langsung.`;
}

export function KoasisWorkflowDialog({ open, busy, kind, onClose, onSubmit }: KoasisWorkflowDialogProps) {
  const copy = useMemo(() => WORKFLOW_COPY[kind], [kind]);
  const initialValues = useMemo(() => Object.fromEntries(copy.fields.filter((field) => field.key === "severity").map((field) => [field.key, "belum ditentukan"])), [copy.fields]);
  return <KoasisQuestionFlow open={open} busy={busy} resetKey={`workflow-${kind}`} eyebrow={copy.eyebrow} title={copy.title} description={copy.description} glyph={copy.glyph} note="Isi yang kamu punya saja. Koasis akan mempertahankan bagian yang belum terdokumentasi untuk direview." fields={copy.fields} initialValues={initialValues} buildPrompt={(values) => buildWorkflowPrompt(kind, values)} onClose={onClose} onSubmit={onSubmit} />;
}
