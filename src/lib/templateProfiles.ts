import type {
  ParsedTemplate,
  TemplateAnalysis,
  TemplateFieldGroup,
  TemplateFieldSpec,
  TemplateProfile,
  TemplateShiftField,
  TemplateSlideGuide,
  TemplateSlideInclusion,
  TemplateSlidePatientScope,
  SlideRole,
} from "../types";

type TemplateProfileSource = Pick<ParsedTemplate, "name" | "fileName" | "profileId"> & Partial<Pick<ParsedTemplate, "slides" | "bindings" | "templateAnalysis">>;

const field = (
  key: string,
  label: string,
  options: Omit<TemplateFieldSpec, "key" | "label"> = {},
): TemplateFieldSpec => ({ key, label, ...options });

const LAPJAG_GROUPS: TemplateFieldGroup[] = [
  {
    id: "identity",
    label: "Identitas & antropometri",
    description: "Data yang masuk ke cover pasien, tabel pasien, identitas, dan grafik pertumbuhan WHO.",
    fields: [
      field("identifiers.initials", "Inisial / nama ringkas", { placeholder: "Contoh: By. A / A.S.", required: true }),
      field("demographics.age", "Usia", { placeholder: "Contoh: 18 bulan / 5 tahun", required: true }),
      field("demographics.sex", "Jenis kelamin", { placeholder: "Laki-laki / Perempuan", required: true }),
      field("urgency", "Kegawatan (T/F)", { placeholder: "T atau F", required: true }),
      field("chiefComplaint", "Keluhan utama", { placeholder: "Keluhan utama saat datang", multiline: true }),
      field("demographics.weightKg", "Berat badan (kg)", { placeholder: "Contoh: 8,5", inputMode: "numeric" }),
      field("demographics.heightCm", "Panjang / tinggi badan (cm)", { placeholder: "Contoh: 72", inputMode: "numeric" }),
      field("templateData.weightBeforeIllness", "BB sebelum sakit", { placeholder: "Jika tercatat" }),
    ],
  },
  {
    id: "surveys",
    label: "PAT, primary survey & secondary survey",
    description: "Pisahkan temuan sesuai kotak template agar tidak tercampur antara PAT, ABCDE, dan AMPLE.",
    fields: [
      field("templateData.patBehaviour", "PAT · Behaviour / Tonus", { placeholder: "Aktif, lemah, hipotonia, dll." }),
      field("templateData.patInteractiveness", "PAT · Interactiveness", { placeholder: "Interaktif / tidak interaktif" }),
      field("templateData.patConsolability", "PAT · Consolability", { placeholder: "Mudah / sulit ditenangkan" }),
      field("templateData.patLookOrGaze", "PAT · Look or gaze", { placeholder: "Kontak mata / tatapan" }),
      field("templateData.patBreathing", "PAT · Breathing", { placeholder: "Pola napas / distress" }),
      field("templateData.patRetraction", "PAT · Retraksi", { placeholder: "Ada / tidak ada; lokasi" }),
      field("templateData.patNasalFlaring", "PAT · Nafas cuping hidung", { placeholder: "Ada / tidak ada" }),
      field("templateData.patAddedBreathSounds", "PAT · Suara napas tambahan", { placeholder: "Stridor / wheezing / ronki / tidak ada" }),
      field("templateData.patAbnormalPosition", "PAT · Posisi abnormal", { placeholder: "Ada / tidak ada" }),
      field("templateData.primarySurvey", "Primary survey · ABCDE", { placeholder: "Airway; Breathing; Circulation; Disability; Exposure", multiline: true }),
      field("templateData.secondarySurvey", "Secondary survey · AMPLE", { placeholder: "Allergy; Medication; Past illness; Last meal; Event", multiline: true }),
      field("templateData.lastMeal", "AMPLE · Last meal", { multiline: true }),
      field("templateData.event", "AMPLE · Event", { multiline: true }),
    ],
  },
  {
    id: "history-exam",
    label: "Anamnesis & pemeriksaan",
    description: "RPS/RPD dan riwayat penting dipisahkan dari temuan objektif pemeriksaan fisik.",
    fields: [
      field("history.presentIllness", "RPS / riwayat penyakit sekarang", { multiline: true }),
      field("history.pastMedicalHistory", "RPD / riwayat penyakit dahulu", { multiline: true }),
      field("history.medicationHistory", "Riwayat obat", { multiline: true }),
      field("history.allergyHistory", "Alergi", { multiline: true }),
      field("history.birthHistory", "Riwayat lahir / persalinan", { multiline: true }),
      field("history.immunizationHistory", "Imunisasi", { multiline: true }),
      field("history.familyHistory", "Riwayat keluarga", { multiline: true }),
      field("history.nutritionHistory", "Riwayat nutrisi", { multiline: true }),
      field("history.socioeconomicHistory", "Riwayat sosioekonomi", { multiline: true }),
      field("physicalExam.generalAppearance", "Keadaan umum", { multiline: true }),
      field("physicalExam.consciousness", "Kesadaran / GCS"),
      field("physicalExam.vitalSigns.bloodPressure", "Tekanan darah"),
      field("physicalExam.vitalSigns.heartRate", "Nadi", { inputMode: "numeric" }),
      field("physicalExam.vitalSigns.respiratoryRate", "Laju napas", { inputMode: "numeric" }),
      field("physicalExam.vitalSigns.temperature", "Suhu", { inputMode: "numeric" }),
      field("physicalExam.vitalSigns.spo2", "SpO₂", { inputMode: "numeric" }),
      field("physicalExam.findings", "Temuan pemeriksaan fisik", { multiline: true }),
      field("templateData.organFindingsNote", "Temuan pemeriksaan per organ", { multiline: true }),
    ],
  },
  {
    id: "assessment-management",
    label: "Penunjang, diagnosis & tata laksana",
    description: "Bedakan diagnosis awal/final, hasil penunjang, dan intervensi yang dilakukan selama jaga.",
    fields: [
      field("investigations.laboratory", "Laboratorium", { multiline: true, placeholder: "Parameter: hasil unit; tuliskan nilai abnormal" }),
      field("investigations.imaging", "Radiologi / imaging", { multiline: true }),
      field("templateData.radiologyInterpretation", "Interpretasi radiologi", { multiline: true }),
      field("templateData.initialDiagnosis", "Diagnosis awal", { multiline: true }),
      field("assessment.workingDiagnosis", "Diagnosis kerja", { multiline: true }),
      field("assessment.differentialDiagnosis", "Diagnosis banding", { multiline: true }),
      field("templateData.finalDiagnosis", "Diagnosis final", { multiline: true }),
      field("templateData.initialManagement", "Tata laksana awal", { multiline: true }),
      field("management.medications", "Obat", { multiline: true }),
      field("management.fluids", "Cairan", { multiline: true }),
      field("management.procedures", "Tindakan", { multiline: true }),
      field("management.oxygenTherapy", "Terapi oksigen", { multiline: true }),
      field("templateData.finalManagement", "Tata laksana akhir / respons", { multiline: true }),
      field("templateData.nutritionManagement", "Tata laksana nutrisi", { multiline: true }),
      field("disposition", "Disposisi", { multiline: true }),
    ],
  },
];

