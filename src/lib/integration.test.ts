import { expect, test } from "vitest";
import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractPatients } from "./clinicalParser";
import { extractDocxText, extractWordXmlText } from "./docxParser";
import { generatePresentation } from "./pptxGenerator";
import { parsePptx } from "./pptxParser";
import { inspectGeneratedPresentation, reviewAllowsManualConfirmation } from "./presentationReview";
import { getTemplateProfile } from "./templateProfiles";
import { applyTemplateAnalysis, buildLocalTemplateAnalysis, buildTemplateSnapshot, validateTemplateContract } from "./templateAnalyzer";
import type { ClinicalField, InvestigationItem, OrganFinding, ShiftDetails } from "../types";

function documented<T>(value: T): ClinicalField<T> {
  return { value, status: "documented", confidence: 1, sources: [] };
}

const syntheticNotes = `Pasien 1
Nama: An. A
Usia: 5 tahun
Jenis kelamin: Laki-laki
BB: 15 kg
TB: 100 cm
Kegawatan: T
Keluhan Utama: Sesak napas
RPS: Batuk pilek sejak 3 hari
Diagnosis: Bronkiolitis
02:15 - Oksigen dimulai

Pasien 2
Nama: Ny. B
Usia: 28 tahun
Jenis kelamin: Perempuan
Keluhan Utama: Nyeri perut
Diagnosis: Nyeri abdomen akut`;

test("clinical extraction separates patients and preserves missing fields", () => {
  const result = extractPatients(syntheticNotes, "test-source");
  expect(result.patients).toHaveLength(2);
  expect(result.patients[0].identifiers.name?.value).toBe("An. A");
  expect(result.patients[0].demographics.weightKg?.value).toBe(15);
  expect(result.patients[0].physicalExam.vitalSigns.spo2?.status).toBe("missing");
  expect(result.patients[0].timeline[0]?.timestamp).toBe("02:15");
});

test("presentation warnings allow manual confirmation while blocking errors do not", () => {
  expect(reviewAllowsManualConfirmation("pass")).toBe(true);
  expect(reviewAllowsManualConfirmation("needs_review")).toBe(true);
  expect(reviewAllowsManualConfirmation("blocked")).toBe(false);
  expect(reviewAllowsManualConfirmation(undefined)).toBe(false);
});

test("clinical extraction splits a pasted patient roster into one record per table row", () => {
  const result = extractPatients(`PASIEN BARU: 3 PASIEN
No.\tNama / Usia\tDiagnosis\tKegawatan
1. QHS /15 tahun\tSyok hipovolemia e.c. diare akut\tT
2. ... /15 tahun\tPucat e.c. AIHA\tTrue
3. ... /12 tahun\tSesak nafas e.c. demam susp. campak\tFalse`, "roster-source");
  expect(result.patients).toHaveLength(3);
  expect(result.patients.map((patient) => patient.displayName)).toEqual(["QHS", "...", "..."]);
  expect(result.patients[0].demographics.age?.value).toBe("15 tahun");
  expect(result.patients[0].assessment.workingDiagnosis?.value).toEqual(["Syok hipovolemia e.c. diare akut"]);
  expect(result.patients[1].urgency?.value).toBe("True");
  expect(result.patients[2].assessment.workingDiagnosis?.value).toEqual(["Sesak nafas e.c. demam susp. campak"]);
});

