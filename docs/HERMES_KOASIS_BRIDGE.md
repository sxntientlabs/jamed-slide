# Hermes bridge untuk Koasis

Koasis mode `Agentic` sekarang memiliki adapter server-side ke Hermes Runs API.
Frontend tetap berbicara ke `POST /api/agent/chat` dengan NDJSON; adapter
mengubahnya menjadi `POST /v1/runs`, kemudian menerjemahkan SSE
`/v1/runs/{run_id}/events` kembali menjadi status, delta jawaban, dan preview
aktivitas Computer.

## Konfigurasi server

Simpan semua nilai berikut hanya di runtime server (Firebase App Hosting atau
local `.env.local`), bukan di `VITE_*`:

```ini
KOASIS_AGENT_RUNTIME=hermes
KOASIS_HERMES_API_URL=https://api-jawirs.eltexlabs.com
KOASIS_HERMES_API_KEY=<API_SERVER_KEY Hermes>
KOASIS_HERMES_MODEL=hermes-agent
```

`KOASIS_AGENT_RUNTIME=auto` aman untuk transisi: Hermes dipakai bila URL dan
key tersedia; jika belum, Koasis tetap memakai runtime Agent yang sudah ada.
`KOASIS_AGENT_RUNTIME=rakazo` memaksa fallback lama.

## Endpoint VPS

Hermes harus listen hanya pada `127.0.0.1:8642`. Publikasikan melalui
Cloudflare Tunnel atau reverse proxy HTTPS dengan bearer authentication tetap
aktif. Jangan membuka port 8642 langsung ke internet. Pada zone ini, hostname
publik satu tingkat `api-jawirs.eltexlabs.com` dipakai agar tercakup sertifikat
edge wildcard Cloudflare; subdomain bertingkat `api.jawirs.eltexlabs.com`
tidak dipakai untuk koneksi HTTPS.

Endpoint minimum yang perlu diuji dari App Hosting:

```text
GET  /health
GET  /v1/capabilities
GET  /v1/models
POST /v1/runs
GET  /v1/runs/{run_id}/events
```

Jika menggunakan tunnel yang sudah ada, tambahkan hostname dan ingress ke
origin `http://127.0.0.1:8642`, kemudian jalankan restart gateway dari SSH
eksternal. API key tidak perlu dikirim lewat Telegram atau dimasukkan ke
browser.

## Model dan sesi

Koasis mengirim `session_id` yang diturunkan dari percakapan Koasis sehingga
Hermes dapat mempertahankan konteks antar-turn. `reasoningEffort` dipetakan ke
`model_options.reasoning_effort` (`mild → low`, `moderate → medium`, `severe →
high`). Idempotency key memakai request ID Koasis agar retry tidak membuat run
ganda.

## Kontrak file, gambar, dan media

Adapter Koasis mengikuti pola media yang sudah dipakai gateway Telegram Hermes:

- gambar dikirim melalui endpoint multimodal `/v1/chat/completions` sebagai
  `image_url` data URL sehingga vision tetap native;
- PDF, audio, video, DOCX/PPTX, dan file umum dikirim melalui `/v1/runs` sebagai
  manifest `attachments`. Patch runtime menulis data URL ke cache Hermes dengan
  nama/MIME asli dan memberi Agent path yang bisa dibaca tool file/media;
- output eksplisit maupun `MEDIA:/path` dari Agent dikembalikan sebagai artifact
  dengan `kind`, `fileName`, `mimeType`, dan data URL. Koasis menampilkan gambar,
  menyediakan playback audio/video, dan menyediakan tombol unduh untuk file;
- batas aman per file adalah 8 MB, total input/output per task 32 MB, maksimal
  enam attachment di bridge dan empat attachment aktif dari composer.

Patch ini dipasang saat image `koasis-agent` dibangun melalui
`koasis-agent/patch_media_bridge.py`; ia tidak mengubah adapter Telegram.