const shiftField = (key: string, label: string, placeholder: string, required = false): TemplateShiftField => ({ key, label, placeholder, required });

const guide = (
  index: number,
  label: string,
  role: SlideRole,
  fields: string[],
  instructions: string,
  repeat = true,
  speakerNote?: string,
  inclusion: TemplateSlideInclusion = "routine",
  include = inclusion === "routine",
  inclusionReason?: string,
  patientScope: TemplateSlidePatientScope = role === "shift_summary" ? "all_patients" : repeat ? "focus_patient" : "static",
): TemplateSlideGuide => ({
  index,
  label,
  role,
  fields,
  instructions,
  repeat,
  speakerNote,
  inclusion,
  include,
  inclusionReason,
  patientScope,
});

const mainLapjagShiftFields = [
  shiftField("team", "Tim mahasiswa jaga", "Nama tim / mahasiswa", true),
  shiftField("facilitator", "Fasilitator Laporan Jaga", "Nama fasilitator", true),
  shiftField("dpjp", "DPJP Jaga", "Nama DPJP", true),
];

const MAIN_LAPJAG_GUIDES: TemplateSlideGuide[] = [
  guide(0, "Cover", "cover", ["shift.date", "shift.team", "shift.facilitator", "shift.dpjp"], "Ambil hari/tanggal jaga dan tiga peran cover secara terpisah." , false),
  guide(1, "Tabel pasien", "shift_summary", ["shift.patientSummaryTable"], "Satu baris per pasien; nama/inisial, jenis kelamin, usia, diagnosis, dan kegawatan T/F.", false),
  guide(2, "Identitas pasien", "patient_identity", ["patient.identityBlock", "patient.chiefComplaint"], "Ulangi untuk setiap pasien."),
  guide(3, "Pediatric Assessment Triangle", "pediatric_assessment", ["patient.pediatricAssessmentBlock"], "Pisahkan tampilan umum, napas, sirkulasi, dan kesan kegawatan."),
  guide(4, "Primary survey", "primary_survey", ["patient.primarySurveyBlock"], "Pertahankan urutan ABCDE."),
  guide(5, "Secondary survey", "secondary_survey", ["patient.secondarySurveyBlock", "patient.templateData.lastMeal", "patient.templateData.event"], "Pertahankan AMPLE: Allergy, Medication, Past illness, Last meal, Event; jangan mengganti Last meal/Event dengan riwayat keluarga."),
  guide(6, "Riwayat penyakit sekarang", "anamnesis", ["patient.history.presentIllness"], "Tulis kronologi klinis, bukan diagnosis yang belum disebut sumber."),
  guide(7, "Riwayat dahulu, kelahiran & keluarga", "history", ["patient.historyBlock"], "Pisahkan riwayat dahulu, kelahiran, keluarga, dan terapi sebelumnya."),
  guide(8, "Imunisasi, nutrisi & sosioekonomi", "history", ["patient.history.immunizationHistory", "patient.history.nutritionHistory", "patient.history.socioeconomicHistory"], "Pertahankan tiga panel riwayat; jangan menggabungkannya dengan pemeriksaan fisik."),
  guide(9, "Antropometri", "anthropometry", ["patient.anthropometryBlock", "patient.templateSection:nutritionConclusion"], "Gunakan data terukur dan kesimpulan gizi yang benar-benar terdokumentasi saja."),
  guide(10, "WHO length/height-for-age", "anthropometry", ["patient.demographics.heightCm"], "Pilih chart sesuai jenis kelamin dan plot hanya bila usia serta panjang/tinggi tersedia."),
  guide(11, "WHO weight-for-age", "anthropometry", ["patient.demographics.weightKg"], "Plot hanya bila usia, jenis kelamin, dan berat tersedia."),
  guide(12, "WHO weight-for-length", "anthropometry", ["patient.demographics.weightKg", "patient.demographics.heightCm"], "Plot hanya bila berat dan panjang/tinggi tersedia."),
  guide(13, "Pemeriksaan fisis", "physical_exam", ["patient.physicalExam.generalAppearanceBlock", "patient.physicalExam.vitalSignsBlock"], "Pisahkan keadaan umum/kesadaran dari tanda vital; jangan menulis satu blok klinis ke beberapa shape."),
  guide(14, "Organ / deskripsi", "physical_exam", ["patient.physicalExam.organFindings"], "Gunakan alias klinis Thoraks/Dada/Paru agar temuan respirasi tidak hilang."),
  guide(15, "Diagnosis awal", "diagnosis", ["patient.templateSection:initialDiagnosis"], "Isi hanya diagnosis awal yang eksplisit; jangan menggandakan diagnosis kerja bila tidak ada label awal."),
  guide(16, "Tata laksana awal", "management", ["patient.templateSection:initialManagement", "patient.timelineBlock"], "Pisahkan tindakan awal dari timeline dan jangan mengisi tata laksana akhir."),
  guide(17, "Analisis gas darah", "investigation", ["patient.templateSection:bloodGasTable", "patient.investigations.summary"], "Pertahankan parameter dan hasil persis; jangan memetakan BE ke Standard BE tanpa bukti."),
  guide(18, "Pemeriksaan penunjang tambahan · contoh edukatif", "investigation", [], "Slide ini berisi diagram edukatif/sample, bukan data pasien. Sertakan hanya bila memang dibutuhkan untuk presentasi.", false, undefined, "example", false, "Diagram edukatif/sample; default tidak disertakan."),
  guide(19, "Laboratorium rutin", "investigation", ["patient.investigations.laboratory"], "Gunakan alias parameter seperti Ht/Hematokrit dan pertahankan unit."),
  guide(20, "Laboratorium diferensial", "investigation", ["patient.investigations.laboratory"], "Bedakan nilai persentase dari hitung absolut; jangan memindahkan nilai antarparameter."),
  guide(21, "Radiologi", "investigation", ["patient.investigations.imaging", "patient.templateData.radiologyInterpretation"], "Tampilkan hasil/interpretasi radiologi pasien, bukan teks sample template."),
  guide(22, "Diagnosis akhir", "diagnosis", ["patient.templateSection:finalDiagnosis"], "Jika diagnosis akhir tidak terdokumentasi, biarkan kosong/missing; jangan menyalin diagnosis kerja."),
  guide(23, "Tata laksana akhir", "management", ["patient.templateSection:finalManagement", "patient.managementTable"], "Jangan membawa terapi awal ke tabel akhir tanpa dokumentasi respons atau rencana akhir."),
  guide(24, "Nutrisi", "management", ["patient.nutritionBlock"], "Jangan mempertahankan label gizi buruk dari sample jika data pasien menyatakan cukup gizi."),
  guide(25, "Nutrisi · lanjutan", "management", ["patient.nutritionBlock"], "Hindari duplikasi riwayat dan tata laksana nutrisi bila template memiliki dua panel."),
  guide(26, "Penutup", "closing", [], "Pertahankan slide penutup.", false),
];

