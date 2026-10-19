export type EvidenceProviderId = "pubmed" | "europepmc" | "openalex" | "crossref";

export type EvidenceRetractedStatus = "retracted" | "corrected" | "unknown";

export type EvidenceProviderState = {
  provider: EvidenceProviderId;
  status: "ok" | "error" | "empty";
  returned: number;
  hitCount?: number;
  error?: string;
};

export type EvidenceFigure = {
  id: string;
  label?: string;
  caption: string;
  imageUrl: string;
  sourceUrl?: string;
};

export type EvidenceQueryPlan = {
  originalQuery: string;
  normalizedQuery: string;
  language: "id" | "en" | "mixed" | "unknown";
  expandedTerms: string[];
  pico: {
    population?: string;
    intervention?: string;
    comparison?: string;
    outcome?: string;
  };
  warnings: string[];
};

export type FederatedEvidenceRecord = {
  id: string;
  source: EvidenceProviderId;
  sourceIds: EvidenceProviderId[];
  title: string;
  authors: string;
  journal: string;
  year?: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  abstract?: string;
  isOpenAccess: boolean;
  fullTextUrl?: string;
  figures?: EvidenceFigure[];
  citedByCount?: number;
  publicationTypes: string[];
  retractionStatus: EvidenceRetractedStatus;
  score: number;
  matchReasons: string[];
  url: string;
};

export type FederatedEvidenceSearchResult = {
  engine: "federated";
  query: string;
  normalizedQuery: string;
  queryPlan: EvidenceQueryPlan;
  retrievedAt: string;
  hitCount: number;
  results: FederatedEvidenceRecord[];
  providers: EvidenceProviderState[];
  warnings: string[];
};

export type EvidenceSearchFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FederatedEvidenceSearchOptions = {
  query: string;
  limit: number;
  providers?: EvidenceProviderId[];
  fetchImpl?: EvidenceSearchFetch;
  timeoutMs?: number;
  ncbiApiKey?: string;
  ncbiEmail?: string;
  crossrefEmail?: string;
  openAlexEmail?: string;
};

type ProviderRecord = Omit<FederatedEvidenceRecord, "id" | "sourceIds" | "score" | "matchReasons"> & {
  providerId: EvidenceProviderId;
  providerRecordId: string;
  rank: number;
};

type ProviderResult = {
  provider: EvidenceProviderId;
  hitCount: number;
  records: ProviderRecord[];
};

type JsonRecord = Record<string, unknown>;

const PROVIDER_ORDER: EvidenceProviderId[] = ["pubmed", "europepmc", "openalex", "crossref"];
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_PAGE_SIZE = 8;

const TERM_EXPANSIONS: Record<string, string[]> = {
  asma: ["asthma", "asthma exacerbation", "reactive airway disease"],
  asthma: ["asma", "asthma exacerbation", "reactive airway disease"],
  hipertensi: ["hypertension", "high blood pressure"],
  hypertension: ["hipertensi", "high blood pressure"],
  diabetes: ["diabetes mellitus", "type 1 diabetes", "type 2 diabetes"],
  pneumonia: ["pneumonia", "lower respiratory tract infection"],
  aspirasi: ["aspiration", "aspiration pneumonia", "aspiration pneumonitis"],
  aspiration: ["aspirasi", "aspiration pneumonia", "aspiration pneumonitis"],
  tuberkulosis: ["tuberculosis", "TB", "mycobacterium tuberculosis"],
  tuberculosis: ["tuberkulosis", "TB", "mycobacterium tuberculosis"],
  tb: ["tuberculosis", "tuberkulosis", "mycobacterium tuberculosis"],
  sepsis: ["sepsis", "septic shock"],
  "gagal jantung": ["heart failure", "congestive heart failure"],
  "heart failure": ["gagal jantung", "congestive heart failure"],
  stroke: ["cerebrovascular accident", "ischemic stroke", "hemorrhagic stroke"],
  "infark miokard": ["myocardial infarction", "acute coronary syndrome"],
  "myocardial infarction": ["infark miokard", "acute coronary syndrome"],
  "gagal ginjal": ["kidney failure", "renal failure"],
  "kidney failure": ["gagal ginjal", "renal failure"],
  aki: ["acute kidney injury", "acute renal injury"],
  "acute kidney injury": ["aki", "acute renal injury"],
  "infeksi saluran kemih": ["urinary tract infection", "UTI"],
  "urinary tract infection": ["infeksi saluran kemih", "UTI"],
  meningitis: ["meningitis"],
  diare: ["diarrhea"],
  diarrhea: ["diare"],
  dehidrasi: ["dehydration"],
  dehydration: ["dehidrasi"],
  malaria: ["malaria"],
  dengue: ["dengue", "dengue hemorrhagic fever"],
  anemia: ["anemia"],
  kehamilan: ["pregnancy", "pregnant"],
  pregnancy: ["kehamilan", "pregnant"],
  anak: ["child", "pediatric", "paediatric"],
  child: ["anak", "pediatric", "paediatric"],
  dewasa: ["adult"],
  adult: ["dewasa"],
  lansia: ["older adult", "elderly"],
  neonatus: ["neonate", "newborn"],
  antibiotik: ["antibiotic", "antimicrobial"],
  antibiotic: ["antibiotik", "antimicrobial"],
  "resistensi antimikroba": ["antimicrobial resistance", "antibiotic resistance"],
  "antimicrobial resistance": ["resistensi antimikroba", "antibiotic resistance"],
  vaksin: ["vaccine", "vaccination", "immunization"],
  vaccine: ["vaksin", "vaccination", "immunization"],
  imunisasi: ["immunization", "vaccination"],
  immunization: ["imunisasi", "vaccination"],
  diagnosis: ["diagnostic", "diagnosis"],
  diagnostik: ["diagnostic", "diagnosis"],
  diagnostic: ["diagnostik", "diagnosis"],
  tatalaksana: ["management", "treatment", "therapy"],
  pengobatan: ["treatment", "therapy", "management"],
  terapi: ["therapy", "treatment"],
  treatment: ["terapi", "pengobatan", "management"],
  pencegahan: ["prevention", "prophylaxis"],
  prevention: ["pencegahan", "prophylaxis"],
  skrining: ["screening"],
  screening: ["skrining"],
  prognosis: ["prognosis", "outcome"],
  "faktor risiko": ["risk factor", "risk factors"],
  "risk factor": ["faktor risiko", "risk factors"],
  "efek samping": ["adverse effect", "side effect"],
  "adverse effect": ["efek samping", "side effect"],
  prevalensi: ["prevalence"],
  prevalence: ["prevalensi"],
  insidensi: ["incidence"],
  incidence: ["insidensi"],
  mortalitas: ["mortality"],
  mortality: ["mortalitas"],
  sensitivitas: ["sensitivity"],
  spesifisitas: ["specificity"],
  pedoman: ["guideline", "clinical practice guideline"],
  guideline: ["pedoman", "clinical practice guideline"],
  "systematic review": ["systematic review", "meta-analysis"],
  "meta-analisis": ["meta-analysis", "systematic review"],
  "meta analysis": ["meta-analysis", "systematic review"],
};

