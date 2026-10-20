import { describe, expect, test, vi } from "vitest";
import { EvidenceSearchUnavailableError, buildEvidenceQueryPlan, searchFederatedEvidence } from "./evidenceSearch";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

const pubmedXml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation><PMID>12345</PMID><Article>
      <ArticleTitle>Asthma treatment outcomes in adults</ArticleTitle>
      <Journal><Title>Clinical Medicine</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
      <Abstract><AbstractText>Study abstract.</AbstractText></Abstract>
      <AuthorList><Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author></AuthorList>
      <PublicationTypeList><PublicationType>Randomized Controlled Trial</PublicationType></PublicationTypeList>
    </Article></MedlineCitation>
    <PubmedData><ArticleIdList>
      <ArticleId IdType="doi">10.1000/ABC</ArticleId>
      <ArticleId IdType="pmc">PMC123</ArticleId>
    </ArticleIdList></PubmedData>
  </PubmedArticle>
</PubmedArticleSet>`;

function federatedMockFetch(): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("eutils.ncbi.nlm.nih.gov") && url.includes("esearch.fcgi")) {
      return jsonResponse({ esearchresult: { count: "1", idlist: ["12345"] } });
    }
    if (url.includes("eutils.ncbi.nlm.nih.gov") && url.includes("efetch.fcgi")) {
      return new Response(pubmedXml, { status: 200, headers: { "Content-Type": "application/xml" } });
    }
    if (url.includes("ebi.ac.uk/europepmc")) {
      return jsonResponse({ resultList: { hitCount: 1, result: [{ source: "MED", id: "12345", pmid: "12345", pmcid: "PMC123", doi: "10.1000/ABC", title: "Asthma treatment outcomes in adults", authorString: "Doe J", journalTitle: "Clinical Medicine", pubYear: "2024", abstractText: "Study abstract.", isOpenAccess: "Y", citedByCount: 11, pubTypeList: { pubType: ["Randomized Controlled Trial"] } }] } });
    }
    if (url.includes("api.openalex.org")) {
      return jsonResponse({ meta: { count: 1 }, results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.1000/ABC", title: "Asthma treatment outcomes in adults", publication_year: 2024, authorships: [{ author: { display_name: "Jane Doe" } }], primary_location: { source: { display_name: "Clinical Medicine" }, landing_page_url: "https://example.test/article" }, open_access: { is_oa: true }, best_oa_location: { landing_page_url: "https://example.test/article" }, cited_by_count: 8, type: "article" }] });
    }
    if (url.includes("api.crossref.org")) {
      return jsonResponse({ message: { "total-results": 1, items: [{ DOI: "10.1000/ABC", title: ["Asthma treatment outcomes in adults"], author: [{ given: "Jane", family: "Doe" }], "container-title": ["Clinical Medicine"], published: { "date-parts": [[2024]] }, "is-referenced-by-count": 15, type: "journal-article", "update-to": [{ type: "retraction" }], URL: "https://doi.org/10.1000/ABC" }] } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("evidence search query planning", () => {
  test("detects bilingual language, explicit PICO, and safe term expansion", () => {
    const plan = buildEvidenceQueryPlan("P: pasien dewasa dengan asma; I: inhaled corticosteroid; O: eksaserbasi");
    expect(plan.language).toBe("id");
    expect(plan.pico.population).toBe("pasien dewasa dengan asma");
    expect(plan.pico.intervention).toBe("inhaled corticosteroid");
    expect(plan.pico.outcome).toBe("eksaserbasi");
    expect(plan.expandedTerms).toContain("asthma");
    expect(plan.queryVariants.length).toBeGreaterThan(0);
  });

  test("builds a broad bilingual clinical query instead of searching only the input language", () => {
    const plan = buildEvidenceQueryPlan("tatalaksana pneumonia aspirasi pada anak");
    expect(plan.normalizedQuery).toContain("aspiration pneumonia");
    expect(plan.normalizedQuery).toContain("management");
    expect(plan.expandedTerms).toEqual(expect.arrayContaining(["aspiration", "pediatric", "paediatric"]));
    expect(plan.queryVariants[0]).toMatch(/pneumonia|aspirasi/i);
  });

  test("keeps short clinical abbreviations searchable", () => {
    const plan = buildEvidenceQueryPlan("TB");
    expect(plan.normalizedQuery).toContain("tuberculosis");
    expect(plan.expandedTerms).toContain("mycobacterium tuberculosis");
  });
});

describe("federated evidence search", () => {
  test("deduplicates DOI/PMID/PMCID records and preserves provider provenance", async () => {
    const result = await searchFederatedEvidence({ query: "asthma", limit: 5, fetchImpl: federatedMockFetch() });
    expect(result.engine).toBe("federated");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.doi).toBe("10.1000/abc");
    expect(result.results[0]?.sourceIds).toEqual(expect.arrayContaining(["pubmed", "europepmc", "openalex", "crossref"]));
    expect(result.results[0]?.retractionStatus).toBe("retracted");
    expect(result.providers.every((provider) => provider.status === "ok")).toBe(true);
  });

  test("extracts figure metadata from an open Europe PMC full text article", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/fullTextXML")) {
        return new Response(`<article><fig id="F1"><label>Figure 1</label><caption><p>Diagnostic pathway for the study population.</p></caption><graphic xlink:href="example.g001.jpg" /></fig></article>`, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      if (url.includes("pmc.ncbi.nlm.nih.gov/articles/PMC999")) {
        return new Response(`<html><img src="https://cdn.ncbi.nlm.nih.gov/pmc/blobs/1234/5678/example.g001.jpg" /></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
      }
      if (url.includes("europepmc.org") || url.includes("ebi.ac.uk/europepmc")) {
        return jsonResponse({ resultList: { hitCount: 1, result: [{ source: "MED", id: "2", pmcid: "PMC999", title: "Asthma diagnostic pathway", journalTitle: "Clinical Medicine", pubYear: "2024", isOpenAccess: "Y" }] } });
      }
      throw new Error("provider not selected");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "asthma diagnosis", limit: 5, providers: ["europepmc"], fetchImpl });
    expect(result.results[0]?.figures?.[0]).toMatchObject({ label: "Figure 1", caption: "Diagnostic pathway for the study population." });
    expect(result.results[0]?.figures?.[0]?.imageUrl).toBe("https://cdn.ncbi.nlm.nih.gov/pmc/blobs/1234/5678/example.g001.jpg");
  });

  test("adds relevant web-search results when a server-side search key is configured", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("api.search.brave.com")) {
        expect(new URL(String(input)).searchParams.get("q")).toMatch(/asthma/i);
        return jsonResponse({ web: { total: 1, results: [{ title: "Asthma diagnosis guideline", url: "https://guidelines.example/asthma", description: "Evidence-based asthma diagnosis and management guidance.", profile: { long_name: "Clinical Guidelines" } }] } });
      }
      throw new Error("provider not selected");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "asthma diagnosis", limit: 5, providers: ["web"], webSearchApiKey: "test-key", fetchImpl });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ source: "web", title: "Asthma diagnosis guideline", url: "https://guidelines.example/asthma" });
    expect(result.providers[0]).toMatchObject({ provider: "web", status: "ok" });
  });

  test("returns partial results when one provider is unavailable", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("ebi.ac.uk/europepmc")) return jsonResponse({ resultList: { hitCount: 1, result: [{ source: "MED", id: "2", title: "Hypertension review", pubYear: "2023" }] } });
      throw new Error("provider offline");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "hypertension", limit: 3, providers: ["europepmc", "pubmed"], fetchImpl });
    expect(result.results).toHaveLength(1);
    expect(result.providers.find((provider) => provider.provider === "pubmed")?.status).toBe("error");
    expect(result.warnings).toContain("pubmed tidak tersedia saat pencarian ini.");
  });

  test("fails clearly when every selected provider is unavailable", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); }) as typeof fetch;
    await expect(searchFederatedEvidence({ query: "sepsis", limit: 3, providers: ["pubmed", "crossref"], fetchImpl })).rejects.toBeInstanceOf(EvidenceSearchUnavailableError);
  });

  test("hides provider candidates without a topic match", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("api.crossref.org")) {
        return jsonResponse({ message: { "total-results": 1, items: [{ DOI: "10.1000/unrelated", title: ["A literary study of poetry"], author: [{ given: "Jane", family: "Doe" }], "container-title": ["Arts Review"], published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1000/unrelated" }] } });
      }
      throw new Error("provider not selected");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "pneumonia aspirasi", limit: 5, providers: ["crossref"], fetchImpl });
    expect(result.results).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("tanpa kecocokan istilah topik"))).toBe(true);
  });

  test("does not turn a generic research request into unrelated evidence", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("api.crossref.org")) {
        return jsonResponse({ message: { "total-results": 1, items: [{ DOI: "10.1000/trust", title: ["Trust and health information systems"], "container-title": ["Health Informatics"], published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1000/trust" }] } });
      }
      throw new Error("provider not selected");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "Help me research this topic with trustworthy medical sources. Clarify the question and compare the evidence.", limit: 5, providers: ["crossref"], fetchImpl });
    expect(result.results).toEqual([]);
  });

  test("requires the concrete clinical topic when filtering broad provider results", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes("api.crossref.org")) {
        return jsonResponse({ message: { "total-results": 2, items: [
          { DOI: "10.1000/tb", title: ["Tuberculosis diagnosis and treatment"], "container-title": ["Clinical Review"], published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1000/tb" },
          { DOI: "10.1000/nf", title: ["Guidelines for the diagnosis and management of neurofibromatosis"], "container-title": ["Journal of Medical Genetics"], published: { "date-parts": [[2024]] }, URL: "https://doi.org/10.1000/nf" },
        ] } });
      }
      throw new Error("provider not selected");
    }) as typeof fetch;
    const result = await searchFederatedEvidence({ query: "Jelaskan diagnosis dan tatalaksana tuberkulosis paru", limit: 5, providers: ["crossref"], fetchImpl });
    expect(result.results.map((item) => item.doi)).toEqual(["10.1000/tb"]);
  });
});