const PERINA_GROUPS: TemplateFieldGroup[] = [
  {
    id: "perina-identity",
    label: "Identitas neonatus",
    description: "Field yang mengisi identitas per pasien, usia gestasi, berat lahir, dan alamat.",
    fields: [
      field("identifiers.name", "Nama / inisial bayi", { required: true }),
      field("demographics.sex", "Jenis kelamin", { required: true }),
      field("demographics.age", "Usia / hari perawatan", { required: true }),
      field("templateData.gestationalAge", "Usia gestasi", { placeholder: "Contoh: 34 minggu" }),
      field("templateData.birthWeight", "Berat lahir", { placeholder: "Gram", inputMode: "numeric" }),
      field("identifiers.medicalRecordNumber", "No. RM"),
      field("templateData.address", "Alamat", { multiline: true }),
      field("chiefComplaint", "Keluhan utama", { multiline: true }),
    ],
  },
  {
    id: "perina-history",
    label: "Anamnesis perinatologi",
    description: "Jaga konteks konsultasi antenatal, USG, persalinan, penyakit, keluarga, dan persiapan persalinan tetap terpisah.",
    fields: [
      field("templateData.antenatalConsultation", "Konsultasi antenatal", { multiline: true }),
      field("templateData.fetomaternalUltrasound", "USG fetomaternal", { multiline: true }),
      field("templateData.previousDeliveries", "Riwayat persalinan sebelumnya", { multiline: true }),
      field("history.pastMedicalHistory", "Riwayat penyakit dahulu", { multiline: true }),
      field("history.familyHistory", "Riwayat penyakit keluarga", { multiline: true }),
      field("templateData.deliveryPreparation", "Persiapan pertolongan persalinan", { multiline: true }),
    ],
  },
  {
    id: "perina-newborn",
    label: "Resusitasi, stabilisasi & pemeriksaan",
    description: "Pertahankan timeline resusitasi, S.T.A.B.L.E., antropometri, pemeriksaan fisis, dan organ.",
    fields: [
      field("templateData.neonatalBirthProcess", "Proses persalinan", { multiline: true }),
      field("templateData.resuscitationTimeline", "Timeline resusitasi neonatus", { multiline: true }),
      field("templateData.stableStabilization", "Stabilisasi S.T.A.B.L.E.", { multiline: true }),
      field("templateData.stableConclusion", "Kesan stabilisasi", { multiline: true }),
      field("demographics.weightKg", "Berat badan", { inputMode: "numeric" }),
      field("demographics.heightCm", "Panjang / tinggi badan", { inputMode: "numeric" }),
      field("templateData.headCircumference", "Lingkar kepala", { inputMode: "numeric" }),
      field("templateData.ballardScore", "Ballard score"),
      field("templateData.neonatalAnthropometryConclusion", "Kesan antropometri", { multiline: true }),
      field("physicalExam.generalAppearance", "Keadaan umum", { multiline: true }),
      field("templateData.neonatalVitals", "Tanda vital", { multiline: true }),
      field("templateData.organFindingsNote", "Temuan organ", { multiline: true }),
    ],
  },
  {
    id: "perina-plan",
    label: "Diagnosis, penunjang & tata laksana",
    description: "Pisahkan diagnosis ICD-10, laboratorium, radiologi, dan tata laksana neonatus.",
    fields: [
      field("templateData.initialDiagnosis", "Diagnosis ICD-10", { multiline: true }),
      field("investigations.laboratory", "Laboratorium", { multiline: true }),
      field("investigations.imaging", "Radiologi", { multiline: true }),
      field("templateData.neonatalManagement", "Tata laksana neonatus", { multiline: true }),
    ],
  },
];

const PERINA_GUIDES = (rsab = false): TemplateSlideGuide[] => [
  guide(0, "Cover", "cover", ["shift.date", "shift.student", ...(rsab ? [] : ["shift.perinaTeam"]), "shift.dpjp"], "Ambil tanggal, mahasiswa, dan DPJP cover. Template PERINA Lapjag juga memiliki Tim Jaga Perinatologi.", false),
  guide(1, "Identitas & keluhan utama", "patient_identity", ["patient.identityBlock", "patient.chiefComplaint"], "Ulangi untuk setiap pasien; isi field neonatus secara terpisah."),
  guide(2, "Konsultasi antenatal & USG fetomaternal", "consultation", ["patient.templateSection:antenatalConsultation", "patient.templateSection:fetomaternalUltrasound"], "Isi dua panel terpisah. Evidence gambar/PDF boleh menjadi sumber.") ,
  guide(3, "Riwayat obstetri, penyakit & keluarga", "history", ["patient.templateSection:previousDeliveries", "patient.history.pastMedicalHistory", "patient.history.familyHistory"], "Jangan gabungkan tiga riwayat ke satu narasi."),
  guide(4, "Persiapan pertolongan persalinan", "delivery_preparation", ["patient.templateSection:deliveryPreparation"], "Isi persiapan yang benar-benar tertulis di sumber."),
  guide(5, "Resusitasi neonatus", "resuscitation", ["patient.templateSection:neonatalBirthProcess", "patient.templateSection:resuscitationTimeline"], "Pertahankan baris waktu 0, 1, 3, 5, 10, 15 menit dan kolom klinisnya."),
  guide(6, "Stabilisasi S.T.A.B.L.E.", "stabilization", ["patient.templateSection:stableStabilization", "patient.templateSection:stableConclusion"], "Tulis Safe care & sugar, Temperature, Airway, Blood pressure/CRT/nadi, Lab works, Emotional support, lalu kesan."),
  guide(7, "Status antropometri neonatus", "anthropometry", ["patient.anthropometryBlock", "patient.templateData.ballardScore"], "Pertahankan chart preterm bawaan; jangan menggantinya dengan chart WHO anak 0–5 tahun."),
  guide(8, "Pemeriksaan fisis & tanda vital", "physical_exam", ["patient.physicalExam.generalAppearance", "patient.templateData.neonatalVitals"], "Nilai abnormal tetap diberi konteks; jangan membuat nilai baru."),
  guide(9, "Pemeriksaan organ", "physical_exam", ["patient.physicalExam.organFindings"], "Isi tabel ORGAN/DESKRIPSI; contoh bawaan template bukan data pasien."),
  guide(10, "Diagnosis ICD-10", "diagnosis", ["patient.templateData.initialDiagnosis"], "Masukkan diagnosis yang sumberkan saja."),
  guide(11, "Laboratorium", "investigation", ["patient.investigations.laboratory", "patient.investigations.summary"], "Isi hasil, unit, nilai rujukan bila tersedia."),
  guide(12, "Radiologi", "investigation", ["patient.investigations.imaging"], "Jika tidak ada, tulis Tidak tercantum; jangan menghapus struktur template."),
  guide(13, "Tata laksana", "management", ["patient.templateData.neonatalManagement"], "Pertahankan lima kategori tata laksana pada template."),
  guide(14, "Penutup", "closing", [], "Pertahankan slide penutup.", false),
];