const SHORT_MEDICAL_TOKENS = new Set(["tb", "hiv", "aki", "uti", "copd", "ekg", "ecg", "icu", "igd", "pcr", "mrsa", "osce"]);
const GENERIC_CLINICAL_TOKENS = new Set([
  "based", "berdasarkan", "clinical", "diagnosis", "diagnostic", "disease", "explain", "guideline", "guidelines", "jelaskan", "management", "medical", "medis", "obat", "penyakit", "therapy", "tatalaksana", "terapi", "treatment", "valid", "validated",
]);

const SEARCH_STOPWORDS = new Set([
  "a", "aku", "an", "and", "artikel", "atau", "bantu", "berikan", "carikan", "cari", "citation", "citations", "cite", "database", "databases", "dan", "dengan", "evidence", "find", "fitur", "for", "from", "guideline", "guidelines", "gunakan", "ingin", "jurnal", "journal", "kamu", "latest", "literatur", "literature", "mencari", "mengenai", "of", "on", "pada", "pakai", "pake", "paper", "papers", "please", "referensi", "reference", "research", "saya", "search", "sendiri", "source", "sources", "terbaru", "tentang", "the", "to", "tolong", "untuk", "yang", "trustworthy", "medical", "clarify", "question", "identify", "best", "compare", "check", "flag", "uncertainty", "topic", "desired", "date", "range", "output", "brief", "current", "supplied", "records", "address", "help", "this", "with",
]);

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stripMarkup(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDoi(value: unknown): string | undefined {
  const doi = stringValue(value)?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim().toLowerCase();
  return doi || undefined;
}

function normalizeIdentifier(value: unknown): string | undefined {
  const identifier = stringValue(value)?.replace(/^https?:\/\/[^/]+\//i, "").trim().toLowerCase();
  if (!identifier) return undefined;
  return identifier.startsWith("pmc") ? identifier.toUpperCase() : identifier;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return normalizeTitle(value).split(" ").filter((token) => token.length > 2 || SHORT_MEDICAL_TOKENS.has(token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryHasTerm(query: string, term: string): boolean {
  const normalizedQuery = normalizeTitle(query);
  const normalizedTerm = normalizeTitle(term);
  if (!normalizedQuery || !normalizedTerm) return false;
  const pattern = normalizedTerm.split(" ").map(escapeRegExp).join("\\s+");
  return new RegExp(`(?:^|\\s)${pattern}(?:$|\\s)`, "i").test(normalizedQuery);
}

function semanticTermsForQuery(query: string): string[] {
  return uniqueStrings(matchedExpansionEntries(query).flatMap(([term, terms]) => [term, ...terms]));
}

function matchedExpansionEntries(query: string): Array<[string, string[]]> {
  return Object.entries(TERM_EXPANSIONS).filter(([term]) => queryHasTerm(query, term));
}

function searchSignalTokens(query: string, expandedTerms: string[]): string[] {
  return uniqueStrings([query, ...expandedTerms])
    .flatMap(tokenize)
    .filter((token) => !SEARCH_STOPWORDS.has(token));
}

function searchSignalGroups(query: string): string[][] {
  const matchedEntries = matchedExpansionEntries(query);
  const coveredTokens = new Set(matchedEntries.flatMap(([term]) => tokenize(term)));
  const semanticGroups = matchedEntries.map(([term, terms]) => uniqueStrings([term, ...terms]).flatMap(tokenize));
  const tokenGroups = tokenize(query)
    .filter((token) => !SEARCH_STOPWORDS.has(token))
    .filter((token) => !coveredTokens.has(token))
    .map((token) => uniqueStrings([token, ...(TERM_EXPANSIONS[token] || [])]).flatMap(tokenize));
  return [...semanticGroups, ...tokenGroups];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim())).map((value) => value.trim())));
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value && value.trim()))?.trim();
}

