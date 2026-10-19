import { describe, expect, test } from "vitest";
import { evidenceProviderLabel, evidenceSourceBadges, evidenceSourceKey, evidenceSourceReference, matchEvidenceCitation } from "./evidenceCitations";
import type { EvidenceSource } from "./evidenceSearchClient";

const source: EvidenceSource = {
  id: "12345",
  source: "pubmed",
  sourceIds: ["pubmed", "europepmc"],
  title: "Asthma treatment outcomes",
  authors: "Doe J",
  journal: "Clinical Medicine",
  year: "2024",
  doi: "10.1000/ABC",
  pmid: "12345",
  pmcid: "PMC123",
  abstract: "Study abstract.",
  isOpenAccess: true,
  url: "https://pubmed.ncbi.nlm.nih.gov/12345/",
};

describe("evidence citations", () => {
  test("creates a stable provider reference and deduplication key", () => {
    expect(evidenceSourceReference(source)).toBe("PUBMED:DOI:10.1000/ABC");
    expect(evidenceSourceKey(source)).toBe("doi:10.1000/abc");
  });

  test("matches numbered and provider identifier citations", () => {
    const sources = [source];
    expect(matchEvidenceCitation("[1]", sources)?.index).toBe(0);
    expect(matchEvidenceCitation("[PUBMED:DOI:10.1000/ABC]", sources)?.source.id).toBe("12345");
    expect(matchEvidenceCitation("[PMID:12345]", sources)?.source.id).toBe("12345");
    expect(matchEvidenceCitation("[EUROPEPMC:PMCID:PMC123]", sources)?.source.id).toBe("12345");
    expect(matchEvidenceCitation("[99]", sources)).toBeNull();
  });

  test("derives a compact source label and evidence badges", () => {
    expect(evidenceProviderLabel(source)).toBe("Clinical Medicine");
    expect(evidenceSourceBadges({ ...source, year: "2025", publicationTypes: ["Systematic Review"] }, 2026)).toEqual(["Recent", "SR"]);
  });
});