const RSCM_GROUPS: TemplateFieldGroup[] = [
  {
    id: "rscm-cover-summary",
    label: "RSCM · cover & ringkasan pasien",
    description: "Data cover dan tabel pasien baru dipisahkan dari record klinis per pasien.",
    fields: [
      field("identifiers.initials", "Inisial / nama ringkas", { required: true }),
      field("demographics.sex", "Jenis kelamin", { required: true }),
      field("demographics.age", "Usia", { required: true }),
      field("urgency", "Kegawatan (True/False)", { required: true }),
      field("templateData.dateOfBirth", "Tanggal lahir"),
      field("templateData.address", "Alamat", { multiline: true }),
    ],
  },
  {
    id: "rscm-survey",
    label: "RSCM · PAT, primary & secondary survey",
    description: "Konten mengikuti kotak asesmen di slide, bukan satu field anamnesis generik.",
    fields: [
      field("templateData.patBehaviour", "PAT · Behaviour / Tonus"),
      field("templateData.patInteractiveness", "PAT · Interactiveness"),
      field("templateData.patConsolability", "PAT · Consolability"),
      field("templateData.patLookOrGaze", "PAT · Look or gaze"),
      field("templateData.patSpeechCry", "PAT · Speech and cry"),
      field("templateData.patBreathing", "PAT · Breathing"),
      field("templateData.patBodyColour", "PAT · Body colour"),
      field("templateData.primarySurvey", "Primary survey + AMPLE", { multiline: true }),
      field("templateData.secondarySurvey", "Secondary survey / RPS", { multiline: true }),
    ],
  },
  {
    id: "rscm-history-growth",
    label: "RSCM · riwayat & status gizi",
    description: "Riwayat dan ukuran antropometri mengikuti label slide RSCM. Nilai turunan tidak dihitung bila tidak ada.",
    fields: [
      field("history.pastMedicalHistory", "Riwayat penyakit dahulu", { multiline: true }),
      field("history.familyHistory", "Riwayat penyakit keluarga", { multiline: true }),
      field("templateData.pregnancyBirth", "Riwayat kehamilan & kelahiran", { multiline: true }),
      field("history.immunizationHistory", "Riwayat imunisasi", { multiline: true }),
      field("history.nutritionHistory", "Riwayat nutrisi", { multiline: true }),
      field("history.socioeconomicHistory", "Riwayat sosioekonomi", { multiline: true }),
      field("templateData.weightForAge", "BB/U"),
      field("templateData.heightForAge", "TB/U"),
      field("templateData.weightForHeight", "BB/TB"),
      field("templateData.heightAge", "Height age"),
      field("templateData.rda", "RDA"),
      field("templateData.nutritionConclusion", "Kesan gizi / perawakan", { multiline: true }),
    ],
  },
  {
    id: "rscm-plan",
    label: "RSCM · diagnosis, penunjang & tata laksana",
    description: "Diagnosis dan tata laksana awal/akhir tetap dibedakan.",
    fields: [
      field("templateData.initialDiagnosis", "Diagnosis awal + ICD-10", { multiline: true }),
      field("templateData.initialManagement", "Tata laksana awal", { multiline: true }),
      field("templateData.supportingInvestigations", "Pemeriksaan penunjang", { multiline: true }),
      field("templateData.finalDiagnosis", "Diagnosis akhir + ICD-10", { multiline: true }),
      field("templateData.finalManagement", "Tata laksana akhir", { multiline: true }),
    ],
  },
];

const RSCM_GUIDES: TemplateSlideGuide[] = [
  guide(0, "Cover", "cover", ["shift.date", "shift.team", "shift.ppds", "shift.dpjp"], "Isi hari/tanggal, tim mahasiswa, tim PPDS, dan DPJP.", false),
  guide(1, "Pasien baru", "shift_summary", ["shift.patientSummaryTable"], "Maksimum lima baris tersedia di sumber template; tampilkan peringatan bila pasien lebih dari lima, jangan diam-diam memotong.", false),
  guide(2, "Identitas pasien", "patient_identity", ["patient.identityBlock", "patient.chiefComplaint"], "Ulangi untuk setiap pasien."),
  guide(3, "Pediatric Assessment Triangle", "pediatric_assessment", ["patient.pediatricAssessmentBlock", "patient.assessment.summary"], "Speaker note: dibaca baik/tidak dan kesimpulan kegawatan saja.", true, "dibaca: baik/tidak saja, jika ada masalah dibacakan KESIMPULAN…. ada kegawatan/tidak"),
  guide(4, "Primary survey + AMPLE", "primary_survey", ["patient.primarySurveyBlock", "patient.assessment.summary"], "Pertahankan Airway–Exposure dan AMPLE dalam satu urutan."),
  guide(5, "Secondary survey / RPS", "secondary_survey", ["patient.secondarySurveyBlock"], "Speaker note: tulis poin-poin penting; ringkas menjadi bullet klinis.", true, "tulis poin-poin penting"),
  guide(6, "Riwayat dahulu, keluarga, kehamilan", "history", ["patient.history.pastMedicalHistory", "patient.history.familyHistory", "patient.templateData.pregnancyBirth"], "Tiga panel terpisah."),
  guide(7, "Imunisasi, nutrisi, sosioekonomi", "history", ["patient.history.immunizationHistory", "patient.history.nutritionHistory", "patient.history.socioeconomicHistory"], "Speaker note: yang dibacakan hanya kesannya.", true, "dibacakan kesannya saja"),
  guide(8, "Status antropometri", "anthropometry", ["patient.anthropometryBlock"], "Tidak ada chart; jangan menghitung BB/U, TB/U, BB/TB, height age, atau RDA yang tidak tersedia."),
  guide(9, "Pemeriksaan fisis", "physical_exam", ["patient.physicalExam.generalAppearanceBlock", "patient.physicalExam.vitalSignsBlock"], "Pisahkan keadaan umum/GCS dari tanda vital."),
  guide(10, "Organ / deskripsi", "physical_exam", ["patient.physicalExam.organFindings"], "Isi tabel organ."),
  guide(11, "Diagnosis awal", "diagnosis", ["patient.templateData.initialDiagnosis"], "Pertahankan ICD-10 bila ada."),
  guide(12, "Tata laksana awal", "management", ["patient.templateData.initialManagement"], "Isi tindakan awal yang terdokumentasi."),
  guide(13, "Pemeriksaan penunjang", "investigation", ["patient.templateData.supportingInvestigations", "patient.investigationsBlock"], "Narasi laboratorium dan radiologi; bukan tabel laboratorium bawaan."),
  guide(14, "Diagnosis akhir", "diagnosis", ["patient.templateData.finalDiagnosis"], "Diagnosis final tetap terpisah dari diagnosis awal."),
  guide(15, "Tata laksana akhir", "management", ["patient.templateData.finalManagement"], "Pertahankan respons/disposisi bila ada."),
  guide(16, "Penutup", "closing", [], "Pertahankan slide penutup.", false),
];