function parseDateYear(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== undefined && item !== null);
    return parseDateYear(first);
  }
  const text = stringValue(value);
  if (!text) return undefined;
  return text.match(/\b(19|20)\d{2}\b/)?.[0];
}

function safeUrl(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return /^https?:$/i.test(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function findNested(record: JsonRecord, path: string[]): unknown {
  let current: unknown = record;
  for (const segment of path) {
    current = asRecord(current)[segment];
  }
  return current;
}

function inferLanguage(query: string): EvidenceQueryPlan["language"] {
  const indonesian = query.match(/\b(dan|atau|dengan|untuk|pada|pasien|terhadap|sebagai|berdasarkan|tatalaksana|pengobatan|penelitian|bukti)\b/gi)?.length || 0;
  const english = query.match(/\b(and|or|with|for|in|patients?|versus|treatment|management|evidence|trial|review)\b/gi)?.length || 0;
  if (!indonesian && !english) return "unknown";
  if (indonesian && english) return "mixed";
  return indonesian ? "id" : "en";
}

function parsePico(query: string): EvidenceQueryPlan["pico"] {
  const pico: EvidenceQueryPlan["pico"] = {};
  const patterns: Array<[keyof EvidenceQueryPlan["pico"], RegExp]> = [
    ["population", /(?:^|[;\n|])\s*(?:p|population|populasi)\s*[:=]\s*([^;\n|]+)/i],
    ["intervention", /(?:^|[;\n|])\s*(?:i|intervention|intervensi)\s*[:=]\s*([^;\n|]+)/i],
    ["comparison", /(?:^|[;\n|])\s*(?:c|comparison|pembanding)\s*[:=]\s*([^;\n|]+)/i],
    ["outcome", /(?:^|[;\n|])\s*(?:o|outcome|luaran)\s*[:=]\s*([^;\n|]+)/i],
  ];
  patterns.forEach(([key, pattern]) => {
    const match = query.match(pattern);
    if (match?.[1]?.trim()) pico[key] = match[1].trim().slice(0, 180);
  });
  return pico;
}

export function buildEvidenceQueryPlan(query: string): EvidenceQueryPlan {
  const originalQuery = query.trim().replace(/\s+/g, " ");
  const semanticTerms = semanticTermsForQuery(originalQuery);
  const expandedTerms = uniqueStrings(semanticTerms.filter((term) => !queryHasTerm(originalQuery, term)));
  const signalTerms = uniqueStrings([...searchSignalTokens(originalQuery, []), ...semanticTerms]);
  const normalizedQuery = signalTerms.length
    ? signalTerms.slice(0, 24).map((term) => term.includes(" ") ? `"${term}"` : term).join(" OR ")
    : originalQuery;
  const pico = parsePico(originalQuery);
  const warnings: string[] = [];
  if (!Object.keys(pico).length) warnings.push("PICO belum ditulis secara eksplisit; hasil diperingkat dari kecocokan istilah dan provenance sumber.");
  if (!expandedTerms.length) warnings.push("Tidak ada sinonim bilingual yang pasti; provider tetap mencari istilah inti dan memeringkat hasil berdasarkan kecocokan topik.");
  return {
    originalQuery,
    normalizedQuery,
    language: inferLanguage(originalQuery),
    expandedTerms,
    pico,
    warnings,
  };
}

async function requestWithTimeout(fetchImpl: EvidenceSearchFetch, input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(fetchImpl: EvidenceSearchFetch, input: string | URL, init: RequestInit, timeoutMs: number): Promise<JsonRecord> {
  const response = await requestWithTimeout(fetchImpl, input, init, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return asRecord(await response.json());
}

async function requestText(fetchImpl: EvidenceSearchFetch, input: string | URL, init: RequestInit, timeoutMs: number): Promise<string> {
  const response = await requestWithTimeout(fetchImpl, input, init, timeoutMs);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function recordBase(input: Omit<ProviderRecord, "providerId" | "providerRecordId" | "rank">, providerId: EvidenceProviderId, providerRecordId: string, rank: number): ProviderRecord {
  return { ...input, providerId, providerRecordId, rank };
}

function createProviderRecord(providerId: EvidenceProviderId, providerRecordId: string, rank: number, values: Partial<Omit<ProviderRecord, "providerId" | "providerRecordId" | "rank">> & Pick<ProviderRecord, "title">): ProviderRecord {
  return recordBase({
    source: providerId,
    title: values.title.trim(),
    authors: values.authors || "",
    journal: values.journal || "",
    year: values.year,
    doi: normalizeDoi(values.doi),
    pmid: normalizeIdentifier(values.pmid),
    pmcid: normalizeIdentifier(values.pmcid),
    abstract: values.abstract?.trim() || undefined,
    isOpenAccess: values.isOpenAccess === true,
    fullTextUrl: safeUrl(values.fullTextUrl),
    figures: values.figures?.slice(0, 3),
    citedByCount: values.citedByCount,
    publicationTypes: uniqueStrings(values.publicationTypes || []),
    retractionStatus: values.retractionStatus || "unknown",
    url: safeUrl(values.url) || "",
  }, providerId, providerRecordId, rank);
}

function xmlTag(fragment: string, tag: string): string | undefined {
  const match = fragment.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? stripMarkup(match[1]) : undefined;
}

function xmlTags(fragment: string, tag: string): string[] {
  return Array.from(fragment.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))).map((match) => stripMarkup(match[1]));
}

function xmlAttribute(fragment: string, tag: string, attribute: string): string | undefined {
  const match = fragment.match(new RegExp(`<${tag}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1]?.trim();
}

function parsePubmedXml(xml: string, fallbackIds: string[]): ProviderRecord[] {
  const articles = Array.from(xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)).map((match) => match[1]);
  return articles.map((article, index) => {
    const pmid = xmlTag(article, "PMID") || fallbackIds[index];
    const title = xmlTag(article, "ArticleTitle") || `PubMed article ${pmid || index + 1}`;
    const abstract = xmlTags(article, "AbstractText").join(" ");
    const authors = Array.from(article.matchAll(/<Author>([\s\S]*?)<\/Author>/gi)).slice(0, 8).map((match) => {
      const author = match[1];
      return firstNonEmpty(xmlTag(author, "CollectiveName"), [xmlTag(author, "LastName"), xmlTag(author, "ForeName")].filter(Boolean).join(" ")) || "";
    }).filter(Boolean).join(", ");
    const publicationTypes = xmlTags(article, "PublicationType");
    const doi = Array.from(article.matchAll(/<ArticleId\b[^>]*IdType=["']doi["'][^>]*>([\s\S]*?)<\/ArticleId>/gi))[0]?.[1];
    const pmcid = Array.from(article.matchAll(/<ArticleId\b[^>]*IdType=["']pmc["'][^>]*>([\s\S]*?)<\/ArticleId>/gi))[0]?.[1];
    const journal = xmlTag(article, "Title");
    const year = firstNonEmpty(xmlTag(article, "Year"), xmlTag(article, "MedlineDate"))?.match(/\b(19|20)\d{2}\b/)?.[0];
    return createProviderRecord("pubmed", pmid || `result-${index + 1}`, index + 1, {
      title,
      authors,
      journal,
      year,
      doi,
      pmid,
      pmcid,
      abstract,
      isOpenAccess: false,
      fullTextUrl: pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(pmcid)}/` : undefined,
      publicationTypes,
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/` : undefined,
    });
  }).filter((record) => Boolean(record.title));
}

async function searchPubmed(options: FederatedEvidenceSearchOptions, plan: EvidenceQueryPlan): Promise<ProviderResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("term", plan.normalizedQuery);
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(Math.min(options.limit, MAX_PROVIDER_PAGE_SIZE)));
  searchUrl.searchParams.set("sort", "relevance");
  searchUrl.searchParams.set("tool", "koasis");
  if (options.ncbiEmail) searchUrl.searchParams.set("email", options.ncbiEmail);
  if (options.ncbiApiKey) searchUrl.searchParams.set("api_key", options.ncbiApiKey);
  const searchPayload = await requestJson(fetchImpl, searchUrl, { headers: { Accept: "application/json" } }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const result = asRecord(searchPayload.esearchresult);
  const ids = arrayValue(result.idlist).map(stringValue).filter((id): id is string => Boolean(id));
  const hitCount = numberValue(result.count) || ids.length;
  if (!ids.length) return { provider: "pubmed", hitCount, records: [] };
  const fetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  fetchUrl.searchParams.set("db", "pubmed");
  fetchUrl.searchParams.set("id", ids.join(","));
  fetchUrl.searchParams.set("retmode", "xml");
  fetchUrl.searchParams.set("rettype", "abstract");
  if (options.ncbiEmail) fetchUrl.searchParams.set("email", options.ncbiEmail);
  if (options.ncbiApiKey) fetchUrl.searchParams.set("api_key", options.ncbiApiKey);
  const xml = await requestText(fetchImpl, fetchUrl, { headers: { Accept: "application/xml" } }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  return { provider: "pubmed", hitCount, records: parsePubmedXml(xml, ids) };
}

function europePmcFullTextUrl(record: JsonRecord): string | undefined {
  const list = asRecord(record.fullTextUrlList);
  const urls = arrayValue(list.fullTextUrl);
  const first = urls.map((value) => asRecord(value)).find((value) => safeUrl(value.url));
  return safeUrl(first?.url);
}

function parseEuropePmcFigures(xml: string, pmcid: string): EvidenceFigure[] {
  const fragments = Array.from(xml.matchAll(/<fig\b[\s\S]*?<\/fig>/gi)).map((match) => match[0]).slice(0, 3);
  const figures: Array<EvidenceFigure | null> = fragments.map((fragment, index) => {
    const href = fragment.match(/<graphic\b[^>]*(?:xlink:href|href)=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    const fileName = href?.split("/").pop()?.split("?")[0];
    if (!fileName || !/\.(?:png|jpe?g|gif|webp)$/i.test(fileName)) return null;
    const label = xmlTag(fragment, "label") || `Figure ${index + 1}`;
    const caption = xmlTag(fragment, "caption") || "Temuan visual dari artikel open full text.";
    return {
      id: `${pmcid}-figure-${index + 1}`,
      label,
      caption: caption.slice(0, 900),
      imageUrl: `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(pmcid)}/bin/${encodeURIComponent(fileName)}`,
      sourceUrl: `https://europepmc.org/articles/${encodeURIComponent(pmcid)}`,
    };
  });
  return figures.filter((figure): figure is EvidenceFigure => Boolean(figure));
}

async function enrichEuropePmcFigures(records: ProviderRecord[], options: FederatedEvidenceSearchOptions): Promise<ProviderRecord[]> {
  const fetchImpl = options.fetchImpl || fetch;
  const candidates = records.filter((record) => record.pmcid).slice(0, 3);
  if (!candidates.length) return records;
  const enriched = await Promise.all(candidates.map(async (record) => {
    try {
      const xml = await requestText(
        fetchImpl,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(record.pmcid as string)}/fullTextXML`,
        { headers: { Accept: "application/xml" } },
        Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 4_000),
      );
      const figures = parseEuropePmcFigures(xml, record.pmcid as string);
      return figures.length ? { ...record, figures } : record;
    } catch {
      return record;
    }
  }));
  const byId = new Map(enriched.map((record) => [record.providerRecordId, record]));
  return records.map((record) => byId.get(record.providerRecordId) || record);
}

async function searchEuropePmc(options: FederatedEvidenceSearchOptions, plan: EvidenceQueryPlan): Promise<ProviderResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", plan.normalizedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(Math.min(options.limit, MAX_PROVIDER_PAGE_SIZE)));
  const payload = await requestJson(fetchImpl, url, { headers: { Accept: "application/json" } }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const resultList = asRecord(payload.resultList);
  const rawResults = arrayValue(resultList.result).map(asRecord);
  const records = rawResults.map((record, index) => {
    const source = stringValue(record.source) || "MED";
    const providerRecordId = stringValue(record.id) || `result-${index + 1}`;
    const pmid = stringValue(record.pmid);
    const pmcid = stringValue(record.pmcid);
    const doi = normalizeDoi(record.doi);
    const isRetracted = record.isRetracted === true || /^(y|true)$/i.test(stringValue(record.isRetracted) || "");
    return createProviderRecord("europepmc", providerRecordId, index + 1, {
      title: stripMarkup(record.title),
      authors: stripMarkup(record.authorString),
      journal: stripMarkup(record.journalTitle),
      year: stringValue(record.pubYear),
      doi,
      pmid,
      pmcid,
      abstract: stripMarkup(record.abstractText),
      isOpenAccess: stringValue(record.isOpenAccess)?.toUpperCase() === "Y" || record.isOpenAccess === true,
      fullTextUrl: europePmcFullTextUrl(record),
      citedByCount: numberValue(record.citedByCount),
      publicationTypes: arrayValue(asRecord(record.pubTypeList).pubType).map(stringValue).filter((value): value is string => Boolean(value)),
      retractionStatus: isRetracted ? "retracted" : "unknown",
      url: `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(providerRecordId)}`,
    });
  }).filter((record) => Boolean(record.title));
  const enrichedRecords = await enrichEuropePmcFigures(records, options);
  return { provider: "europepmc", hitCount: numberValue(resultList.hitCount) || enrichedRecords.length, records: enrichedRecords };
}

async function searchOpenAlex(options: FederatedEvidenceSearchOptions, plan: EvidenceQueryPlan): Promise<ProviderResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", plan.normalizedQuery);
  url.searchParams.set("per-page", String(Math.min(options.limit, MAX_PROVIDER_PAGE_SIZE)));
  if (options.openAlexEmail) url.searchParams.set("mailto", options.openAlexEmail);
  const payload = await requestJson(fetchImpl, url, { headers: { Accept: "application/json" } }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const rawResults = arrayValue(payload.results).map(asRecord);
  const records = rawResults.map((record, index) => {
    const primaryLocation = asRecord(record.primary_location);
    const source = asRecord(primaryLocation.source);
    const bestOaLocation = asRecord(record.best_oa_location);
    const doi = normalizeDoi(record.doi);
    const isRetracted = record.is_retracted === true;
    return createProviderRecord("openalex", stringValue(record.id) || `result-${index + 1}`, index + 1, {
      title: stripMarkup(record.title),
      authors: arrayValue(record.authorships).slice(0, 8).map((value) => stringValue(asRecord(asRecord(value).author).display_name)).filter((value): value is string => Boolean(value)).join(", "),
      journal: stringValue(source.display_name),
      year: parseDateYear(record.publication_year),
      doi,
      abstract: undefined,
      isOpenAccess: asRecord(record.open_access).is_oa === true,
      fullTextUrl: safeUrl(bestOaLocation.pdf_url) || safeUrl(bestOaLocation.landing_page_url),
      citedByCount: numberValue(record.cited_by_count),
      publicationTypes: uniqueStrings([stringValue(record.type)]),
      retractionStatus: isRetracted ? "retracted" : "unknown",
      url: safeUrl(record.doi) || safeUrl(record.primary_location && asRecord(record.primary_location).landing_page_url) || safeUrl(record.id) || "https://openalex.org/",
    });
  }).filter((record) => Boolean(record.title));
  return { provider: "openalex", hitCount: numberValue(asRecord(payload.meta).count) || records.length, records };
}

function crossrefAbstract(value: unknown): string | undefined {
  // Crossref notes that deposited abstracts can remain copyrighted. Keep this
  // adapter metadata-first and do not pass a Crossref abstract downstream.
  void value;
  return undefined;
}

function crossrefRetractionStatus(record: JsonRecord): EvidenceRetractedStatus {
  const updates = arrayValue(record["update-to"]);
  const updateTypes = updates.map((value) => stringValue(asRecord(value).type) || stringValue(asRecord(value).label) || "").join(" ");
  if (/retract/i.test(updateTypes)) return "retracted";
  if (/correct|errat/i.test(updateTypes)) return "corrected";
  return "unknown";
}

async function searchCrossref(options: FederatedEvidenceSearchOptions, plan: EvidenceQueryPlan): Promise<ProviderResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", plan.normalizedQuery);
  url.searchParams.set("rows", String(Math.min(options.limit, MAX_PROVIDER_PAGE_SIZE)));
  url.searchParams.set("select", "DOI,title,author,container-title,published,published-print,published-online,is-referenced-by-count,link,license,update-to,type,URL");
  if (options.crossrefEmail) url.searchParams.set("mailto", options.crossrefEmail);
  const payload = await requestJson(fetchImpl, url, { headers: { Accept: "application/json", "User-Agent": "Koasis/1.0 (medical evidence metadata; mailto: support@koasis.my.id)" } }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const message = asRecord(payload.message);
  const rawResults = arrayValue(message.items).map(asRecord);
  const records = rawResults.map((record, index) => {
    const doi = normalizeDoi(record.DOI);
    const licenses = arrayValue(record.license).map((value) => safeUrl(asRecord(value).URL)).filter((value): value is string => Boolean(value));
    const isOpenAccess = licenses.some((license) => /creativecommons\.org/i.test(license));
    const link = arrayValue(record.link).map(asRecord).find((value) => safeUrl(value.URL));
    return createProviderRecord("crossref", doi || `result-${index + 1}`, index + 1, {
      title: stripMarkup(arrayValue(record.title)[0]),
      authors: arrayValue(record.author).slice(0, 8).map((value) => {
        const author = asRecord(value);
        return firstNonEmpty([stringValue(author.given), stringValue(author.family)].filter(Boolean).join(" "), stringValue(author.name)) || "";
      }).filter(Boolean).join(", "),
      journal: stripMarkup(arrayValue(record["container-title"])[0]),
      year: parseDateYear(findNested(record, ["published", "date-parts"]) || findNested(record, ["published-online", "date-parts"]) || findNested(record, ["published-print", "date-parts"])),
      doi,
      abstract: crossrefAbstract(record.abstract),
      isOpenAccess,
      fullTextUrl: safeUrl(link?.URL),
      citedByCount: numberValue(record["is-referenced-by-count"]),
      publicationTypes: uniqueStrings([stringValue(record.type)]),
      retractionStatus: crossrefRetractionStatus(record),
      url: safeUrl(record.URL) || (doi ? `https://doi.org/${encodeURIComponent(doi)}` : "https://search.crossref.org/"),
    });
  }).filter((record) => Boolean(record.title));
  return { provider: "crossref", hitCount: numberValue(message["total-results"]) || records.length, records };
}

