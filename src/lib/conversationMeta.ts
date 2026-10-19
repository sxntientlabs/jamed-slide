import type { EvidenceSource } from "./evidenceSearchClient";

export type ConversationMetaMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationTitleOptions = {
  sources?: EvidenceSource[];
  agentLabel?: string;
};

export type FollowUpQuestionInput = {
  prompt: string;
  answer: string;
  sources?: EvidenceSource[];
  agentLabel?: string;
};

const STOP_WORDS = new Set([
  "a", "about", "ada", "agar", "akan", "aku", "anda", "antara", "apa", "apakah", "atau", "and", "bagi", "bagaimana", "bahwa", "baik", "baru", "beberapa", "belum", "bisa", "buat", "dan", "dapat", "dari", "dengan", "di", "dalam", "dijelaskan", "untuk", "dulu", "fitur", "from", "guna", "hal", "hingga", "how", "i", "ia", "in", "ini", "is", "itu", "jadi", "jelaskan", "jika", "juga", "kah", "kamu", "karena", "ke", "keadaan", "kemudian", "ketika", "khusus", "kita", "lagi", "lebih", "lalu", "mau", "melalui", "mencari", "mengenai", "menjadi", "menurut", "meski", "minimal", "my", "of", "on", "oleh", "pada", "pakai", "paling", "perlu", "please", "research", "saja", "sama", "saya", "sebagai", "secara", "seperti", "serta", "sudah", "supaya", "tentang", "terhadap", "the", "this", "to", "tolong", "topik", "topic", "tugas", "yang", "you", "your", "bantu", "carikan", "cari", "kirim", "mohon", "riset", "terbaru", "gunakan", "with", "after", "before", "among", "against", "at", "during", "for", "into", "using", "versus",
  "answer", "based", "body", "case", "could", "current", "evidence", "explain", "find", "following", "give", "help", "identify", "information", "knowledge", "latest", "look", "need", "question", "review", "search", "source", "sources", "study", "tell", "trustworthy", "what", "where", "which", "why",
]);

const GENERIC_TERMS = new Set([
  "analisis", "artikel", "bahasan", "catatan", "data", "detail", "diskusi", "hasil", "informasi", "jawaban", "kasus", "konteks", "langkah", "masalah", "pembahasan", "penjelasan", "pertanyaan", "referensi", "ringkasan", "sumber", "temuan", "ulasan", "valid", "working", "clinical", "medical", "paper", "papers", "journal", "journals", "trust", "qualitative", "clarify", "desk", "citation", "guideline", "guidelines", "pencarian", "ingin", "berikan", "tetas", "jurnal", "evidence", "compare", "comparison",
]);

const INTENT_PREFIXES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:jurnal|referensi|evidence|literatur|paper|citation|guideline|sumber)\b/i, label: "Evidence" },
  { pattern: /\b(?:bandingkan|perbandingan|beda|vs\.?|compare|comparison)\b/i, label: "Perbandingan" },
  { pattern: /\b(?:belajar|jelaskan|pahami|study|teach|konsep)\b/i, label: "Belajar" },
  { pattern: /\b(?:buat|susun|siapkan|rencana|draft|checklist|plan)\b/i, label: "Rencana" },
  { pattern: /\b(?:review|tinjau|evaluasi|audit|cek)\b/i, label: "Review" },
];

function cleanText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?(?:\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/g, " ")
    .replace(/\[(?:\d+|(?:doi|pmid|pmcid):[^\]]+)\]/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`>#~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedWords(value: string): string[] {
  return cleanText(value)
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !GENERIC_TERMS.has(word) && !/^\d+$/.test(word));
}

const KNOWN_ACRONYMS = new Set(["ats", "ct", "doi", "ecg", "hiv", "idsa", "icu", "mri", "nice", "pico", "pmcid", "pmid", "tb", "who", "xpert"]);

function displayTerm(value: string): string {
  if (KNOWN_ACRONYMS.has(value.toLocaleLowerCase("id-ID"))) return value.toUpperCase();
  return value.charAt(0).toLocaleUpperCase("id-ID") + value.slice(1);
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const shortened = normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || normalized.slice(0, maxLength - 1)}…`;
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("id-ID").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSubjectPhrases(value: string): string[] {
  const cleaned = cleanText(value);
  const phrases: string[] = [];
  const patterns = [
    /\b(?:tentang|mengenai|terkait|membahas|mengenai|about|regarding|for)\s+([^.!?;:]{3,90})/gi,
    /\b(?:jelaskan|explain|review|cari(?:kan)?|find|research)\s+(?:tentang|mengenai|about|for)?\s*([^.!?;:]{3,90})/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of cleaned.matchAll(pattern)) {
      const phrase = match[1]?.replace(/\b(?:dan|lalu|kemudian|dengan|untuk)\s*$/i, "").trim();
      const topicalWords = phrase ? normalizedWords(phrase).slice(0, 5).map(displayTerm) : [];
      if (topicalWords.length) phrases.push(compact(topicalWords.join(" "), 46));
    }
  });
  return uniqueValues(phrases);
}