const RSUI_GROUPS: TemplateFieldGroup[] = [
  {
    id: "rsui-identity",
    label: "RSUI · identitas & privasi",
    description: "Isi identitas dasar dan pertahankan instruksi privasi foto pasien.",
    fields: [
      field("identifiers.name", "Nama / inisial", { required: true }),
      field("demographics.age", "Usia", { required: true }),
      field("demographics.sex", "Jenis kelamin", { required: true }),
      field("identifiers.medicalRecordNumber", "Nomor RM"),
      field("templateData.address", "Tempat tinggal", { multiline: true }),
    ],
  },
  {
    id: "rsui-survey",
    label: "RSUI · asesmen gawat & survei",
    description: "Checklist Segitiga Asesmen Gawat Anak, survei primer, sekunder, dan tatalaksana kegawatdaruratan.",
    fields: [
      field("templateData.patBehaviour", "PAT · Tampilan / tonus"),
      field("templateData.patInteractiveness", "PAT · Interaksi / kenyamanan / kontak mata"),
      field("templateData.patSpeechCry", "PAT · Suara / tangisan"),
      field("templateData.patBreathing", "PAT · Upaya napas"),
      field("templateData.patBodyColour", "PAT · Sirkulasi"),
      field("templateData.primarySurvey", "Survei primer", { multiline: true }),
      field("templateData.emergencyManagement", "Tatalaksana kegawatdaruratan", { multiline: true }),
      field("history.presentIllness", "Survei sekunder / RPS", { multiline: true }),
      field("templateData.growthDevelopment", "Riwayat tumbuh kembang", { multiline: true }),
    ],
  },
  {
    id: "rsui-clinical",
    label: "RSUI · antropometri, pemeriksaan & rencana",
    description: "Gunakan mapping spesifik slide RSUI untuk pemeriksaan, penunjang, diagnosis kerja/akhir, dan tata laksana.",
    fields: [
      field("demographics.weightKg", "BB", { inputMode: "numeric" }),
      field("demographics.heightCm", "TB", { inputMode: "numeric" }),
      field("templateData.headCircumference", "Lingkar kepala", { inputMode: "numeric" }),
      field("templateData.muac", "LiLA", { inputMode: "numeric" }),
      field("templateData.weightForAge", "BB/U"),
      field("templateData.heightForAge", "TB/U"),
      field("templateData.weightForHeight", "BB/TB"),
      field("templateData.nutritionConclusion", "Kesimpulan antropometri", { multiline: true }),
      field("physicalExam.generalAppearance", "Keadaan umum", { multiline: true }),
      field("physicalExam.consciousness", "Kesadaran"),
      field("templateData.supportingInvestigations", "Pemeriksaan penunjang", { multiline: true }),
      field("templateData.radiologyInterpretation", "Radiologi & interpretasi", { multiline: true }),
      field("templateData.otherExaminations", "Pemeriksaan lain", { multiline: true }),
      field("assessment.workingDiagnosis", "Diagnosis kerja", { multiline: true }),
      field("templateData.finalDiagnosis", "Diagnosis akhir", { multiline: true }),
      field("templateData.finalManagement", "Tatalaksana", { multiline: true }),
    ],
  },
];

const RSUI_GUIDES: TemplateSlideGuide[] = [
  guide(0, "Cover", "cover", ["shift.date", "shift.presenter"], "Isi nama penyaji dan tanggal.", false),
  guide(1, "Identitas & keluhan utama", "patient_identity", ["patient.identityBlock", "patient.chiefComplaint"], "Jaga instruksi masking foto pasien; foto hanya evidence opsional."),
  guide(2, "Segitiga Asesmen Gawat Anak", "pediatric_assessment", ["patient.pediatricAssessmentBlock", "patient.assessment.summary"], "Checklist tampilan, napas, sirkulasi, lalu kesan."),
  guide(3, "Survei primer", "primary_survey", ["patient.primarySurveyBlock", "patient.assessment.summary"], "Pertahankan ABCDE + AMPLE."),
  guide(4, "Tatalaksana kegawatdaruratan", "management", ["patient.templateData.emergencyManagement"], "Isi tindakan emergensi yang terdokumentasi."),
  guide(5, "Survei sekunder / RPS", "secondary_survey", ["patient.history.presentIllness"], "Tulis narasi RPS yang ringkas."),
  guide(6, "RPD & keluarga", "history", ["patient.history.pastMedicalHistory", "patient.history.familyHistory"], "Dua panel terpisah."),
  guide(7, "Kehamilan/persalinan & imunisasi", "history", ["patient.templateData.pregnancyBirth", "patient.history.immunizationHistory"], "Dua panel terpisah."),
  guide(8, "Nutrisi & tumbuh kembang", "history", ["patient.history.nutritionHistory", "patient.templateData.growthDevelopment"], "Dua panel terpisah."),
  guide(9, "Status antropometri", "anthropometry", ["patient.anthropometryBlock"], "Tidak ada chart; nilai turunan harus berasal dari sumber."),
  guide(10, "Pemeriksaan fisis", "physical_exam", ["patient.physicalExamBlock"], "Pisahkan dua kolom dan tanda vital."),
  guide(11, "Organ / deskripsi", "physical_exam", ["patient.physicalExam.organFindings"], "Isi tabel organ."),
  guide(12, "Diagnosis kerja", "diagnosis", ["patient.assessment.workingDiagnosis"], "Jangan mengubah diagnosis menjadi diagnosis final."),
  guide(13, "Laboratorium & AGD", "investigation", ["patient.investigations.laboratory", "patient.templateData.supportingInvestigations"], "Pertahankan tabel lab dan tabel AGD terpisah."),
  guide(14, "Radiologi", "investigation", ["patient.templateData.radiologyInterpretation"], "Pisahkan radiologi dan interpretasi."),
  guide(15, "Pemeriksaan lain", "investigation", ["patient.templateData.otherExaminations"], "Isi pemeriksaan lain yang tertulis."),
  guide(16, "Diagnosis akhir", "diagnosis", ["patient.templateData.finalDiagnosis"], "Diagnosis akhir tetap terpisah."),
  guide(17, "Tatalaksana", "management", ["patient.templateData.finalManagement"], "Isi rencana/tindakan yang terdokumentasi."),
  guide(18, "Penutup", "closing", [], "Pertahankan slide penutup.", false),
];