function identifierKeys(record: ProviderRecord): string[] {
  return uniqueStrings([
    record.doi ? `doi:${record.doi}` : undefined,
    record.pmid ? `pmid:${record.pmid}` : undefined,
    record.pmcid ? `pmcid:${record.pmcid}` : undefined,
    record.title ? `title:${normalizeTitle(record.title)}|year:${record.year || ""}` : undefined,
  ]);
}

type EvidenceGroup = { records: ProviderRecord[]; keys: Set<string> };

function mergeProviderRecords(records: ProviderRecord[]): ProviderRecord {
  const sorted = [...records].sort((left, right) => PROVIDER_ORDER.indexOf(left.providerId) - PROVIDER_ORDER.indexOf(right.providerId));
  const primary = sorted[0];
  const sourceIds = uniqueStrings(sorted.map((record) => record.providerId)) as EvidenceProviderId[];
  const retractionStatus = sorted.some((record) => record.retractionStatus === "retracted")
    ? "retracted"
    : sorted.some((record) => record.retractionStatus === "corrected") ? "corrected" : "unknown";
  return {
    ...primary,
    authors: firstNonEmpty(...sorted.map((record) => record.authors)) || "",
    journal: firstNonEmpty(...sorted.map((record) => record.journal)) || "",
    year: firstNonEmpty(...sorted.map((record) => record.year)),
    doi: firstNonEmpty(...sorted.map((record) => record.doi)),
    pmid: firstNonEmpty(...sorted.map((record) => record.pmid)),
    pmcid: firstNonEmpty(...sorted.map((record) => record.pmcid)),
    abstract: firstNonEmpty(...sorted.map((record) => record.abstract)),
    isOpenAccess: sorted.some((record) => record.isOpenAccess),
    fullTextUrl: firstNonEmpty(...sorted.map((record) => record.fullTextUrl)),
    figures: sorted.flatMap((record) => record.figures || []).slice(0, 3),
    citedByCount: sorted.map((record) => record.citedByCount).filter((value): value is number => typeof value === "number").sort((a, b) => b - a)[0],
    publicationTypes: uniqueStrings(sorted.flatMap((record) => record.publicationTypes)),
    retractionStatus,
    source: primary.providerId,
    providerRecordId: primary.providerRecordId,
    rank: Math.min(...sorted.map((record) => record.rank)),
    url: firstNonEmpty(...sorted.map((record) => record.url)) || "",
    keys: undefined,
  } as ProviderRecord;
}

