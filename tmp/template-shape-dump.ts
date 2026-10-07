import { readFile } from "node:fs/promises";
import { parsePptx } from "../src/lib/pptxParser";

const files = ["Laporan Jaga/Template Baru IGD HARKIT.pptx", "Laporan Jaga/Template Jaga Baru RSUI.pptx"];
for (const file of files) {
  const raw = await readFile(file);
  const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const template = await parsePptx(buffer, file.split("/").pop());
  console.log(`\n### ${file} (${template.slideCount})`);
  for (const slide of template.slides) {
    console.log(`\nSLIDE ${slide.index + 1} | role=${slide.role} | repeat=${slide.repeat} | title=${JSON.stringify(slide.title)}`);
    for (const [shapeIndex, shape] of slide.shapes.entries()) {
      const pos = [shape.x, shape.y, shape.width, shape.height].map((value) => value === undefined ? "?" : value.toFixed(2)).join(",");
      const table = shape.tableRows ? ` table=${shape.tableRows.length}x${shape.tableRows[0]?.length ?? 0}` : "";
      console.log(`  [${shapeIndex}] id=${shape.id} kind=${shape.kind} ph=${shape.placeholderType ?? "-"} pos=${pos}${table} text=${JSON.stringify(shape.text.slice(0, 380))}`);
    }
    const bindings = template.bindings.filter((binding) => binding.slideIndex === slide.index);
    console.log(`  BINDINGS: ${bindings.map((binding) => `${binding.shapeId}=>${binding.semanticField}${binding.templateKey ? `:${binding.templateKey}` : ""}`).join(" | ")}`);
  }
}