export const LAPJAG_PROFILE: TemplateProfile = {
  id: "lapjag",
  label: "Perina RSAB",
  description: "Form dan schema ekstraksi mengikuti 27 slide Lapjag, termasuk PAT, ABCDE/AMPLE, antropometri, WHO, dan tata laksana.",
  extractionInstructions: [
    "Gunakan kontrak Lapjag: pisahkan identitas, PAT, primary survey ABCDE, secondary survey AMPLE, RPS/RPD, pemeriksaan fisik, penunjang, diagnosis awal/final, dan tata laksana.",
    "Pertahankan istilah klinis dan urutan fakta dari sumber. Jangan memindahkan fakta antarbagian hanya karena tampak masuk akal.",
    "Untuk grafik WHO, ekstrak usia, jenis kelamin, berat badan, dan panjang/tinggi badan hanya jika terdokumentasi. Jangan menghitung atau mengarang z-score.",
    "Kegawatan hanya diisi bila sumber menyebutkan T/F atau padanan yang eksplisit. Nilai abnormal harus tetap menyertakan konteks dan statusnya.",
    "Gambar, scan, dan PDF adalah evidence: baca teks/label/tabel yang terlihat, tetapi tandai bagian yang tidak terbaca sebagai missing, bukan tebakan.",
  ].join(" "),
  fieldGroups: LAPJAG_GROUPS,
  shiftFields: mainLapjagShiftFields,
  slideGuides: MAIN_LAPJAG_GUIDES,
  patientInputHint: "Inisial/nama, usia, jenis kelamin, keluhan, PAT/ABCDE/AMPLE, antropometri, pemeriksaan, lab, diagnosis, dan tata laksana.",
};

const perinaInstructions = (rsab = false): string => [
  "Gunakan kontrak perinatologi 15 slide dan ulangi slide pasien untuk setiap pasien, bukan satu record besar untuk semua pasien.",
  "Pisahkan identitas neonatus, konsultasi antenatal, USG fetomaternal, riwayat persalinan, penyakit dahulu, penyakit keluarga, persiapan persalinan, resusitasi, S.T.A.B.L.E., antropometri, pemeriksaan fisis, organ, diagnosis, laboratorium, radiologi, dan tata laksana.",
  "Pertahankan timeline resusitasi pada titik 0, 1, 3, 5, 10, dan 15 menit. Jangan mengubah hasil atau membuat skor baru.",
  "Chart antropometri neonatus preterm bawaan template harus dipertahankan. Jangan memakai chart WHO anak 0–5 tahun pada template PERINA.",
  "Data gambar, PDF, scan, dan audio adalah evidence multimodal; ekstrak yang terbaca dan tandai bagian yang tidak terbaca sebagai missing.",
  rsab ? "Cover RSAB hanya meminta Mahasiswa dan DPJP IGD; jangan menambahkan Tim Jaga Perinatologi." : "Cover PERINA Lapjag meminta Mahasiswa, Tim Jaga Perinatologi, dan DPJP Perinatologi secara terpisah.",
].join(" ");

export const PERINA_LAPJAG_PROFILE: TemplateProfile = {
  id: "perina-lapjag",
  label: "Perina RSCM",
  description: "Profile khusus 15 slide perinatologi dengan identitas neonatus, resusitasi, S.T.A.B.L.E., chart preterm, dan tabel laboratorium.",
  extractionInstructions: perinaInstructions(false),
  fieldGroups: PERINA_GROUPS,
  shiftFields: [
    shiftField("student", "Mahasiswa", "Nama mahasiswa", true),
    shiftField("perinaTeam", "Tim Jaga Perinatologi", "Nama tim jaga perinatologi", true),
    shiftField("dpjp", "DPJP Perinatologi", "Nama DPJP", true),
  ],
  slideGuides: PERINA_GUIDES(false),
  patientInputHint: "Nama/inisial bayi, jenis kelamin, usia/perawatan, usia gestasi, berat lahir, keluhan, riwayat perinatal, resusitasi, S.T.A.B.L.E., pemeriksaan, lab, diagnosis, dan tata laksana.",
};

export const PERINA_RSAB_PROFILE: TemplateProfile = {
  id: "perina-rsab",
  label: "IGD RSAB",
  description: "Profile khusus 15 slide PERINA RSAB dengan cover Mahasiswa dan DPJP IGD serta alur klinis neonatus yang sama.",
  extractionInstructions: perinaInstructions(true),
  fieldGroups: PERINA_GROUPS,
  shiftFields: [
    shiftField("student", "Mahasiswa", "Nama mahasiswa", true),
    shiftField("dpjp", "DPJP IGD", "Nama DPJP IGD", true),
  ],
  slideGuides: PERINA_GUIDES(true),
  patientInputHint: "Nama/inisial bayi, jenis kelamin, usia/perawatan, usia gestasi, berat lahir, keluhan, riwayat perinatal, resusitasi, S.T.A.B.L.E., pemeriksaan, lab, diagnosis, dan tata laksana.",
};

export const RSCM_PROFILE: TemplateProfile = {
  id: "rscm",
  label: "IGD RSCM",
  description: "Profile 17 slide RSCM: tabel pasien baru, PAT, primary/secondary survey, status gizi, diagnosis awal/akhir, dan tata laksana awal/akhir.",
  extractionInstructions: [
    "Gunakan kontrak RSCM 17 slide. Slide 2 adalah ringkasan seluruh pasien; slide 3–16 diulang per pasien.",
    "Pertahankan pemisahan PAT, primary survey + AMPLE, secondary survey/RPS, riwayat, antropometri, pemeriksaan organ, diagnosis awal, pemeriksaan penunjang, diagnosis akhir, dan tata laksana akhir.",
    "Kegawatan pada tabel pasien harus dinormalisasi menjadi True/False hanya jika sumber menyatakan T/F atau padanan eksplisit; jangan menyimpulkan dari diagnosis.",
    "Speaker note adalah bagian dari kontrak: PAT dibaca baik/tidak dan kesimpulan kegawatan; secondary survey ditulis sebagai poin penting; riwayat imunisasi/nutrisi/sosial dibaca kesannya saja.",
    "Jangan menghitung nilai antropometri turunan yang tidak ada di sumber. Evidence multimodal tetap diterima.",
  ].join(" "),
  fieldGroups: RSCM_GROUPS,
  shiftFields: [
    shiftField("team", "Tim mahasiswa jaga", "Nama tim mahasiswa", true),
    shiftField("ppds", "Tim PPDS Jaga", "Nama tim PPDS", true),
    shiftField("dpjp", "DPJP Jaga", "Nama DPJP", true),
  ],
  slideGuides: RSCM_GUIDES,
  patientInputHint: "Inisial/jenis kelamin/usia, keluhan, PAT, ABCDE/AMPLE, RPS, riwayat, antropometri, pemeriksaan fisis/organ, penunjang, diagnosis awal/akhir, dan tata laksana.",
};

