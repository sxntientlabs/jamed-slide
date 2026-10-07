import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import type { ClinicalField, PatientRecord, ShiftDetails } from "../src/types";
import { parsePptx } from "../src/lib/pptxParser";
import { generatePresentation } from "../src/lib/pptxGenerator";
import { inspectGeneratedPresentation } from "../src/lib/presentationReview";

const cf = <T>(value: T): ClinicalField<T> => ({ value, status: "documented", confidence: 0.99, sources: [{ sourceId: "qa-current-template" }] });
const patient: PatientRecord = {
  id: "qa-patient-1",
  displayName: "QA Pasien Utama",
  identifiers: { name: cf("QA Pasien Utama"), initials: cf("QA") , medicalRecordNumber: cf("RM-QA-01") },
  demographics: { age: cf("5 tahun"), sex: cf("Laki-laki"), weightKg: cf(18), heightCm: cf(108) },
  admission: {},
  chiefComplaint: cf("Demam dan sesak sejak kemarin"),
  urgency: cf("True"),
  history: {
    presentIllness: cf("Demam sejak 1 hari, batuk, dan napas cepat; tidak ada kejang."),
    pastMedicalHistory: cf("Tidak ada riwayat penyakit dahulu."),
    medicationHistory: cf("Parasetamol bila demam."),
    allergyHistory: cf("Tidak ada alergi yang diketahui."),
    birthHistory: cf("Lahir cukup bulan spontan."),
    immunizationHistory: cf("Imunisasi dasar lengkap."),
    familyHistory: cf("Tidak ada riwayat serupa dalam keluarga."),
    nutritionHistory: cf("Makan 3 kali sehari; nafsu makan menurun saat sakit."),
    socioeconomicHistory: cf("Tinggal bersama orang tua; bersekolah TK."),
  },
  physicalExam: {
    generalAppearance: cf("Tampak sakit sedang."),
    consciousness: cf("Compos mentis, GCS E4V5M6."),
    vitalSigns: { bloodPressure: cf("100/65 mmHg"), heartRate: cf(118), respiratoryRate: cf(32), temperature: cf(38.2), spo2: cf(96) },
    findings: cf("Retraksi subkostal ringan; ronki basah basal kanan."),
    organFindings: cf([
      { organ: "Kepala", description: "Normosefali." },
      { organ: "Thoraks", description: "Retraksi subkostal ringan, ronki basal kanan." },
      { organ: "Jantung", description: "Takikardia reguler, tidak ada murmur." },
      { organ: "Abdomen", description: "Datar, lunak." },
    ]),
  },
  investigations: { laboratory: cf([{ name: "Hemoglobin", result: "12", unit: "g/dL" }, { name: "Leukosit", result: "15.2", unit: "10^3/uL" }]), imaging: cf([]), other: cf([]) },
  assessment: { workingDiagnosis: cf(["Pneumonia komunitas"]), differentialDiagnosis: cf(["Bronkiolitis"]) },
  templateData: {
    dateOfBirth: cf("1 Januari 2021"), address: cf("Jakarta"), religion: cf("Islam"), maritalStatus: cf("Belum menikah"),
    patBehaviour: cf("Tampak sakit, tonus adekuat"), patInteractiveness: cf("Interaktif"), patConsolability: cf("Mudah ditenangkan"), patLookOrGaze: cf("Kontak mata baik"), patSpeechCry: cf("Menangis kuat"),
    patBreathing: cf("Napas cepat"), patRetraction: cf("Retraksi subkostal ringan"), patNasalFlaring: cf("Tidak ada"), patAddedBreathSounds: cf("Ronki basal kanan"), patAbnormalPosition: cf("Tidak ada"), patBodyColour: cf("Tidak sianosis"),
    primarySurvey: cf("Airway paten; Breathing RR 32, SpO2 96%; Circulation HR 118, TD 100/65; Disability GCS 15; Exposure T 38.2 C"),
    primarySurveyLeft: cf("Airway paten; Breathing RR 32; Circulation HR 118, TD 100/65."), primarySurveyRight: cf("GCS 15; Suhu 38.2 C."),
    primarySurveyContinuationLeft: cf("Airway tetap paten; retraksi ringan."), primarySurveyContinuationRight: cf("Tidak ada temuan tambahan."),
    secondarySurvey: cf("Allergy tidak ada; Medication parasetamol; Past illness tidak ada; Last meal pagi; Event demam dan batuk."),
    lastMeal: cf("Pagi hari"), event: cf("Demam dan batuk sejak kemarin"),
    pregnancyBirth: cf("Lahir cukup bulan spontan."), growthDevelopment: cf("Tumbuh kembang sesuai usia."),
    weightForAge: cf("Normal"), heightForAge: cf("Normal"), weightForHeight: cf("Normal"), nutritionConclusion: cf("Gizi baik"), anthropometryMeasurements: cf("BB 18 kg; TB 108 cm"), anthropometryAssessment: cf("BB/U normal; TB/U normal; BB/TB normal; Kesan gizi baik"),
    managementPart1: cf("Oksigen nasal kanul dan observasi respons."), managementPart2: cf("Antibiotik sesuai evaluasi klinis."), managementPart3: cf("Edukasi orang tua dan konsultasi dokter penanggung jawab."), diagnosticPlan: cf("Evaluasi radiologi bila kondisi memburuk."), monitoringPlan: cf("Pantau napas, saturasi, suhu, dan tanda bahaya."),
  },
  management: { medications: cf([{ name: "Parasetamol", dose: "10 mg/kg", route: "oral", frequency: "bila demam" }]), fluids: cf([]), procedures: cf([]), oxygenTherapy: cf([{ name: "Oksigen", dose: "2 L/menit", route: "nasal kanul" }]) },
  timeline: [],
  sourceId: "qa-current-template",
};

const shift: ShiftDetails = { title: "QA Current Template", date: "2026-10-07", department: "IGD", hospital: "RS Test", team: "Koas QA", facilitator: "Fasilitator QA", dpjp: "DPJP QA" };

const archive = await JSZip.loadAsync(await readFile("Template laporan jaga.zip"));
for (const [entryName, outputPath] of [["Laporan Jaga/[TEMPLATE] IGD HARKIT.pptx", "/tmp/qa-igd-harkit-current.pptx"], ["Laporan Jaga/[TEMPLATE] RSUI.pptx", "/tmp/qa-rsui-current.pptx"]] as const) {
  const bytes = await archive.file(entryName)!.async("uint8array");
  const template = await parsePptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), entryName);
  const generated = await generatePresentation(template, [patient], template.bindings, shift, { focusPatientId: patient.id });
  await writeFile(outputPath, new Uint8Array(await generated.blob.arrayBuffer()));
  const review = await inspectGeneratedPresentation(generated.blob, template, [patient], patient.id);
  const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
  const xml = (await Promise.all(Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map((name) => output.file(name)!.async("string")))).join(" ");
  console.log(JSON.stringify({ entryName, slideCount: generated.slideCount, review: review.review, sampleLeak: /An\. EA|Febris H5|Transfusi PRC|Influenza A|thalassemia mayor/i.test(xml) }, null, 2));
}