function deduplicateProviderRecords(records: ProviderRecord[]): ProviderRecord[] {
  const groups: EvidenceGroup[] = [];
  const keyToGroup = new Map<string, EvidenceGroup>();
  records.forEach((record) => {
    const keys = identifierKeys(record);
    const matchingGroups = Array.from(new Set(keys.map((key) => keyToGroup.get(key)).filter((group): group is EvidenceGroup => Boolean(group))));
    const group = matchingGroups[0] || { records: [], keys: new Set<string>() };
    matchingGroups.slice(1).forEach((other) => {
      other.records.forEach((item) => group.records.push(item));
      other.keys.forEach((key) => group.keys.add(key));
      const index = groups.indexOf(other);
      if (index >= 0) groups.splice(index, 1);
    });
    group.records.push(record);
    keys.forEach((key) => group.keys.add(key));
    if (!groups.includes(group)) groups.push(group);
    group.keys.forEach((key) => keyToGroup.set(key, group));
  });
  return groups.map((group) => mergeProviderRecords(group.records));
}

function evidenceRecordId(record: ProviderRecord): string {
  return record.doi ? `doi:${record.doi}` : record.pmid ? `pmid:${record.pmid}` : record.pmcid ? `pmcid:${record.pmcid}` : `${record.providerId}:${record.providerRecordId}`;
}