test("DOCX extraction preserves clinical paragraphs, line breaks, and table cells", async () => {
  const archive = new JSZip();
  archive.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:t>Nama: An. DOCX &amp; Test</w:t></w:r></w:p>
      <w:p><w:r><w:t>Keluhan Utama: Sesak</w:t><w:br/><w:t>napas</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Usia</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>5 tahun</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`);
  const bytes = await archive.generateAsync({ type: "uint8array" });

  const text = await extractDocxText(bytes);
  expect(text).toContain("Nama: An. DOCX & Test");
  expect(text).toContain("Keluhan Utama: Sesak\nnapas");
  expect(text).toContain("Usia\t5 tahun");
  expect(extractWordXmlText("<w:document xmlns:w=\"urn:test\"><w:body><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:body></w:document>")).toBe("A & B");
});

test("Lapjag profile carries template-specific extraction guidance", () => {
  const profile = getTemplateProfile({ name: "Lapjag", fileName: "[TEMPLATE] Lapjag.pptx", profileId: "lapjag" });
  expect(profile.fieldGroups).toHaveLength(4);
  expect(profile.extractionInstructions).toContain("WHO");
  expect(profile.fieldGroups.flatMap((group) => group.fields).some((field) => field.key === "templateData.patBreathing")).toBe(true);
});

test("real department template parses and can be duplicated into a valid PPTX", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] PERINA RSAB.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] PERINA RSAB.pptx");
  expect(template.slideCount).toBe(15);
  expect(template.slides[0].role).toBe("cover");
  expect(template.slides.at(-1)?.role).toBe("closing");

  const patients = extractPatients(syntheticNotes, "test-source").patients;
  const shift: ShiftDetails = { title: "Laporan Jaga Test", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, patients, template.bindings, shift);
  const generatedBytes = new Uint8Array(await generated.blob.arrayBuffer());
  await writeFile("/tmp/jamed-validation.pptx", generatedBytes);
  const output = await JSZip.loadAsync(generatedBytes);
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  expect(slideFiles).toHaveLength(28);
  const outputText = await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")));
  expect(outputText.some((xml) => xml.includes("An. A"))).toBe(true);
  expect(outputText.some((xml) => xml.includes("Ny. B"))).toBe(true);
  expect(output.file("ppt/presentation.xml")).toBeTruthy();
});

test("summary table keeps every new patient while detail slides use only the selected focus patient", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] RSCM.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] RSCM.pptx");
  const patients = extractPatients(`Pasien 1
Nama: An. A
Usia: 5 tahun
Jenis kelamin: Laki-laki
Kegawatan: T
Diagnosis: Bronkiolitis

Pasien 2
Nama: Ny. B
Usia: 28 tahun
Jenis kelamin: Perempuan
Kegawatan: T
Diagnosis: Nyeri abdomen akut

Pasien 3
Nama: Tn. C
Usia: 42 tahun
Jenis kelamin: Laki-laki
Kegawatan: F
Diagnosis: Demam

Pasien 4
Nama: An. D
Usia: 7 tahun
Jenis kelamin: Perempuan
Diagnosis: Batuk

Pasien 5
Nama: Ny. E
Usia: 33 tahun
Jenis kelamin: Perempuan
Diagnosis: Mual

Pasien 6
Nama: Tn. F
Usia: 51 tahun
Jenis kelamin: Laki-laki
Diagnosis: Pusing`, "summary-focus-source").patients;
  const shift: ShiftDetails = { title: "Laporan Jaga Summary Focus", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, patients, template.bindings, shift, { focusPatientId: patients[1].id });
  await writeFile("/tmp/jamed-summary-focus.pptx", new Uint8Array(await generated.blob.arrayBuffer()));

  const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
  const summarySlide = template.slides.find((slide) => slide.role === "shift_summary");
  const summaryBinding = template.bindings.find((binding) => binding.slideIndex === summarySlide?.index && binding.semanticField === "shift.patientSummaryTable");
  const summaryShape = summarySlide?.shapes.find((shape) => shape.id === summaryBinding?.shapeId);
  const summaryCapacity = Math.max(1, (summaryShape?.tableRows?.length ?? 1) - 1);
  const summaryPageCount = Math.max(1, Math.ceil(patients.length / summaryCapacity));
  const selectedSlideCount = template.slides.filter((slide) => slide.include !== false).length;
  expect(generated.slideCount).toBe(selectedSlideCount + summaryPageCount - 1);

  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const slideXml = await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")));
  const summaryXmls = slideXml.filter((xml) => xml.includes("PASIEN BARU"));
  expect(summaryXmls).toHaveLength(summaryPageCount);
  const summaryText = summaryXmls.join(" ");
  const summaryXml = await output.file("ppt/slides/slide2.xml")!.async("string");
  const firstDetailXml = await output.file("ppt/slides/slide3.xml")!.async("string");
  expect(summaryText).toContain("An. A");
  expect(summaryText).toContain("Ny. B");
  expect(summaryText).toContain("Tn. C");
  expect(summaryText).toContain("An. D");
  expect(summaryText).toContain("Ny. E");
  expect(summaryText).toContain("Tn. F");
  expect(summaryText).not.toContain("pasien lainnya");
  expect(summaryXml).toContain("PASIEN BARU: 6 PASIEN");
  expect(summaryXml).not.toContain("LANJUTAN");
  if (summaryPageCount > 1) {
    expect(summaryXmls.some((xml) => xml.includes("LANJUTAN 2/"))).toBe(true);
  }
  expect(firstDetailXml).toContain("Ny. B");
  expect(firstDetailXml).not.toContain("An. A");
  expect(firstDetailXml).not.toContain("Tn. C");

  const review = await inspectGeneratedPresentation(generated.blob, template, patients, patients[1].id);
  expect(review.review.status).not.toBe("blocked");
});

test("IGD HARKIT summary fills reserved empty table rows for every detected patient", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] IGD HARKIT.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] IGD HARKIT.pptx");
  const patients = extractPatients(`PASIEN BARU: 5 PASIEN
1. Julia / 20 tahun | Demam | T
2. Rafael / 21 tahun | Edema | F
3. Gita / 19 tahun | Kejang | T
4. Lutfi / 22 tahun | CKD | F
5. An. R / 3 tahun | Pneumonia berat | T`, "igd-harkit-roster-source").patients;
  expect(patients).toHaveLength(5);
  const shift: ShiftDetails = { title: "Laporan Jaga IGD HARKIT", date: "2026-10-01", department: "IGD", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, patients, template.bindings, shift, { focusPatientId: patients[0].id });
  const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const summaryXmls = await Promise.all(slideFiles.map(async (name) => output.file(name)!.async("string"))).then((slides) => slides.filter((xml) => xml.includes("PASIEN BARU")));
  expect(summaryXmls).toHaveLength(1);
  const summaryText = summaryXmls[0];
  expect(summaryText).toContain("PASIEN BARU: 5 PASIEN");
  expect(summaryText).toContain("Julia");
  expect(summaryText).toContain("Rafael");
  expect(summaryText).toContain("Gita");
  expect(summaryText).toContain("Lutfi");
  expect(summaryText).toContain("An. R");
});

test("every built-in summary template keeps the full patient roster", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const files = [
    "[TEMPLATE] Lapjag.pptx",
    "[TEMPLATE] RSCM.pptx",
    "[TEMPLATE] IGD HARKIT.pptx",
    "[TEMPLATE] IGD RSUT.pptx",
  ];
  const patients = extractPatients(`PASIEN BARU: 5 PASIEN
1. Julia / 20 tahun | Demam | T
2. Rafael / 21 tahun | Edema | F
3. Gita / 19 tahun | Kejang | T
4. Lutfi / 22 tahun | CKD | F
5. An. R / 3 tahun | Pneumonia berat | T`, "built-in-roster-source").patients;
  const shift: ShiftDetails = { title: "Laporan Jaga Roster", date: "2026-10-01", department: "IGD", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  for (const fileName of files) {
    const entry = Object.keys(archive.files).find((name) => name.endsWith(fileName));
    expect(entry, fileName).toBeTruthy();
    const bytes = await archive.file(entry!)!.async("uint8array");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const template = await parsePptx(buffer, fileName);
    if (!template.bindings.some((binding) => binding.semanticField === "shift.patientSummaryTable")) continue;
    const generated = await generatePresentation(template, patients, template.bindings, shift, { focusPatientId: patients[0].id });
    const review = await inspectGeneratedPresentation(generated.blob, template, patients, patients[0].id);
    expect(review.review.issues.filter((issue) => issue.severity === "error"), fileName).toEqual([]);
    const summaryText = review.snapshot.slides
      .filter((slide) => /(?:pasien baru|daftar pasien|ringkasan pasien|resume jaga)/i.test(`${slide.title} ${slide.text}`))
      .map((slide) => slide.text)
      .join(" ");
    for (const name of ["Julia", "Rafael", "Gita", "Lutfi", "An. R"]) {
      expect(summaryText, `${fileName}: ${name}`).toContain(name);
    }
  }
});

test("an agent-learned custom upload uses the same roster completeness guard", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const entry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] IGD HARKIT.pptx"));
  expect(entry).toBeTruthy();
  const bytes = await archive.file(entry!)!.async("uint8array");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const uploaded = await parsePptx(buffer, "new-department-upload.pptx", "generic");
  const localContract = buildLocalTemplateAnalysis(uploaded);
  const summaryShape = uploaded.slides[1]?.shapes.find((shape) => shape.kind === "graphicFrame");
  expect(summaryShape).toBeTruthy();
  const learned = applyTemplateAnalysis(uploaded, {
    ...localContract,
    slides: uploaded.slides.map((slide) => ({
      index: slide.index,
      label: slide.title,
      role: slide.index === 0 ? "cover" : slide.index === 1 ? "shift_summary" : slide.index === uploaded.slides.length - 1 ? "closing" : "unknown",
      repeat: false,
      fields: slide.index === 1 ? ["shift.patientSummaryTable"] : [],
      instructions: "Gunakan mapping hasil pembelajaran agent.",
      inclusion: slide.index <= 1 || slide.index === uploaded.slides.length - 1 ? "routine" : "example",
      include: slide.index <= 1 || slide.index === uploaded.slides.length - 1,
      patientScope: slide.index === 1 ? "all_patients" : "static",
    })),
    bindings: [{ slideIndex: 1, shapeId: summaryShape!.id, semanticField: "shift.patientSummaryTable", confidence: 0.99 }],
  }, "agent", "test-agent");
  expect(learned.templateValidation?.valid, learned.templateValidation?.errors.join(" | ")).toBe(true);
  const patients = extractPatients(`PASIEN BARU: 5 PASIEN
1. Julia / 20 tahun | Demam | T
2. Rafael / 21 tahun | Edema | F
3. Gita / 19 tahun | Kejang | T
4. Lutfi / 22 tahun | CKD | F
5. An. R / 3 tahun | Pneumonia berat | T`, "custom-roster-source").patients;
  const shift: ShiftDetails = { title: "Laporan Jaga Custom", date: "2026-10-01", department: "IGD", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(learned, patients, learned.bindings, shift, { focusPatientId: patients[0].id });
  const review = await inspectGeneratedPresentation(generated.blob, learned, patients, patients[0].id);
  expect(review.review.issues.filter((issue) => issue.severity === "error")).toEqual([]);
});

test("template mapping can exclude a routine slide without changing its clinical scope", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] RSCM.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] RSCM.pptx");
  const candidate = template.slides.find((slide) => slide.include !== false && slide.repeat && slide.role !== "shift_summary");
  expect(candidate).toBeTruthy();
  const excludedTemplate = {
    ...template,
    slides: template.slides.map((slide) => slide.index === candidate!.index ? { ...slide, include: false } : slide),
  };
  expect(excludedTemplate.slides.find((slide) => slide.index === candidate!.index)?.repeat).toBe(true);
  const patient = extractPatients(syntheticNotes, "mapping-include-source").patients[0];
  const shift: ShiftDetails = { title: "Laporan Jaga Include Mapping", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const complete = await generatePresentation(template, [patient], template.bindings, shift, { focusPatientId: patient.id });
  const excluded = await generatePresentation(excludedTemplate, [patient], excludedTemplate.bindings, shift, { focusPatientId: patient.id });
  expect(excluded.slideCount).toBe(complete.slideCount - 1);
});

test("lapjag template keeps composite identity and clinical blocks mapped to the right context", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] Lapjag.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] Lapjag.pptx");
  expect(template.profileId).toBe("lapjag");
  expect(template.bindings.some((binding) => binding.semanticField === "patient.managementTable")).toBe(true);
  expect(template.slideCount).toBe(27);
  expect(template.slides[10]?.title).toContain("WHO length/height-for-age");
  expect(template.slides[10]?.repeat).toBe(true);
  expect(template.slides[18]?.inclusion).toBe("example");
  expect(template.slides[18]?.include).toBe(false);
  const physicalBindings = template.bindings.filter((binding) => binding.slideIndex === 13);
  expect(physicalBindings.filter((binding) => binding.semanticField === "patient.physicalExam.generalAppearanceBlock")).toHaveLength(1);
  expect(physicalBindings.filter((binding) => binding.semanticField === "patient.physicalExam.vitalSignsBlock")).toHaveLength(1);
  expect(physicalBindings.some((binding) => binding.semanticField === "patient.physicalExamBlock")).toBe(false);
  expect(template.slides.some((slide) => slide.title.includes("ASSESSMENT"))).toBe(true);
  const patient = extractPatients(syntheticNotes, "lapjag-source").patients[0];
  patient.history.pastMedicalHistory = documented("Tidak ada riwayat penyakit dahulu yang bermakna.");
  patient.history.familyHistory = documented("Ayah dengan hipertensi; riwayat penyakit keluarga lain tidak tercantum.");
  patient.physicalExam.generalAppearance = documented("Tampak sakit sedang.");
  patient.physicalExam.consciousness = documented("Compos mentis (GCS E4M6V5).");
  patient.physicalExam.vitalSigns = {
    bloodPressure: documented("112/63 mmHg"),
    heartRate: documented(66),
    respiratoryRate: documented(20),
    temperature: documented(37.8),
    spo2: documented(88),
  };
  const shift: ShiftDetails = { title: "Laporan Jaga Test", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, [patient], template.bindings, shift);
  const generatedBytes = new Uint8Array(await generated.blob.arrayBuffer());
  expect(generated.slideCount).toBe(26);
  await writeFile("/tmp/jamed-lapjag-final.pptx", generatedBytes);
  const output = await JSZip.loadAsync(generatedBytes);
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  expect(slideFiles).toHaveLength(26);
  expect(output.file("ppt/slides/slide20.xml")).toBeFalsy();
  const outputPresentationRels = await output.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const outputContentTypes = await output.file("[Content_Types].xml")!.async("string");
  expect(outputPresentationRels).not.toContain("slides/slide20.xml");
  expect(outputContentTypes).not.toContain("/ppt/slides/slide20.xml");
  const outputText = await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")));
  const text = outputText.join(" ");
  expect(text).toContain("An. A");
  expect(text).toContain("Sesak napas");
  const coverXml = await output.file("ppt/slides/slide1.xml")!.async("string");
  expect(coverXml).toContain("Kamis, 1 Oktober 2026");
  expect(coverXml).toContain("Fasilitator Laporan Jaga: Fasilitator Test");
  expect(coverXml).toContain("DPJP Jaga: DPJP Test");
  expect(text).not.toContain("Nama : 2026-10-01");
  expect(output.file("ppt/slides/_rels/slide11.xml.rels")).toBeTruthy();
  const chartRelationships = await output.file("ppt/slides/_rels/slide11.xml.rels")!.async("string");
  expect(chartRelationships).toContain("Target=\"../media/jamed-who-lhfa-boys.png\"");
  expect(await output.file("ppt/slides/slide11.xml")!.async("string")).toContain("JaMed WHO plot marker");
  const review = await inspectGeneratedPresentation(generated.blob, template, [patient]);
  expect(review.review.issues.some((issue) => /duplikasi|instruksi template|contoh template/i.test(issue.title))).toBe(false);
  const physicalXml = await output.file("ppt/slides/slide14.xml")!.async("string");
  expect(physicalXml.match(/Tampak sakit sedang\./g)).toHaveLength(1);
  expect(physicalXml.match(/112\/63 mmHg/g)).toHaveLength(1);
  expect(physicalXml.match(/Compos mentis \(GCS E4M6V5\)\./g)).toHaveLength(1);
});

test("built-in department profiles map their slide contracts and generate independently", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const cases = [
    { fileName: "[TEMPLATE} PERINA Lapjag.pptx", profileId: "perina-lapjag", slideCount: 15, requiredKey: "antenatalConsultation" },
    { fileName: "[TEMPLATE} PERINA harkit.pptx", profileId: "perina-harkit", slideCount: 15, requiredKey: "antenatalConsultation" },
    { fileName: "[TEMPLATE} PERINA HARKIT.pptx", profileId: "perina-harkit", slideCount: 15, requiredKey: "antenatalConsultation" },
    { fileName: "[TEMPLATE} PERINA RSUT.pptx", profileId: "perina-rsut", slideCount: 15, requiredKey: "antenatalConsultation" },
    { fileName: "[TEMPLATE] PERINA RSAB.pptx", profileId: "perina-rsab", slideCount: 15, requiredKey: "resuscitationTimeline" },
    { fileName: "[TEMPLATE] IGD HARKIT.pptx", profileId: "igd-harkit", slideCount: 17, requiredKey: "pregnancyBirth" },
    { fileName: "[TEMPLATE] IGD RSUT.pptx", profileId: "igd-rsut", slideCount: 17, requiredKey: "pregnancyBirth" },
    { fileName: "[TEMPLATE] RSCM.pptx", profileId: "rscm", slideCount: 17, requiredKey: "pregnancyBirth" },
    { fileName: "[TEMPLATE] RSUI.pptx", profileId: "rsui", slideCount: 19, requiredKey: "radiologyInterpretation" },
  ] as const;
  const patient = extractPatients(syntheticNotes, "profile-source").patients[0];
  const shift: ShiftDetails = {
    title: "Laporan Jaga Profile Test",
    date: "2026-10-01",
    department: "Pediatri",
    hospital: "RS Test",
    team: "Tim Mahasiswa Test",
    facilitator: "Fasilitator Test",
    dpjp: "DPJP Test",
    metadata: { student: "Mahasiswa Test", ppds: "PPDS Test", presenter: "Penyaji Test", perinaTeam: "Perinatologi Test" },
  };
  for (const item of cases) {
    const entry = Object.keys(archive.files).find((name) => name.endsWith(item.fileName));
    expect(entry, item.fileName).toBeTruthy();
    const bytes = await archive.file(entry!)!.async("uint8array");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const template = await parsePptx(buffer, item.fileName);
    expect(template.profileId, item.fileName).toBe(item.profileId);
    expect(template.slideCount, item.fileName).toBe(item.slideCount);
    expect(template.slides[0].repeat, item.fileName).toBe(false);
    expect(template.slides.at(-1)?.repeat, item.fileName).toBe(false);
    expect(template.bindings.some((binding) => binding.templateKey === item.requiredKey), item.fileName).toBe(true);
    const generated = await generatePresentation(template, [patient], template.bindings, shift);
    const generatedBytes = new Uint8Array(await generated.blob.arrayBuffer());
    await writeFile(`/tmp/jamed-${item.profileId}.pptx`, generatedBytes);
    const output = await JSZip.loadAsync(generatedBytes);
    const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideFiles, item.fileName).toHaveLength(item.slideCount);
    const outputText = await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")));
    expect(outputText.join(" "), item.fileName).toContain("An. A");
    const localReview = await inspectGeneratedPresentation(generated.blob, template, [patient]);
    expect(localReview.review.status, item.fileName).not.toBe("blocked");
    expect(localReview.review.issues.some((issue) => /instruksi template|contoh template|duplikasi konteks/i.test(issue.title)), item.fileName).toBe(false);
  }
});

test("every built-in template passes the same contract gate used before generation", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const files = [
    "[TEMPLATE] Lapjag.pptx",
    "[TEMPLATE} PERINA Lapjag.pptx",
    "[TEMPLATE] PERINA RSAB.pptx",
    "[TEMPLATE} PERINA HARKIT.pptx",
    "[TEMPLATE} PERINA RSUT.pptx",
    "[TEMPLATE] IGD HARKIT.pptx",
    "[TEMPLATE] IGD RSUT.pptx",
    "[TEMPLATE] RSCM.pptx",
    "[TEMPLATE] RSUI.pptx",
  ];

  for (const fileName of files) {
    const entry = Object.keys(archive.files).find((name) => name.endsWith(fileName));
    expect(entry, fileName).toBeTruthy();
    const bytes = await archive.file(entry!)!.async("uint8array");
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const parsed = await parsePptx(buffer, fileName);
    const analyzed = applyTemplateAnalysis(parsed, buildLocalTemplateAnalysis(parsed), "local");
    const validation = validateTemplateContract(analyzed);

    expect(analyzed.templateAnalysis?.learningStatus, fileName).toBe("trusted_profile");
    expect(validation.valid, `${fileName}: ${validation.errors.join(" | ")}`).toBe(true);
    expect(validation.errors, fileName).toEqual([]);
  }
});

test("a new custom upload cannot generate from a local or partial learning fallback", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const entry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] RSUI.pptx"));
  expect(entry).toBeTruthy();
  const bytes = await archive.file(entry!)!.async("uint8array");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const custom = await parsePptx(buffer, "future-department-template.pptx", "generic");

  const localFallback = applyTemplateAnalysis(custom, buildLocalTemplateAnalysis(custom), "local");
  expect(localFallback.analysisStatus).toBe("needs_review");
  expect(localFallback.templateValidation?.valid).toBe(false);
  expect(localFallback.templateValidation?.errors.some((message) => /pembelajaran agent|dipelajari agent/i.test(message))).toBe(true);

  const partialAgent = applyTemplateAnalysis(custom, {
    slides: [{ index: 0, label: "Cover saja", role: "cover", repeat: false, fields: ["shift.title"], instructions: "Cover" }],
    bindings: [],
    warnings: [],
    confidence: 0.95,
  }, "agent", "test-model");
  expect(partialAgent.templateAnalysis?.learningStatus).toBe("local_fallback");
  expect(partialAgent.analysisStatus).toBe("needs_review");
  expect(partialAgent.templateValidation?.valid).toBe(false);
  expect(partialAgent.templateValidation?.errors.some((message) => /pembelajaran agent|dipelajari agent|panduan konteks/i.test(message))).toBe(true);
});

test("PERINA RSAB plots neonatal measurements and embeds radiology evidence", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] PERINA RSAB.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] PERINA RSAB.pptx");
  const templateZip = await JSZip.loadAsync(templateBytes);
  const evidenceBytes = await templateZip.file("ppt/media/image4.png")!.async("uint8array");
  const patient = extractPatients("Pasien 1\nNama: By. Test\nJenis kelamin: Perempuan", "perina-evidence-source").patients[0];
  patient.demographics.weightKg = documented(1.45);
  patient.demographics.heightCm = documented(40);
  patient.templateData = {
    ...(patient.templateData || {}),
    gestationalAge: documented("30 minggu 5 hari"),
    headCircumference: documented("28,5 cm"),
    ballardScore: documented("18, ekuivalen sekitar 31 minggu"),
    neonatalAnthropometryConclusion: documented("Prematur 30+5 minggu, AGA."),
  };
  patient.investigations.imaging = documented([{ name: "Foto toraks AP supine", result: "Gambaran sesuai dengan RDS neonatal." }]);
  patient.attachments = [{
    id: "radiology-test",
    name: "foto-toraks.png",
    mimeType: "image/png",
    kind: "image",
    sizeBytes: evidenceBytes.byteLength,
    dataUrl: `data:image/png;base64,${Buffer.from(evidenceBytes).toString("base64")}`,
  }];
  const shift: ShiftDetails = { title: "Laporan Jaga PERINA Test", date: "2026-10-03", department: "Perinatologi", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test", metadata: { student: "Mahasiswa Test" } };
  const generated = await generatePresentation(template, [patient], template.bindings, shift);
  const generatedBytes = new Uint8Array(await generated.blob.arrayBuffer());
  await writeFile("/tmp/jamed-perina-evidence.pptx", generatedBytes);
  const output = await JSZip.loadAsync(generatedBytes);
  const chartXml = await output.file("ppt/slides/slide8.xml")!.async("string");
  const radiologyXml = await output.file("ppt/slides/slide13.xml")!.async("string");
  const radiologyRels = await output.file("ppt/slides/_rels/slide13.xml.rels")!.async("string");
  expect(chartXml).toContain('name="Koasis PERINA weight-for-gestational-age marker"');
  expect(chartXml).toContain('name="Koasis PERINA length-for-gestational-age marker"');
  expect(chartXml).toContain('name="Koasis PERINA head-circumference marker"');
  expect(chartXml.match(/Prematur 30\+5 minggu, AGA\./g)).toHaveLength(1);
  expect(chartXml).toContain("Ballard score: 18");
  expect(chartXml).not.toContain("ekuivalen sekitar 31 minggu");
  expect(radiologyXml).toContain("<p:pic>");
  expect(radiologyXml.match(/Gambaran sesuai dengan RDS neonatal\./g)).toHaveLength(1);
  expect(radiologyRels).toContain("Target=\"../media/koasis-radiology-1-1.png\"");
  expect(radiologyRels).toContain("koasis-radiology-1-1.png");
  expect(output.file("ppt/media/koasis-radiology-1-1.png")).toBeTruthy();
});

test("new PERINA HARKIT and RSUT templates keep adaptive neonatal chart markers", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const patient = extractPatients("Pasien 1\nNama: By. Chart\nJenis kelamin: Perempuan", "perina-chart-source").patients[0];
  patient.demographics.weightKg = documented(1.45);
  patient.demographics.heightCm = documented(40);
  patient.templateData = {
    ...(patient.templateData || {}),
    gestationalAge: documented("30 minggu 5 hari"),
    headCircumference: documented("28,5 cm"),
  };
  const shift: ShiftDetails = {
    title: "Laporan Jaga PERINA Chart Test",
    date: "2026-10-03",
    department: "Perinatologi",
    hospital: "RS Test",
    team: "Tim A",
    facilitator: "Fasilitator Test",
    dpjp: "DPJP Test",
    metadata: { student: "Mahasiswa Test", perinaTeam: "Perinatologi Test" },
  };

  for (const fileName of ["[TEMPLATE} PERINA HARKIT.pptx", "[TEMPLATE} PERINA RSUT.pptx"]) {
    const templateEntry = Object.keys(archive.files).find((name) => name.endsWith(fileName));
    expect(templateEntry, fileName).toBeTruthy();
    const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
    const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
    const template = await parsePptx(templateBuffer, fileName);
    const generated = await generatePresentation(template, [patient], template.bindings, shift);
    const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
    const chartXml = await output.file("ppt/slides/slide8.xml")!.async("string");
    expect(chartXml, fileName).toContain('name="Koasis PERINA weight-for-gestational-age marker"');
    expect(chartXml, fileName).toContain('name="Koasis PERINA length-for-gestational-age marker"');
    expect(chartXml, fileName).toContain('name="Koasis PERINA head-circumference marker"');
  }
});

test("custom upload starts from a generic snapshot and accepts an adaptive agent contract", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const entry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] RSUI.pptx"));
  expect(entry).toBeTruthy();
  const bytes = await archive.file(entry!)!.async("uint8array");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  // The filename intentionally contains a known built-in name. A custom upload
  // must still be parsed generically until the template agent returns its own contract.
  const custom = await parsePptx(buffer, "RSUI-custom-department.pptx", "generic");
  expect(custom.profileId).toBe("generic");
  const snapshot = buildTemplateSnapshot(custom);
  expect(snapshot.slides).toHaveLength(custom.slideCount);
  expect(snapshot.slides.every((slide) => Array.isArray(slide.shapes))).toBe(true);

  const editableShape = custom.slides.flatMap((slide) => slide.shapes).find((shape) => shape.kind === "text")!;
  const analyzed = applyTemplateAnalysis(custom, {
    label: "Template departemen custom",
    description: "Kontrak hasil pembelajaran agent.",
    extractionInstructions: "Ikuti batas section template custom.",
    patientInputHint: "Upload catatan per pasien.",
    shiftFields: [{ key: "supervisor", label: "Supervisor jaga", placeholder: "Nama supervisor", required: true }],
    fieldGroups: [{
      id: "custom-clinical",
      label: "Section klinis custom",
      description: "Field yang ditemukan agent.",
      fields: [{ key: "templateData.customSection", label: "Section khusus", placeholder: "Isi dari source", multiline: true, required: false }],
    }],
    slides: [{ index: 0, label: "Cover custom", role: "cover", repeat: false, fields: ["shift.custom:supervisor"], instructions: "Isi metadata cover." }],
    bindings: [{ slideIndex: 0, shapeId: editableShape.id, semanticField: "shift.custom", templateKey: "supervisor", confidence: 0.95 }],
    warnings: [],
    confidence: 0.95,
  }, "agent", "test-model");

  expect(analyzed.templateAnalysis?.source).toBe("agent");
  expect(analyzed.templateAnalysis?.model).toBe("test-model");
  expect(analyzed.templateAnalysis?.shiftFields[0]?.key).toBe("supervisor");
  expect(getTemplateProfile(analyzed).shiftFields[0]?.key).toBe("supervisor");
  expect(analyzed.bindings).toHaveLength(1);
  expect(analyzed.bindings[0]?.semanticField).toBe("shift.custom");

  const guidedSlides = custom.slides.map((slide, index) => ({
    index,
    label: slide.title || `Slide ${index + 1}`,
    role: slide.role,
    repeat: false,
    inclusion: index === 1 ? "example" : "routine",
    fields: [],
    instructions: "Pertahankan batas layout dan konteks slide.",
  }));
  const guided = applyTemplateAnalysis(custom, {
    slides: guidedSlides,
    bindings: [{ slideIndex: 0, shapeId: editableShape.id, semanticField: "shift.custom", templateKey: "supervisor", confidence: 0.95 }],
  }, "agent", "test-model");
  expect(guided.slides[1]?.inclusion).toBe("example");
  expect(guided.slides[1]?.include).toBe(false);

  const manuallyMapped = applyTemplateAnalysis({
    ...custom,
    bindings: [{ slideIndex: 0, shapeId: editableShape.id, semanticField: "shift.team", confidence: 1, source: "user" }],
  }, {
    bindings: [{ slideIndex: 0, shapeId: editableShape.id, semanticField: "shift.custom", templateKey: "supervisor", confidence: 0.95 }],
  }, "agent", "test-model");
  expect(manuallyMapped.bindings[0]?.semanticField).toBe("shift.team");
});

test("lapjag generation never carries sample diagnosis/radiology/nutrition into a new patient", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] Lapjag.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] Lapjag.pptx");
  const patient = extractPatients(syntheticNotes, "guardrail-source").patients[0];
  const labs: InvestigationItem[] = [
    { name: "Hematokrit", result: "33.8", unit: "%" },
    { name: "Leukosit", result: "18,700", unit: "/µL" },
  ];
  const organs: OrganFinding[] = [{ organ: "Thoraks", description: "Retraksi interkostal; ronki inspirasi halus basal kanan." }];
  patient.investigations.laboratory = documented(labs);
  patient.investigations.imaging = documented([{ name: "Foto toraks AP", result: "Konsolidasi lobus bawah kanan dengan air bronchogram; tanpa efusi." }]);
  patient.physicalExam.organFindings = documented(organs);
  patient.templateData = {
    ...patient.templateData,
    nutritionConclusion: documented("Cukup gizi; tidak terdapat wasting yang jelas."),
  };
  const shift: ShiftDetails = { title: "Laporan Jaga Guardrail", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, [patient], template.bindings, shift);
  const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const text = (await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")))).join(" ");

  expect(text).toContain("PASIEN BARU: 1 PASIEN");
  expect(text).toContain("Konsolidasi lobus bawah kanan dengan air bronchogram; tanpa efusi.");
  expect(text).toContain("Retraksi interkostal; ronki inspirasi halus basal kanan.");
  expect(text).toContain("33.8");
  expect(text).not.toContain("CTI 0,62");
  expect(text).not.toContain("GIZI BURUK");
  expect(text).not.toContain("Syok hipovolemia e.c. diare akut");
});

test("generated PPTX removes XML-invalid control characters from clinical notes", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const templateEntry = Object.keys(archive.files).find((name) => name.endsWith("[TEMPLATE] Lapjag.pptx"));
  expect(templateEntry).toBeTruthy();
  const templateBytes = await archive.file(templateEntry!)!.async("uint8array");
  const templateBuffer = templateBytes.buffer.slice(templateBytes.byteOffset, templateBytes.byteOffset + templateBytes.byteLength) as ArrayBuffer;
  const template = await parsePptx(templateBuffer, "[TEMPLATE] Lapjag.pptx");
  const patient = extractPatients("Pasien 1\nNama: An. Kontrol\nKeluhan Utama: Sesak\u000bnapas\nRPS: Catatan\u000ccopy-paste", "control-source").patients[0];
  const shift: ShiftDetails = { title: "Laporan Jaga Kontrol", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, [patient], template.bindings, shift);
  const output = await JSZip.loadAsync(new Uint8Array(await generated.blob.arrayBuffer()));
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const text = (await Promise.all(slideFiles.map((name) => output.file(name)!.async("string")))).join(" ");
  expect(text).toContain("Sesaknapas");
  expect(text).toContain("Catatancopy-paste");
  expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
});