export const RSUI_PROFILE: TemplateProfile = {
  id: "rsui",
  label: "IGD RSUI",
  description: "Profile 19 slide RSUI: identitas, PAT, survei primer/sekunder, antropometri, pemeriksaan, penunjang lab/AGD, diagnosis, dan tatalaksana.",
  extractionInstructions: [
    "Gunakan kontrak RSUI 19 slide. Slide identitas dan slide klinis diulang per pasien, dengan cover dan penutup tetap statis.",
    "Pertahankan checklist Segitiga Asesmen Gawat Anak, survei primer, tatalaksana kegawatdaruratan, survei sekunder, riwayat kehamilan/imunisasi/nutrisi/tumbuh kembang, antropometri, pemeriksaan, tabel organ, lab/AGD, radiologi, pemeriksaan lain, diagnosis kerja/akhir, dan tatalaksana.",
    "Jangan menganggap instruksi masking foto sebagai data pasien. Foto pasien opsional dan harus diperlakukan sebagai evidence sensitif.",
    "Nilai turunan BB/U, TB/U, BB/TB, atau kesimpulan gizi hanya diisi bila tertulis pada sumber; jangan menghitung atau mengarang.",
    "Evidence multimodal diterima. Pertahankan satuan dan pisahkan hasil laboratorium dari interpretasi radiologi.",
  ].join(" "),
  fieldGroups: RSUI_GROUPS,
  shiftFields: [shiftField("presenter", "Nama penyaji", "Nama penyaji", true)],
  slideGuides: RSUI_GUIDES,
  patientInputHint: "Nama, usia, jenis kelamin, nomor RM, tempat tinggal, keluhan, PAT, survei primer/sekunder, riwayat, antropometri, pemeriksaan, lab/AGD, radiologi, diagnosis, dan tatalaksana.",
};

export const GENERIC_PROFILE: TemplateProfile = {
  id: "generic",
  label: "Template custom · profile umum",
  description: "Template custom memakai catatan klinis per pasien dan mapping slide yang ditemukan saat analisis.",
  extractionInstructions: "Ikuti mapping dan teks sumber template custom. Kelompokkan fakta sesuai konteks slide yang terdeteksi; jangan mengisi field yang tidak didukung sumber.",
  fieldGroups: [],
  shiftFields: [
    shiftField("team", "Tim jaga", "Nama tim / penyaji"),
    shiftField("department", "Departemen", "Contoh: Pediatri"),
    shiftField("hospital", "Rumah sakit", "Nama rumah sakit"),
  ],
  slideGuides: [],
  patientInputHint: "Tempel catatan klinis atau upload evidence pasien; agent akan mengikuti mapping template.",
};

const roleLabels: Record<string, string> = {
  patient_identity: "Identitas pasien",
  anamnesis: "Anamnesis",
  history: "Riwayat pasien",
  pediatric_assessment: "Pediatric assessment",
  primary_survey: "Primary survey",
  secondary_survey: "Secondary survey",
  anthropometry: "Antropometri",
  physical_exam: "Pemeriksaan fisik",
  investigation: "Pemeriksaan penunjang",
  diagnosis: "Diagnosis",
  management: "Tata laksana",
  timeline: "Timeline",
  patient_summary: "Ringkasan pasien",
  consultation: "Konsultasi",
  delivery_preparation: "Persiapan persalinan",
  resuscitation: "Resusitasi neonatus",
  stabilization: "Stabilisasi S.T.A.B.L.E.",
  checklist: "Checklist klinis",
};

function genericTemplateProfile(template: TemplateProfileSource): TemplateProfile {
  if (template.templateAnalysis) return profileFromTemplateAnalysis(template.templateAnalysis);
  const slides = template.slides ?? [];
  const bindings = template.bindings ?? [];
  const mappedFields = Array.from(new Set(bindings
    .map((binding) => binding.semanticField)
    .filter((field) => field.startsWith("patient.") && !field.includes("Block") && !field.includes("Table") && !field.endsWith("summary"))));
  const mappedSpecs: TemplateFieldSpec[] = mappedFields.map((semanticField) => ({
    key: semanticField.replace(/^patient\./, ""),
    label: semanticField.replace(/^patient\./, "").split(".").join(" · "),
    placeholder: "Isi bila tersedia dari source pasien",
    multiline: true,
  }));
  const slideSpecs: TemplateFieldSpec[] = slides
    .filter((slide) => !["cover", "closing", "shift_summary"].includes(slide.role))
    .map((slide) => ({
      key: `templateData.slide${slide.index + 1}`,
      label: `Slide ${String(slide.index + 1).padStart(2, "0")} · ${roleLabels[slide.role] || slide.role}`,
      placeholder: slide.title || slide.text.slice(0, 120) || "Isi konteks slide ini bila tersedia",
      multiline: true,
    }));
  return {
    ...GENERIC_PROFILE,
    extractionInstructions: `${GENERIC_PROFILE.extractionInstructions} Template ini memiliki ${slides.length} slide. Prioritaskan konteks slide dan field klinis yang sudah dimapping; jangan memasukkan fakta ke slide yang tidak didukung source.`,
    fieldGroups: [
      ...(mappedSpecs.length ? [{ id: "mapped-fields", label: "Field klinis hasil mapping", description: "Field ini dibuat dari semantic binding template yang terdeteksi otomatis.", fields: mappedSpecs }] : []),
      ...(slideSpecs.length ? [{ id: "slide-context", label: "Konteks per slide", description: "Gunakan bagian ini bila template custom membutuhkan konteks yang tidak terwakili field klinis umum.", fields: slideSpecs }] : []),
    ],
    slideGuides: slides.map((slide) => guide(
      slide.index,
      slide.title || `Slide ${slide.index + 1}`,
      slide.role,
      slideSpecs.filter((spec) => spec.key === `templateData.slide${slide.index + 1}`).map((spec) => spec.key),
      `Ikuti konteks slide ${slide.index + 1} dan binding yang tersedia.`,
      slide.repeat,
      slide.speakerNotes,
      slide.inclusion || "routine",
      slide.include !== false,
      slide.inclusionReason,
      slide.patientScope,
    )),
  };
}

function profileFromTemplateAnalysis(analysis: TemplateAnalysis): TemplateProfile {
  return {
    ...GENERIC_PROFILE,
    label: analysis.label || GENERIC_PROFILE.label,
    description: analysis.description || GENERIC_PROFILE.description,
    extractionInstructions: analysis.extractionInstructions || GENERIC_PROFILE.extractionInstructions,
    patientInputHint: analysis.patientInputHint || GENERIC_PROFILE.patientInputHint,
    shiftFields: analysis.shiftFields.length ? analysis.shiftFields : GENERIC_PROFILE.shiftFields,
    fieldGroups: analysis.fieldGroups,
    slideGuides: analysis.slideGuides,
  };
}