function relevanceScore(record: ProviderRecord, query: string, expandedTerms: string[], allProviderCount: number): { score: number; reasons: string[] } {
  const queryTokens = searchSignalTokens(query, expandedTerms);
  const titleTokens = new Set(tokenize(record.title));
  const bodyTokens = new Set(tokenize(`${record.title} ${record.abstract || ""}`));
  const titleMatches = queryTokens.filter((token) => titleTokens.has(token)).length;
  const bodyMatches = queryTokens.filter((token) => bodyTokens.has(token)).length;
  const titleCoverage = queryTokens.length ? titleMatches / queryTokens.length : 0;
  const bodyCoverage = queryTokens.length ? bodyMatches / queryTokens.length : 0;
  const providerCoverage = allProviderCount ? 1 / allProviderCount : 1;
  const rrf = 1 / (60 + Math.max(1, record.rank));
  const publicationText = record.publicationTypes.join(" ").toLowerCase();
  const evidenceTypeBonus = /(systematic review|meta-analysis|randomized|randomised|clinical trial|guideline)/i.test(`${record.title} ${publicationText}`) ? 0.18 : 0;
  const reasons: string[] = [];
  if (titleCoverage >= 0.35) reasons.push("istilah query muncul pada judul");
  else if (bodyCoverage >= 0.35) reasons.push("istilah query muncul pada metadata/abstract");
  if (allProviderCount > 1) reasons.push(`terkonfirmasi ${allProviderCount} sumber metadata`);
  if (record.isOpenAccess) reasons.push("memiliki penanda open access");
  if (evidenceTypeBonus) reasons.push("tipe publikasi relevan untuk evidence");
  if (record.retractionStatus === "retracted") reasons.push("perlu perhatian: status retraction terdeteksi");
  const score = rrf + titleCoverage * 0.72 + bodyCoverage * 0.24 + providerCoverage * 0.08 + (record.isOpenAccess ? 0.04 : 0) + evidenceTypeBonus;
  return { score: Number(score.toFixed(6)), reasons: reasons.length ? reasons : ["hasil federated search"] };
}

