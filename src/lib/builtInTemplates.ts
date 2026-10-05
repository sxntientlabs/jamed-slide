import JSZip from "jszip";

export interface BuiltInTemplateEntry {
  archivePath: string;
  fileName: string;
  label: string;
}

export const BUILT_IN_TEMPLATE_ARCHIVE_URL = "/templates/Template%20laporan%20jaga.zip";

const BUILT_IN_DISPLAY_LABELS: Record<string, string> = {
  Lapjag: "Perina RSAB",
  "PERINA RSAB": "IGD RSAB",
  RSCM: "IGD RSCM",
  RSUI: "IGD RSUI",
  "PERINA Lapjag": "Perina RSCM",
};

let archivePromise: Promise<JSZip> | undefined;

function getArchive(): Promise<JSZip> {
  if (!archivePromise) {
    archivePromise = fetch(BUILT_IN_TEMPLATE_ARCHIVE_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Arsip template bawaan tidak bisa dimuat.");
        return response.arrayBuffer();
      })
      .then((buffer) => JSZip.loadAsync(buffer));
  }
  return archivePromise;
}

function displayLabel(fileName: string): string {
  const base = fileName.split("/").pop()?.replace(/\.pptx$/i, "") ?? fileName;
  const normalized = base
    .replace(/^\[?TEMPLATE[}\]]?\s*/i, "")
    .replace(/[{}\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return BUILT_IN_DISPLAY_LABELS[normalized] ?? normalized;
}

export async function loadBuiltInTemplateCatalog(): Promise<BuiltInTemplateEntry[]> {
  const archive = await getArchive();
  return Object.keys(archive.files)
    .filter((fileName) => fileName.toLowerCase().endsWith(".pptx"))
    .sort((left, right) => left.localeCompare(right))
    .map((archivePath) => {
      const fileName = archivePath.split("/").pop() ?? archivePath;
      return { archivePath, fileName, label: displayLabel(fileName) };
    });
}

export async function loadBuiltInTemplate(entry: BuiltInTemplateEntry): Promise<ArrayBuffer> {
  const archive = await getArchive();
  const file = archive.file(entry.archivePath);
  if (!file) throw new Error(`Template bawaan ${entry.label} tidak ditemukan di arsip.`);
  return file.async("arraybuffer");
}
