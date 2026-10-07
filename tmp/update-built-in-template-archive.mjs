import { copyFile, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const archivePath = "Template laporan jaga.zip";
const publicArchivePath = "public/templates/Template laporan jaga.zip";
const archive = await JSZip.loadAsync(await readFile(archivePath));

const replacements = new Map([
  ["Laporan Jaga/[TEMPLATE] IGD HARKIT.pptx", "Laporan Jaga/Template Baru IGD HARKIT.pptx"],
  ["Laporan Jaga/[TEMPLATE] RSUI.pptx", "Laporan Jaga/Template Jaga Baru RSUI.pptx"],
]);

for (const [archiveEntry, sourcePath] of replacements) {
  archive.file(archiveEntry, await readFile(sourcePath));
}

const output = await archive.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 },
});
await writeFile(archivePath, output);
await copyFile(archivePath, publicArchivePath);
console.log(`Updated ${archivePath} and ${publicArchivePath}`);
