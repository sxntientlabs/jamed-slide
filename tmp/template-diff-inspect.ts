import { readFile } from "node:fs/promises";
import { parsePptx } from "../src/lib/pptxParser";
import { getTemplateProfile } from "../src/lib/templateProfiles";
import { validateTemplateContract } from "../src/lib/templateContract";

const files = [
  "Laporan Jaga/[TEMPLATE] IGD HARKIT.pptx",
  "Laporan Jaga/Template Baru IGD HARKIT.pptx",
  "Laporan Jaga/[TEMPLATE] RSUI.pptx",
  "Laporan Jaga/Template Jaga Baru RSUI.pptx",
];

for (const file of files) {
  const raw = await readFile(file);
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const template = await parsePptx(buf, file.split("/").pop());
  const profile = getTemplateProfile(template);
  const validation = validateTemplateContract({ ...template, templateAnalysis: undefined });
  console.log(JSON.stringify({
    file,
    bytes: raw.byteLength,
    profileId: template.profileId,
    slideCount: template.slideCount,
    validation: { valid: validation.valid, score: validation.score, errors: validation.errors, warnings: validation.warnings },
    profile: { label: profile.label, shiftFields: profile.shiftFields.map((field) => field.key), guideCount: profile.slideGuides.length },
    slides: template.slides.map((slide) => ({
      index: slide.index,
      title: slide.title,
      role: slide.role,
      repeat: slide.repeat,
      inclusion: slide.inclusion,
      include: slide.include,
      patientScope: slide.patientScope,
      speakerNotes: slide.speakerNotes,
      shapes: slide.shapes.length,
      tables: slide.shapes.filter((shape) => shape.kind === "graphicFrame").map((shape) => ({ id: shape.id, name: shape.name, rows: shape.tableRows?.length, cols: shape.tableRows?.[0]?.length, text: shape.text.slice(0, 120) })),
      text: slide.text.slice(0, 500),
      bindings: template.bindings.filter((binding) => binding.slideIndex === slide.index).map((binding) => ({ shapeId: binding.shapeId, field: binding.semanticField, key: binding.templateKey, confidence: binding.confidence })),
    })),
  }, null, 2));
}
