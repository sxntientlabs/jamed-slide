import { koasisApiUrl } from "./koasisApi";

export type EvidenceProviderId = "pubmed" | "europepmc" | "openalex" | "crossref";

export type EvidenceProviderState = {
  provider: EvidenceProviderId;
  status: "ok" | "error" | "empty";
  returned: number;
  hitCount?: number;
  error?: string;
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

export type EvidenceSource = {
  id: string;
  source: EvidenceProviderId;
  sourceIds?: EvidenceProviderId[];
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
  citedByCount?: number;
  publicationTypes?: string[];
  retractionStatus?: "retracted" | "corrected" | "unknown";
  score?: number;
  matchReasons?: string[];
  url: string;
};

export type EvidenceSearchResult = {
  engine: "federated";
  query: string;
  normalizedQuery?: string;
  queryPlan?: EvidenceQueryPlan;
  retrievedAt: string;
  hitCount: number;
  results: EvidenceSource[];
  providers?: EvidenceProviderState[];
  warnings?: string[];
};

export class EvidenceSearchError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "EvidenceSearchError";
    this.code = code;
  }
}

type EvidenceSearchOptions = {
  authToken?: string;
  signal?: AbortSignal;
  limit?: number;
};

export async function searchEvidenceSources(
  query: string,
  options: EvidenceSearchOptions = {},
): Promise<EvidenceSearchResult> {
  const response = await fetch(koasisApiUrl("/api/evidence/search"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    },
    body: JSON.stringify({ query, limit: options.limit ?? 5 }),
    signal: options.signal,
  });

  if (!response.ok) {
    try {
      const payload = await response.json() as { error?: string; code?: string };
      throw new EvidenceSearchError(payload.error || `Pencarian sumber gagal (HTTP ${response.status}).`, payload.code);
    } catch (error) {
      if (error instanceof EvidenceSearchError) throw error;
      throw new EvidenceSearchError(`Pencarian sumber gagal (HTTP ${response.status}).`);
    }
  }

  try {
    return await response.json() as EvidenceSearchResult;
  } catch {
    throw new EvidenceSearchError("Respons pencarian sumber tidak valid.");
  }
}
