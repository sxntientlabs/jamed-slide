import { agentNeedsExternalSource, type AgentId } from "./agentCatalog";

const RESEARCH_TERMS = /\b(?:evidence(?:[- ]based)?|referensi|references?|sumber|source|sitasi|citation|jurnal|journal|paper|artikel|article|guideline|pedoman|literatur|literature|database|pubmed|cochrane|doi|pmid|riset|research|studi|study|meta[- ]analisis|meta[- ]analysis|systematic review|tinjauan sistematis|diagnos(?:is|tik)|diagnostic|terapi|tatalaksana|treatment|obat|medication|dosis|dose|penyakit|disease|gejala|symptom|prognosis|skrining|screening|pencegahan|prevention|risiko|risk|efek samping|adverse effect|kriteria|criteria|etiologi|aetiology|patogenesis|pathogenesis|penularan|transmission|vaksin|vaccine|prevalensi|prevalence|insidensi|incidence|mortalitas|mortality|sensitivitas|sensitivity|spesifisitas|specificity)\b/i;
const SEARCH_INTENT_TERMS = /\b(?:cari|carikan|telusuri|search|find|bandingkan|compare|tinjau|review|evaluasi|appraise|apa buktinya|what is the evidence|literature review|evidence review)\b/i;
const KNOWLEDGE_OPENERS = /^\s*(?:apa|apakah|jelaskan|terangkan|bagaimana|mengapa|kenapa|kapan|berapa|what|whether|explain|how|why|when|which|does|should|can)\b/i;
const FORMAT_ONLY_OPENERS = /^\s*(?:buat|bikin|susun|tulis|rapikan|ubah|terjemahkan|format|ringkas|rangkum|generate|draft)\b/i;
const FORMAT_ONLY_TERMS = /\b(?:pesan|email|chat|handover|template|outline|notulen|catatan|tabel|slide|ppt|presentasi|checklist|jadwal|rencana kerja)\b/i;

/**
 * Classifies prompts that need an evidence lookup before the model can safely
 * make a factual or clinical claim. Formatting and workflow requests stay
 * local unless they also contain a knowledge/source signal.
 */
export function promptNeedsEvidence(prompt: string, agentId: AgentId): boolean {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const hasResearchTerm = RESEARCH_TERMS.test(normalized);
  const isFormatOnly = FORMAT_ONLY_OPENERS.test(normalized) && FORMAT_ONLY_TERMS.test(normalized) && !hasResearchTerm;
  if (isFormatOnly) return false;
  const isKnowledgeQuestion = normalized.includes("?") || KNOWLEDGE_OPENERS.test(normalized);
  const isSearchRequest = SEARCH_INTENT_TERMS.test(normalized);

  if (hasResearchTerm || isKnowledgeQuestion || isSearchRequest) return true;
  if (agentNeedsExternalSource(agentId)) return normalized.length >= 20;
  return false;
}