function extractHeadings(value: string): string[] {
  const headings = value.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim().replace(/^[-*•\d.)]+\s*/, "").replace(/^#{1,6}\s*/, "").trim();
    if (!trimmed || trimmed.length < 4 || trimmed.length > 100) return [];
    const isHeading = /^#{1,6}\s/.test(line.trim()) || /^\*\*[^*]+\*\*:?$/.test(line.trim()) || /:$/.test(trimmed);
    return isHeading ? [trimmed.replace(/^\*\*|\*\*:?$/g, "")] : [];
  });
  return uniqueValues(headings).filter((heading) => normalizedWords(heading).length >= 1).slice(0, 6);
}

function topTerms(messages: ConversationMetaMessage[], sources: EvidenceSource[] = []): string[] {
  const scores = new Map<string, { score: number; firstSeen: number }>();
  let position = 0;
  const add = (value: string, weight: number) => {
    normalizedWords(value).forEach((word) => {
      const current = scores.get(word);
      if (current) current.score += weight;
      else scores.set(word, { score: weight, firstSeen: position });
      position += 1;
    });
  };
  messages.slice(0, 8).forEach((message, index) => add(message.content, message.role === "user" ? 4 - Math.min(index, 2) : 1));
  sources.slice(0, 5).forEach((source) => add(source.title, 2));
  return [...scores.entries()]
    .sort(([, left], [, right]) => right.score - left.score || left.firstSeen - right.firstSeen)
    .slice(0, 5)
    .map(([word]) => displayTerm(word));
}

function intentLabel(messages: ConversationMetaMessage[], agentLabel?: string): string {
  const opening = messages.filter((message) => message.role === "user").slice(0, 3).map((message) => message.content).join(" ");
  const matched = INTENT_PREFIXES.find((candidate) => candidate.pattern.test(opening));
  if (matched) return matched.label;
  if (/evidence|jurnal|referensi/i.test(agentLabel || "")) return "Evidence";
  if (/study|desk|belajar/i.test(agentLabel || "")) return "Belajar";
  return "Diskusi";
}

/**
 * Builds a compact, semantic title from the opening turns of a session. It
 * deliberately ignores the welcome message and never copies a full prompt.
 * The title can improve after the second or third user turn while remaining
 * stable once the conversation has moved beyond its opening context.
 */
export function buildConversationTitle(messages: ConversationMetaMessage[], options: ConversationTitleOptions = {}): string {
  const opening = messages.filter((message) => message.content.trim()).slice(0, 8);
  const userMessages = opening.filter((message) => message.role === "user");
  if (!userMessages.length) return "Percakapan baru";

  const phrases = uniqueValues(userMessages.slice(0, 3).flatMap((message) => extractSubjectPhrases(message.content)));
  const headings = uniqueValues(opening.filter((message) => message.role === "assistant").flatMap((message) => extractHeadings(message.content)));
  const phraseWords = new Set(phrases.flatMap((phrase) => normalizedWords(phrase)));
  const rankedTerms = topTerms(opening, options.sources);
  const additionalTerms = rankedTerms.filter((term) => !phraseWords.has(term.toLocaleLowerCase("id-ID"))).slice(0, 3);
  const topicParts = [...phrases.slice(0, 2), ...additionalTerms].filter(Boolean);
  if (!topicParts.length) topicParts.push(...headings.slice(0, 2));
  const topic = compact(topicParts.join(" · ") || topTerms(opening, options.sources).join(" · ") || "Topik lintas sesi", 52);
  return compact(`${intentLabel(opening, options.agentLabel)} · ${topic}`, 68);
}