function localShiftFields(template: TemplateProfileSource): TemplateShiftField[] {
  const cover = template.slides?.[0];
  const coverText = [cover?.text, ...(cover?.shapes ?? []).map((shape) => shape.text)].filter(Boolean).join(" ").toLowerCase();
  const candidates: Array<{ pattern: RegExp; field: TemplateShiftField }> = [
    { pattern: /mahasiswa|student/, field: shiftField("student", "Mahasiswa", "Nama mahasiswa") },
    { pattern: /ppds|residen|resident/, field: shiftField("ppds", "Tim PPDS / residen", "Nama tim PPDS atau residen") },
    { pattern: /fasilitator|supervisor|pembimbing/, field: shiftField("facilitator", "Fasilitator / pembimbing", "Nama fasilitator") },
    { pattern: /dpjp|dokter penanggung/, field: shiftField("dpjp", "DPJP", "Nama DPJP") },
    { pattern: /penyaji|presenter|presented by/, field: shiftField("presenter", "Nama penyaji", "Nama penyaji") },
    { pattern: /perinatologi|tim jaga/, field: shiftField(/perinatologi/.test(coverText) ? "perinaTeam" : "team", /perinatologi/.test(coverText) ? "Tim jaga perinatologi" : "Tim / penyaji", "Nama tim atau penyaji") },
    { pattern: /departemen|department|bagian|unit/, field: shiftField("department", "Departemen / unit", "Nama departemen atau unit") },
    { pattern: /rumah sakit|hospital|\brs\b/, field: shiftField("hospital", "Rumah sakit", "Nama rumah sakit") },
  ];
  const fields = candidates.filter((candidate) => candidate.pattern.test(coverText)).map((candidate) => candidate.field);
  if (!fields.length) fields.push(shiftField("team", "Tim / penyaji", "Nama tim atau penyaji"));
  return Array.from(new Map(fields.map((fieldSpec) => [fieldSpec.key, fieldSpec])).values());
}

export function buildLocalTemplateAnalysis(template: ParsedTemplate): TemplateAnalysis {
  const slides = template.slides ?? [];
  const bindings = template.bindings ?? [];
  const mappedFields = Array.from(new Set(bindings
    .map((binding) => binding.semanticField)
    .filter((field) => field.startsWith("patient.") && !field.includes("Block") && !field.includes("Table") && !field.endsWith("summary"))));
  const mappedSpecs: TemplateFieldSpec[] = mappedFields.map((semanticField) => ({
    key: semanticField.replace(/^patient\./, ""),
    label: semanticField.replace(/^patient\./, "").split(".").join(" · "),
    placeholder: "Isi bila tersedia dari source pasien",
    multiline: true,
  }));
  const slideGuides = slides.map((slide) => {
    const slideBindings = bindings.filter((binding) => binding.slideIndex === slide.index);
    const fields = Array.from(new Set(slideBindings.map((binding) => binding.templateKey ? `${binding.semanticField}:${binding.templateKey}` : binding.semanticField)));
    const structure = [
      slide.shapes.length ? `${slide.shapes.length} elemen` : "tanpa shape teks",
      slide.shapes.some((shape) => shape.kind === "graphicFrame") ? "memiliki tabel/grafik" : "tanpa tabel terdeteksi",
      slide.speakerNotes ? "memiliki speaker notes" : "tanpa speaker notes",
    ].join(", ");
    return guide(
      slide.index,
      slide.title || `Slide ${slide.index + 1}`,
      slide.role,
      fields,
      `Pertahankan struktur ${structure}. Gunakan hanya fakta source yang relevan dengan slide ini.${slide.speakerNotes ? ` Speaker notes: ${slide.speakerNotes}` : ""}`,
      slide.repeat,
      slide.speakerNotes,
      slide.inclusion || "routine",
      slide.include !== false,
      slide.inclusionReason,
      slide.patientScope,
    );
  });
  const slideSpecs: TemplateFieldSpec[] = slides
    .filter((slide) => !["cover", "closing", "shift_summary"].includes(slide.role))
    .map((slide) => ({
      key: `templateData.slide${slide.index + 1}`,
      label: `Slide ${String(slide.index + 1).padStart(2, "0")} · ${roleLabels[slide.role] || slide.role}`,
      placeholder: slide.title || slide.text.slice(0, 120) || "Konteks klinis slide ini",
      multiline: true,
    }));
  const fieldGroups: TemplateFieldGroup[] = [
    ...(mappedSpecs.length ? [{ id: "mapped-fields", label: "Field klinis hasil pembacaan awal", description: "Field ini berasal dari teks, tabel, dan binding yang terdeteksi pada template.", fields: mappedSpecs }] : []),
    ...(slideSpecs.length ? [{ id: "slide-context", label: "Konteks per slide", description: "Gunakan jika bagian template custom membutuhkan konteks yang belum punya semantic field umum.", fields: slideSpecs }] : []),
  ];
  return {
    version: 1,
    label: `Template custom · ${template.name}`,
    description: `Koasis membaca ${slides.length} slide, termasuk role, pengulangan per pasien, shape, tabel, dan speaker notes yang tersedia.`,
    extractionInstructions: `Ikuti urutan dan konteks setiap slide pada template ${template.name}. Jangan memindahkan fakta antar-panel. Gunakan field klinis yang terdeteksi, pertahankan satuan dan format tabel, dan simpan bagian yang belum terpetakan sebagai templateData tanpa mengarang nilai.`,
    patientInputHint: "Tempel catatan klinis atau upload evidence pasien; agent akan menyesuaikan ekstraksi dengan panduan slide custom ini.",
    shiftFields: localShiftFields(template),
    fieldGroups,
    slideGuides,
    bindings,
    warnings: ["Agent template belum tersedia atau belum selesai; mapping lokal digunakan sebagai fallback."],
    confidence: 0.42,
    source: "local",
  };
}

export function getTemplateProfile(template: TemplateProfileSource | null | undefined): TemplateProfile {
  if (template?.profileId === "lapjag") return LAPJAG_PROFILE;
  if (template?.profileId === "perina-lapjag") return PERINA_LAPJAG_PROFILE;
  if (template?.profileId === "perina-rsab") return PERINA_RSAB_PROFILE;
  if (template?.profileId === "rscm") return RSCM_PROFILE;
  if (template?.profileId === "rsui") return RSUI_PROFILE;
  if (template?.templateAnalysis) return profileFromTemplateAnalysis(template.templateAnalysis);
  if (template?.profileId === "generic") return genericTemplateProfile(template);
  const identity = `${template?.name ?? ""} ${template?.fileName ?? ""}`.toLowerCase();
  if (/perina\s*lapjag/.test(identity)) return PERINA_LAPJAG_PROFILE;
  if (/perina\s*rsab/.test(identity)) return PERINA_RSAB_PROFILE;
  if (/\brscm\b/.test(identity)) return RSCM_PROFILE;
  if (/\brsui\b/.test(identity)) return RSUI_PROFILE;
  if (/lapjag/.test(identity)) return LAPJAG_PROFILE;
  return template ? genericTemplateProfile(template) : GENERIC_PROFILE;
}