function hasSearchSignal(record: FederatedEvidenceRecord, query: string): boolean {
  const queryGroups = searchSignalGroups(query);
  if (!queryGroups.length) return false;
  const searchableText = new Set(tokenize(`${record.title} ${record.abstract || ""}`));
  const directTopicTokens = tokenize(query).filter((token) => !SEARCH_STOPWORDS.has(token) && !GENERIC_CLINICAL_TOKENS.has(token));
  const topicTerms = uniqueStrings([
    ...directTopicTokens,
    ...matchedExpansionEntries(query)
      .filter(([term]) => !GENERIC_CLINICAL_TOKENS.has(normalizeTitle(term)))
      .flatMap(([term, terms]) => [term, ...terms]),
  ]).flatMap(tokenize);
  if (topicTerms.length && !topicTerms.some((token) => searchableText.has(token))) return false;
  const matchedGroups = queryGroups.filter((group) => group.some((token) => searchableText.has(token))).length;
  const requiredMatches = queryGroups.length === 1 ? 1 : Math.min(2, queryGroups.length);
  return matchedGroups >= requiredMatches;
}

async function callProvider(provider: EvidenceProviderId, options: FederatedEvidenceSearchOptions, plan: EvidenceQueryPlan): Promise<ProviderResult> {
  if (provider === "pubmed") return searchPubmed(options, plan);
  if (provider === "europepmc") return searchEuropePmc(options, plan);
  if (provider === "openalex") return searchOpenAlex(options, plan);
  return searchCrossref(options, plan);
}

