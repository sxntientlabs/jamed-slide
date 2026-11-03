import { agentNeedsExternalSource, type AgentId } from "./agentCatalog";

const RESEARCH_TERMS = /\b(?:evidence(?:[- ]based)?|referensi|references?|sumber|source|sitasi|citation|jurnal|journal|paper|artikel|article|guideline|pedoman|literatur|literature|database|pubmed|cochrane|doi|pmid|riset|research|studi|study|meta[- ]analisis|meta[- ]analysis|systematic review|tinjauan sistematis|diagnos(?:is|tik)|diagnostic|terapi|tatalaksana|treatment|obat|medication|dosis|dose|penyakit|disease|gejala|symptom|prognosis|skrining|screening|pencegahan|prevention|risiko|risk|efek samping|adverse effect|kriteria|criteria|etiologi|aetiology|patogenesis|pathogenesis|penularan|transmission|vaksin|vaccine|prevalensi|prevalence|insidensi|incidence|mortalitas|mortality|sensitivitas|sensitivity|spesifisitas|specificity)\b/i;
const SEARCH_INTENT_TERMS = /\b(?:cari|carikan|telusuri|search|find|bandingkan|compare|tinjau|review|evaluasi|appraise|apa buktinya|what is the evidence|literature review|evidence review)\b/i;
const KNOWLEDGE_OPENERS = /^\s*(?:apa|apakah|jelaskan|terangkan|bagaimana|mengapa|kenapa|kapan|berapa|what|whether|explain|how|why|when|which|does|should|can)\b/i;
const FORMAT_ONLY_OPENERS = /^\s*(?:buat|bikin|susun|tulis|rapikan|ubah|terjemahkan|format|ringkas|rangkum|generate|draft)\b/i;
const FORMAT_ONLY_TERMS = /\b(?:pesan|email|chat|handover|template|outline|notulen|catatan|tabel|slide|ppt|presentasi|checklist|jadwal|rencana kerja)\b/i;
const EVIDENCE_WORKFLOW_TERMS = /\b(?:clinical prebrief|prebrief|evidence brief|critical appraisal|case presentation|presentasi kasus|guideline review|review guideline|clinical review|review klinis)\b/i;
const KOASIS_META_TERMS = /\b(?:model|versi|reasoning|effort|mode|sesi|session|status|pengaturan|setting|konfigurasi|computer|agent|assistant|ui|antarmuka|aplikasi)\b/i;
const KOASIS_META_CONTEXT = /\b(?:koasis|sesi ini|session ini|yang aktif|sedang aktif|yang dipakai|digunakan di sini|di aplikasi ini|di ui|di chat|percakapan ini)\b/i;

/**
 * The chat client renders connected evidence as numbered, clickable citation
 * chips and a structured reference panel. Keep this contract shared by the
 * local model path and the Hermes bridge so a provider cannot switch to an
 * unresolvable author/URL bibliography in the visible answer.
 */
export const KOASIS_CITATION_FORMAT_POLICY = [
  "Jika evidence_sources bernomor tersedia, gunakan hanya citation numerik [1], [2], dan seterusnya yang benar-benar sesuai daftar.",
  "Letakkan citation segera setelah kalimat atau klaim yang didukung; jangan gunakan satu citation untuk klaim yang tidak didukung sumber tersebut.",
  "Jangan menulis bibliografi inline seperti 'Rujukan utama:', 'Referensi:', 'Daftar pustaka:', nama penulis/tahun, DOI, PMID, atau URL di badan jawaban biasa; Koasis menampilkan daftar Referensi terstruktur secara otomatis.",
  "Jangan mengganti citation numerik dengan citation berbasis nama penulis, tahun, DOI, PMID, atau URL. Jika tidak yakin sumber mana yang mendukung, nyatakan keterbatasannya tanpa citation.",
].join(" ");

export function isKoasisMetadataPrompt(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return Boolean(normalized && !RESEARCH_TERMS.test(normalized) && KOASIS_META_TERMS.test(normalized) && KOASIS_META_CONTEXT.test(normalized));
}

/**
 * Classifies prompts that need an evidence lookup before the model can safely
 * make a factual or clinical claim. Formatting and workflow requests stay
 * local unless they also contain a knowledge/source signal.
 */
export function promptNeedsEvidence(prompt: string, agentId: AgentId): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const hasResearchTerm = RESEARCH_TERMS.test(normalized);
  // Questions about the Koasis UI/session are answered from trusted app
  // context. Sending them to literature search produces convincing-looking
  // but unrelated papers (for example, searching "model aktif di Koasis").
  if (isKoasisMetadataPrompt(normalized)) return false;
  const isFormatOnly = FORMAT_ONLY_OPENERS.test(normalized) && FORMAT_ONLY_TERMS.test(normalized) && !hasResearchTerm;
  if (isFormatOnly) return false;
  const isKnowledgeQuestion = normalized.includes("?") || KNOWLEDGE_OPENERS.test(normalized);
  const isSearchRequest = SEARCH_INTENT_TERMS.test(normalized);

  if (hasResearchTerm || isKnowledgeQuestion || isSearchRequest) return true;
  // Source-required specialists still need an automatic lookup for their
  // named evidence workflows, but not for arbitrary instructions such as
  // "jawab hanya dengan..." or a Computer action. This prevents a slow and
  // noisy search preflight from hijacking unrelated work.
  return agentNeedsExternalSource(agentId) && EVIDENCE_WORKFLOW_TERMS.test(normalized);
}
