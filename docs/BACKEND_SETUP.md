# Koasis backend setup

Arsitektur production Koasis dibagi berdasarkan beban kerja:

- Firebase App Hosting: frontend React dan API ringan same-origin (`/api/*`).
- Firebase Auth + Firestore: state workspace, preferensi, riwayat chat, dan metadata milik user yang sedang login.
- Firebase Storage: attachment dan file yang memang perlu dipersistenkan. Firestore hanya menyimpan metadata dan `storagePath`, bukan data URL atau binary.
- Dokploy/VPS: Computer API yang membutuhkan PostgreSQL privat, pekerjaan berat yang lebih murah dijalankan sendiri, terutama PPTX renderer dan AI gateway/service bila dipakai.
- PostgreSQL VPS: data relasional server-side. Browser tidak pernah menerima URL atau kredensial PostgreSQL.

Alur production yang diharapkan:

```text
Browser -> Firebase App Hosting (frontend + API ringan)
                    |-> Firebase Auth / Firestore / Storage
                    |-> Dokploy Koasis App /koasis-app/api/computer/*
                    |-> Dokploy renderer atau AI service melalui HTTPS
Dokploy Koasis App -> PostgreSQL internal + InstaBox API
```

## Firebase

Project Firebase aktif di repository ini adalah `jamed-9bdbe` (lihat `.firebaserc`). Deploy rules dari root project:

```bash
firebase deploy --only firestore:rules,storage
```

Firestore rules dan Storage rules sudah dirilis ke project tersebut. Bucket Firebase Storage `jamed-9bdbe.firebasestorage.app` sudah diinisialisasi di region `ASIA-SOUTHEAST1` dengan production security mode. Authentication provider yang digunakan aplikasi juga harus aktif.

## Environment variables

Client build membutuhkan variabel `VITE_FIREBASE_*` dari `.env.example`. Variabel server tidak boleh menggunakan prefix `VITE_`:

```env
KOASIS_POSTGRES_URL=postgresql://koasis_app:password@vps-host:5432/koasis
KOASIS_POSTGRES_SSL=true
KOASIS_POSTGRES_MAX_CONNECTIONS=5
```

`DATABASE_URL` juga diterima sebagai fallback, tetapi `KOASIS_POSTGRES_URL` lebih eksplisit untuk deployment Koasis. Jangan commit `.env.local` atau service-account JSON.

### Firebase App Hosting (production)

App Hosting menjalankan frontend dan API ringan dari repository yang sama. Biarkan `VITE_KOASIS_API_BASE_URL` kosong agar browser memanggil `/api/*` pada origin `koasis.my.id`.

Endpoint Computer adalah pengecualian: set `VITE_KOASIS_COMPUTER_API_BASE_URL=https://server.eltexlabs.com/koasis-app` pada build App Hosting agar status, session, dan aksi desktop diproses oleh Koasis App yang dapat mengakses PostgreSQL privat. Agent Computer dari App Hosting memakai target runtime `KOASIS_INTERNAL_URL=https://server.eltexlabs.com/koasis-app`.

Atur variabel runtime melalui App Hosting/Firebase Secret Manager:

- `JAMED_AI_BASE_URL` dan `JAMED_AI_MODEL` untuk provider/gateway AI.
- `JAMED_AI_API_KEY` sebagai secret.
- `JAMED_RENDERER_URL=https://server.eltexlabs.com/koasis-renderer`.
- `JAMED_RENDERER_TOKEN` sebagai secret.

App Hosting tidak perlu diberi `KOASIS_POSTGRES_URL` atau `INSTABOX_API_KEY`. Endpoint health ringan App Hosting dapat melaporkan `database.configured: false`; itu tidak lagi menjadi indikator kesehatan fitur Computer. Periksa `https://server.eltexlabs.com/koasis-app/api/backend/health`, yang harus menunjukkan database configured dan reachable.

### Direct Dokploy staging