export class EvidenceSearchUnavailableError extends Error {
  constructor(message = "Sumber evidence sementara tidak tersedia.") {
    super(message);
    this.name = "EvidenceSearchUnavailableError";
  }
}

export async function searchFederatedEvidence(options: FederatedEvidenceSearchOptions): Promise<FederatedEvidenceSearchResult> {
  const plan = buildEvidenceQueryPlan(options.query);
  const requestedProviders = options.providers?.length ? options.providers : PROVIDER_ORDER;
  const providers = Array.from(new Set(requestedProviders)).filter((provider): provider is EvidenceProviderId => PROVIDER_ORDER.includes(provider));
  if (!providers.length) throw new EvidenceSearchUnavailableError("Tidak ada provider evidence yang diaktifkan.");
  const settled = await Promise.allSettled(providers.map((provider) => callProvider(provider, options, plan)));
  const providerStates: EvidenceProviderState[] = [];
  const providerRecords: ProviderRecord[] = [];
  const warnings = [...plan.warnings];
  settled.forEach((result, index) => {
    const provider = providers[index];
    if (result.status === "fulfilled") {
      providerRecords.push(...result.value.records);
      providerStates.push({ provider, status: result.value.records.length ? "ok" : "empty", returned: result.value.records.length, hitCount: result.value.hitCount });
      return;
    }
    const message = result.reason instanceof Error ? result.reason.message : "provider error";
    providerStates.push({ provider, status: "error", returned: 0, error: message.slice(0, 160) });
    warnings.push(`${provider} tidak tersedia saat pencarian ini.`);
  });
  const successfulProviders = providerStates.filter((state) => state.status !== "error");
  if (!successfulProviders.length) throw new EvidenceSearchUnavailableError("Semua sumber evidence gagal dihubungi. Coba lagi beberapa saat.");
  const deduplicated = deduplicateProviderRecords(providerRecords);
  const rankedResults: FederatedEvidenceRecord[] = deduplicated
    .map((record) => {
      const score = relevanceScore(record, plan.originalQuery, plan.expandedTerms, new Set(providerRecords.filter((item) => evidenceRecordId(item) === evidenceRecordId(record)).map((item) => item.providerId)).size || 1);
      const sourceIds = uniqueStrings(providerRecords.filter((item) => identifierKeys(item).some((key) => identifierKeys(record).includes(key))).map((item) => item.providerId)) as EvidenceProviderId[];
      return {
        id: evidenceRecordId(record),
        source: record.providerId,
        sourceIds: sourceIds.length ? sourceIds : [record.providerId],
        title: record.title,
        authors: record.authors,
        journal: record.journal,
        year: record.year,
        doi: record.doi,
        pmid: record.pmid,
        pmcid: record.pmcid,
        abstract: record.abstract,
        isOpenAccess: record.isOpenAccess,
        fullTextUrl: record.fullTextUrl,
        figures: record.figures,
        citedByCount: record.citedByCount,
        publicationTypes: record.publicationTypes,
        retractionStatus: record.retractionStatus,
        score: score.score,
        matchReasons: score.reasons,
        url: record.url,
      };
    })
    .sort((left, right) => right.score - left.score || (right.citedByCount || 0) - (left.citedByCount || 0));
  const results = rankedResults
    .filter((record) => hasSearchSignal(record, plan.originalQuery))
    .slice(0, Math.max(1, Math.min(MAX_PROVIDER_PAGE_SIZE, Math.round(options.limit))));
  if (!results.length && rankedResults.length) warnings.push("Provider mengembalikan kandidat tanpa kecocokan istilah topik; hasil tersebut disembunyikan agar tidak dianggap sebagai evidence yang relevan.");
  return {
    engine: "federated",
    query: plan.originalQuery,
    normalizedQuery: plan.normalizedQuery,
    queryPlan: plan,
    retrievedAt: new Date().toISOString(),
    hitCount: providerStates.reduce((total, state) => total + (state.hitCount || state.returned), 0),
    results,
    providers: providerStates,
    warnings,
  };
}
