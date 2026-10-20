# Evidence-based search

Koasis sekarang memiliki vertical slice pencarian evidence berbasis metadata publik. Route `POST /api/evidence/search` tetap berada di App Hosting dan hanya dapat dipanggil oleh user yang sudah login Firebase.

## Alur saat ini

```text
Browser Evidence Desk
        |
        v
POST /api/evidence/search
        |
        +--> PubMed / NCBI E-utilities (ESearch + EFetch XML)
        +--> Europe PMC (core metadata + abstract/full-text links)
        +--> OpenAlex (works metadata + OA locations)
        +--> Crossref (bibliographic metadata + update/retraction signals)
        +--> Web search (optional Brave/Tavily discovery, server-side key only)
        |
        +--> provider failure isolation
        +--> bilingual/semantic query planning (core topic + intent + PICO variants)
        +--> up to three query variants per provider, executed in parallel
        +--> DOI / PMID / PMCID deduplication
        +--> reciprocal-rank + core-term + semantic relevance reranking
        +--> provenance, access, and integrity flags
```

Pencarian tetap menghasilkan hasil parsial bila satu provider gagal. Jika semua provider gagal, API mengembalikan HTTP 502. Metadata yang tidak memiliki penanda retraction tidak dianggap otomatis valid; statusnya tetap `unknown`.

## API contract ringkas

Request:

```json
{
  "query": "P: pasien dewasa dengan asma; I: inhaled corticosteroid; O: eksaserbasi",
  "limit": 5,
  "providers": ["pubmed", "europepmc", "openalex", "crossref", "web"]
}
```

Response memuat `queryPlan` bilingual/PICO dengan `queryVariants`, `providers` dengan status tiap provider, `warnings`, dan setiap result membawa `sourceIds`, identifier yang tersedia, `publicationTypes`, `retractionStatus`, `isOpenAccess`, `fullTextUrl` bila provider menyediakannya, serta alasan ranking. Hasil adalah kandidat metadata/abstract; agent tetap diarahkan untuk membuka sumber asli dan menandai batas metadata versus full-text review. Query web Brave dikirim sebagai parameter `q` server-side; API key tidak pernah masuk ke browser.

## Konfigurasi opsional

```env
NCBI_API_KEY=
NCBI_CONTACT_EMAIL=
CROSSREF_MAILTO=
OPENALEX_MAILTO=
KOASIS_WEB_SEARCH_API_KEY=
KOASIS_WEB_SEARCH_PROVIDER=brave
KOASIS_WEB_SEARCH_URL=
```

Semua variabel ini server-only. Tanpa kredensial pun pencarian jurnal publik tetap berjalan. Bila `KOASIS_WEB_SEARCH_API_KEY` diisi, provider `web` otomatis ikut dalam pencarian; gunakan `brave` (default) atau `tavily`. `KOASIS_WEB_SEARCH_URL` hanya diperlukan bila endpoint provider diganti. `NCBI_API_KEY` meningkatkan batas pemanggilan E-utilities; email dipakai sebagai identitas polite-pool ketika provider mendukungnya.

## Batas legal dan klinis

- Adapter hanya memakai endpoint resmi; tidak ada scraping atau bypass paywall.
- Crossref diperlakukan metadata-first. Abstract Crossref tidak diteruskan ke konteks agent karena dapat memiliki hak cipta publisher/author.
- PMCID atau link provider bukan jaminan bahwa semua full text boleh disimpan atau diproses komersial. Verifikasi lisensi sebelum ingestion, embedding, atau synthesis.
- Spontaneous adverse-event reports dan metadata label obat belum dipakai sebagai incidence atau bukti kausalitas.
- Fitur ini adalah research assistant, bukan sistem diagnosis atau keputusan terapi.

## Langkah berikutnya

Vertical slice ini belum mengklaim seluruh master prompt selesai. Tahap berikutnya adalah adapter ClinicalTrials.gov, DailyMed/openFDA, controlled PNPK document import, PMC/JATS license-aware ingestion, persistence PostgreSQL, dan hybrid vector retrieval. Premium providers (Scopus, ScienceDirect, Cochrane) tetap harus disabled sampai kredensial dan izin lisensinya tersedia.
