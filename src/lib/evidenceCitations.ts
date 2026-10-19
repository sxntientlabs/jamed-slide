import type { EvidenceSource } from "./evidenceSearchClient";

function normalizeCitationValue(value: string): string {
  return value
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/[.,;]+$/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function evidenceSourceReference(source: EvidenceSource): string {
  const identifier = source.doi ? `DOI:${source.doi}` : source.pmid ? `PMID:${source.pmid}` : source.pmcid ? `PMCID:${source.pmcid}` : source.id;
  return `${source.source.toUpperCase()}:${identifier}`;
}

export function evidenceSourceKey(source: EvidenceSource): string {
  if (source.doi) return `doi:${normalizeCitationValue(source.doi)}`;
  if (source.pmid) return `pmid:${normalizeCitationValue(source.pmid)}`;
  if (source.pmcid) return `pmcid:${normalizeCitationValue(source.pmcid)}`;
  return `${source.source}:${source.id}`.toLowerCase();
}

export function evidenceProviderLabel(source: EvidenceSource): string {
  if (source.journal?.trim()) return source.journal.trim();
  if (source.source === "europepmc") return "Europe PMC";
  if (source.source === "pubmed") return "PubMed";
  if (source.source === "openalex") return "OpenAlex";
  if (source.source === "crossref") return "Crossref";
  return source.source;
}

export function evidenceSourceBadges(source: EvidenceSource, currentYear = new Date().getFullYear()): string[] {
  const types = (source.publicationTypes || []).join(" ").toLowerCase();
  const badges: string[] = [];
  const year = source.year ? Number.parseInt(source.year, 10) : Number.NaN;
  if (Number.isFinite(year) && year >= currentYear - 3) badges.push("Recent");
  if (/systematic review|meta-analysis|meta analysis|tinjauan sistematis/.test(types)) badges.push("SR");
  else if (/review|guideline|consensus|practice recommendation/.test(types)) badges.push("Review");
  if (/guideline|clinical|practice guideline|recommendation/.test(types)) badges.push("Clinical reference");
  return badges.slice(0, 3);
}

function evidenceCitationAliases(source: EvidenceSource): string[] {
  const aliases = new Set<string>();
  const add = (value: string | undefined) => {
    if (value) aliases.add(normalizeCitationValue(value));
  };
  const providerPrefixes = [source.source, ...(source.sourceIds || [])];
  add(source.id);
  providerPrefixes.forEach((provider) => add(`${provider}:${source.id}`));
  add(evidenceSourceReference(source));
  if (source.doi) {
    add(source.doi);
    add(`DOI:${source.doi}`);
    providerPrefixes.forEach((provider) => add(`${provider}:DOI:${source.doi}`));
  }
  if (source.pmid) {
    add(source.pmid);
    add(`PMID:${source.pmid}`);
    providerPrefixes.forEach((provider) => add(`${provider}:PMID:${source.pmid}`));
  }
  if (source.pmcid) {
    add(source.pmcid);
    add(`PMCID:${source.pmcid}`);
    providerPrefixes.forEach((provider) => add(`${provider}:PMCID:${source.pmcid}`));
  }
  return [...aliases];
}

export type MatchedEvidenceCitation = {
  source: EvidenceSource;
  index: number;
};

export function matchEvidenceCitation(token: string, sources: EvidenceSource[]): MatchedEvidenceCitation | null {
  const normalized = normalizeCitationValue(token);
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized) - 1;
    return index >= 0 && index < sources.length && sources[index] ? { source: sources[index], index } : null;
  }
  const index = sources.findIndex((source) => evidenceCitationAliases(source).includes(normalized));
  return index >= 0 && sources[index] ? { source: sources[index], index } : null;
}