Jika ingin menguji build aplikasi langsung di Dokploy, barulah isi `VITE_KOASIS_API_BASE_URL` dengan URL service staging, misalnya `https://server.example.com/koasis-app`, dan atur `KOASIS_CORS_ORIGINS` untuk origin yang diizinkan. Ini bukan jalur production utama.

## Dokploy / VPS

Service production yang perlu tetap hidup di Dokploy:

1. Koasis App dengan domain `https://server.eltexlabs.com/koasis-app`, untuk Computer API, mapping machine/session, dan akses PostgreSQL privat.
2. PPTX renderer dengan domain `https://server.eltexlabs.com/koasis-renderer`.
3. AI gateway/service apabila inference memang dijalankan di VPS.
4. PostgreSQL internal tanpa port publik.

Koasis App tidak perlu melayani frontend publik. App Hosting tetap menjadi origin utama aplikasi; service Dokploy hanya menerima request backend yang memang membutuhkan database atau pekerjaan berat.

Konfigurasi Koasis App production:

1. Set source repository dan build command `npm run build`.
2. Set start command `npm run start` dan expose port `8080` (atau port yang diberikan lewat `PORT`).
3. Tambahkan `KOASIS_POSTGRES_URL`, `KOASIS_POSTGRES_SSL`, `KOASIS_POSTGRES_MAX_CONNECTIONS`, `INSTABOX_API_KEY`, `INSTABOX_API_URL`, dan flag InstaBox sebagai environment variables/secret di Dokploy.
4. Jika PostgreSQL berada di service Docker/VPS yang sama, gunakan hostname internal service, bukan `localhost` dari browser. Pastikan network Dokploy mengizinkan koneksi ke port PostgreSQL.
5. Setelah deploy, cek `GET /api/backend/health`. Respons sehat mengandung `database.configured: true` dan `database.reachable: true`.

Database PostgreSQL sudah diprovision di environment `Koasis / production`:

- Service: `Koasis PostgreSQL` (image `postgres:18`), status running.
- Database/user: `koasis` / `koasis_app` (password disimpan sebagai secret Dokploy).
- Internal host/port: `koasis-postgres-tk9hmi:5432`.
- Persistent volume: `koasis-postgres-tk9hmi-data` mounted at `/var/lib/postgresql/18/docker`.
- Port internet tidak dibuka; gunakan internal host ketika service aplikasi berada pada network Dokploy yang sama.

Saat service yang membutuhkan PostgreSQL dibuat atau dideploy ke environment tersebut, isi `KOASIS_POSTGRES_URL` sebagai secret menggunakan internal host di atas. Jangan commit URL database atau password ke repository.

Saat event pertama ditulis, backend membuat tabel `koasis_events` dan index-nya secara idempotent. Untuk production yang lebih ketat, langkah berikutnya adalah memindahkan DDL ini ke migration runner terpisah dan menonaktifkan schema auto-create.

## Data boundary

Semua dokumen Firestore berada di bawah `users/{uid}/koasis/*` dan rules hanya mengizinkan owner yang login. Storage berada di bawah `users/{uid}/...`. Data clinical tetap melewati privacy guard di browser; gunakan alias dan konteks umum, bukan identitas langsung pasien.

Catatan implementasi saat ini: workspace metadata, preferensi, riwayat chat, dan evidence tertentu sudah memakai Firebase. Draft klinis aktif, data URL attachment pasien, dan file PPTX hasil generate masih berada di memory/browser dan belum otomatis diunggah ke Storage. Migrasi bagian tersebut harus dilakukan melalui alur upload terpisah agar ukuran payload, privacy, dan retention dapat dikontrol dengan benar.

Endpoint PostgreSQL saat ini adalah fondasi server-side:

- `GET /api/backend/health` — konektivitas database tanpa membocorkan detail koneksi.
- `POST /api/backend/events` — event operasional terautentikasi Firebase untuk integrasi berikutnya.

Jangan mengirim catatan klinis mentah ke endpoint event tersebut. Untuk data clinical relasional, kita akan menambahkan tabel dan API terpisah setelah skema final disepakati.