function questionHash(input: string): number {
  let hash = 2166136261;
  for (const character of input) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceShortTitle(source: EvidenceSource): string {
  return compact(source.title.replace(/[.!?]+$/, ""), 58);
}

function sourceReferenceLabel(source: EvidenceSource, index: number): string {
  const identifier = source.doi || source.pmid || source.pmcid;
  return identifier ? `[${index + 1}] ${identifier}` : `[${index + 1}] ${sourceShortTitle(source)}`;
}

function questionTopic(prompt: string, answer: string, sources: EvidenceSource[]): string {
  const phrase = extractSubjectPhrases(prompt)[0];
  if (phrase) return compact(phrase, 64);
  const heading = extractHeadings(answer)[0];
  if (heading) return compact(heading, 64);
  return compact(topTerms([{ role: "user", content: prompt }, { role: "assistant", content: answer }], sources).slice(0, 3).join(" ") || "topik ini", 64);
}

function generatedQuestion(value: string): string {
  return compact(value.replace(/\s+/g, " ").trim(), 180).replace(/[.!?]+$/, "?");
}

/**
 * Creates follow-ups from the current answer and its evidence graph. The
 * wording varies with the detected headings, topic, source titles, and
 * visual evidence; this is intentionally not a fixed three-item template.
 */
export function buildUniqueFollowUpQuestions(input: FollowUpQuestionInput): string[] {
  const prompt = input.prompt.trim();
  const answer = input.answer.trim();
  if (!prompt || !answer) return [];
  const sources = (input.sources || []).filter((source) => source.title && source.url).slice(0, 8);
  const topic = questionTopic(prompt, answer, sources);
  const headings = extractHeadings(answer);
  const sourceQuestionSeed = questionHash(`${prompt}\n${answer}\n${sources.map((source) => source.id).join("|")}`);
  const questions: string[] = [];

  if (sources.length >= 2) {
    const left = sources[sourceQuestionSeed % Math.min(sources.length, 3)];
    const right = sources[(sourceQuestionSeed + 1) % Math.min(sources.length, 3)];
    if (left && right && left.id !== right.id) {
      questions.push(generatedQuestion(`Bagaimana kesimpulan ${sourceShortTitle(left)} dibandingkan dengan ${sourceShortTitle(right)} untuk ${topic}, dan di bagian mana keduanya belum sepakat?`));
    }
  }

  if (headings.length >= 2) {
    const firstHeading = headings[sourceQuestionSeed % Math.min(headings.length, 3)];
    const secondHeading = headings[(sourceQuestionSeed + 1) % Math.min(headings.length, 3)];
    if (firstHeading && secondHeading && firstHeading !== secondHeading) {
      questions.push(generatedQuestion(`Dari bagian ${firstHeading} dan ${secondHeading}, temuan mana yang paling mengubah pemahaman tentang ${topic}?`));
    }
  }

  const figureSource = sources.find((source) => source.figures?.length);
  if (figureSource) {
    const figure = figureSource.figures?.[0];
    questions.push(generatedQuestion(`Apa pesan utama dari ${figure?.label || "temuan visual"} pada ${sourceReferenceLabel(figureSource, sources.indexOf(figureSource))} untuk ${topic}, dan apa batas interpretasinya?`));
  }

  const uncertainty = /(?:terbatas|belum cukup|uncertain|unclear|ketidakpastian|missing|perlu diverifikasi|tidak dapat dipastikan)/i.test(answer);
  if (uncertainty) {
    questions.push(generatedQuestion(`Bukti tambahan apa yang paling tepat untuk menguji bagian yang masih belum pasti dalam pembahasan ${topic}?`));
  } else {
    questions.push(generatedQuestion(`Jika ${topic} diterapkan pada konteks yang berbeda, variabel apa yang paling mungkin mengubah kesimpulannya?`));
  }

  questions.push(generatedQuestion(`Apa implikasi praktis yang bisa ditarik dari jawaban ini untuk langkah berikutnya terkait ${topic}, tanpa melampaui evidence yang tersedia?`));

  return uniqueValues(questions).slice(0, 3);
}
