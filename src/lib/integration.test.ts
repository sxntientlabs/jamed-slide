import { expect, test } from "vitest";
import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractPatients } from "./clinicalParser";
import { generatePresentation } from "./pptxGenerator";
import { parsePptx } from "./pptxParser";
import { getTemplateProfile } from "./templateProfiles";
import { applyTemplateAnalysis, buildTemplateSnapshot } from "./templateAnalyzer";
import type { ShiftDetails } from "../types";

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
  expect(template.slides.some((slide) => slide.title.includes("ASSESSMENT"))).toBe(true);
  const patient = extractPatients(syntheticNotes, "lapjag-source").patients[0];
  const shift: ShiftDetails = { title: "Laporan Jaga Test", date: "2026-10-01", department: "Pediatri", hospital: "RS Test", team: "Tim A", facilitator: "Fasilitator Test", dpjp: "DPJP Test" };
  const generated = await generatePresentation(template, [patient], template.bindings, shift);
  const generatedBytes = new Uint8Array(await generated.blob.arrayBuffer());
  await writeFile("/tmp/jamed-lapjag-final.pptx", generatedBytes);
  const output = await JSZip.loadAsync(generatedBytes);
  const slideFiles = Object.keys(output.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
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
  expect(await output.file("ppt/slides/_rels/slide11.xml.rels")!.async("string")).toContain("jamed-who-lhfa-boys.png");
  expect(await output.file("ppt/slides/slide11.xml")!.async("string")).toContain("JaMed WHO plot marker");
});

test("built-in department profiles map their slide contracts and generate independently", async () => {
  const archiveBytes = await readFile(resolve(process.cwd(), "Template laporan jaga.zip"));
  const archive = await JSZip.loadAsync(archiveBytes);
  const cases = [
    { fileName: "[TEMPLATE} PERINA Lapjag.pptx", profileId: "perina-lapjag", slideCount: 15, requiredKey: "antenatalConsultation" },
    { fileName: "[TEMPLATE] PERINA RSAB.pptx", profileId: "perina-rsab", slideCount: 15, requiredKey: "resuscitationTimeline" },
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
});
