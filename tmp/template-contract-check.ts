import { readFile } from "node:fs/promises";
import { parsePptx } from "../src/lib/pptxParser";
import { validateTemplateContract } from "../src/lib/templateContract";

for (const file of ["Laporan Jaga/Template Baru IGD HARKIT.pptx", "Laporan Jaga/Template Jaga Baru RSUI.pptx"]) {
  const raw = await readFile(file);
  const template = await parsePptx(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), file.split("/").pop());
  const validation = validateTemplateContract(template);
  console.log(template.slides[13]?.shapes.map((shape) => ({ id: shape.id, kind: shape.kind, text: shape.text.slice(0, 40), binding: template.bindings.find((binding) => binding.slideIndex === 13 && binding.shapeId === shape.id) })));
  console.log(file, JSON.stringify(validation, null, 2));
}
