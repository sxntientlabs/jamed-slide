---
name: koasis-evidence
description: Evidence-first research workflow for Koasis clinical and scientific questions.
---

# Koasis evidence workflow

Use this skill whenever the user asks for medical, scientific, guideline,
diagnostic, treatment, or literature-backed information.

1. Rewrite the question into a structured concept map: condition/population,
   intervention or exposure, comparator, outcome, setting, and date boundary.
2. Generate search terms in both Indonesian and English, including synonyms,
   spelling variants, abbreviations, MeSH-like terms, and the likely study
   design. Do not search only the literal user wording.
3. Search at least two independent routes when available. Start with OpenAlex
   for broad scholarly discovery, then verify important claims with PubMed/PMC,
   Crossref, a full-text source, or an official guideline. Use web search for
   publisher pages and current guidance when API results are incomplete.
4. Deduplicate by DOI, PMID, OpenAlex ID, or normalized title. Rank sources by
   topical match, study design, recency, full-text availability, and authority.
5. Do not treat an abstract index as proof of a clinical recommendation. Mark
   records that are only metadata or abstract-level evidence.
6. Tie every material claim to one or more numbered sources. Keep the source
   title, authors, venue, year, DOI/URL, and access level in the evidence table.
7. If the first search is weak, broaden the semantic query, translate it, try a
   second study-design formulation, and search the web before saying evidence
   is unavailable. Report the exact limitation only after these attempts.

The final answer should contain: a direct synthesis, evidence strength and
limits, inline citations, a compact reference list, and two or three follow-up
questions that naturally continue from the sources actually found.
