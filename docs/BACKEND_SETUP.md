# Koasis backend setup

Koasis sekarang memakai tiga lapisan penyimpanan dengan batas yang jelas:

- Firebase Auth + Firestore: state workspace, preferensi, riwayat chat, clinical capture, dan portfolio evidence milik user yang sedang login.
- Firebase Storage: attachment chat dan file konteks stase. Firestore hanya menyimpan metadata dan `storagePath`, bukan data URL atau binary.
- PostgreSQL VPS: jalur server-side untuk event operasional dan data relasional yang akan ditambahkan berikutnya. Browser tidak pernah menerima URL/kredensial PostgreSQL.

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

Jika frontend berjalan di Firebase App Hosting dan API berjalan di Dokploy, isi `VITE_KOASIS_API_BASE_URL` pada build frontend dengan URL service API Dokploy, misalnya `https://server.example.com/koasis-app`. Tambahkan origin frontend ke `KOASIS_CORS_ORIGINS`; PostgreSQL tetap gunakan host internal Dokploy dan jangan buka port database ke publik.

## Dokploy / VPS

Di service aplikasi Dokploy untuk Koasis:

1. Set source repository dan build command `npm run build`.
2. Set start command `npm run start` dan expose port `8080` (atau port yang diberikan lewat `PORT`).
3. Tambahkan seluruh `VITE_FIREBASE_*`, `JAMED_AI_*`, `JAMED_RENDERER_*`, `KOASIS_POSTGRES_URL`, `KOASIS_POSTGRES_SSL`, dan `KOASIS_POSTGRES_MAX_CONNECTIONS` sebagai environment variables/secret di Dokploy.
4. Jika PostgreSQL berada di service Docker/VPS yang sama, gunakan hostname internal service, bukan `localhost` dari browser. Pastikan network Dokploy mengizinkan koneksi ke port PostgreSQL.
5. Setelah deploy, cek `GET /api/backend/health`. Respons sehat mengandung `database.configured: true` dan `database.reachable: true`.

Database PostgreSQL sudah diprovision di environment `Koasis / production`:

- Service: `Koasis PostgreSQL` (image `postgres:18`), status running.
- Database/user: `koasis` / `koasis_app` (password disimpan sebagai secret Dokploy).
- Internal host/port: `koasis-postgres-tk9hmi:5432`.
- Persistent volume: `koasis-postgres-tk9hmi-data` mounted at `/var/lib/postgresql/18/docker`.
- Port internet tidak dibuka; gunakan internal host ketika service aplikasi berada pada network Dokploy yang sama.

Saat service aplikasi Koasis dibuat atau dideploy ke environment tersebut, isi `KOASIS_POSTGRES_URL` sebagai secret menggunakan internal host di atas. Jangan commit URL database atau password ke repository.

Saat event pertama ditulis, backend membuat tabel `koasis_events` dan index-nya secara idempotent. Untuk production yang lebih ketat, langkah berikutnya adalah memindahkan DDL ini ke migration runner terpisah dan menonaktifkan schema auto-create.

## Data boundary

Semua dokumen Firestore berada di bawah `users/{uid}/koasis/*` dan rules hanya mengizinkan owner yang login. Storage berada di bawah `users/{uid}/...`. Data clinical tetap melewati privacy guard di browser; gunakan alias dan konteks umum, bukan identitas langsung pasien.

Endpoint PostgreSQL saat ini adalah fondasi server-side:

- `GET /api/backend/health` — konektivitas database tanpa membocorkan detail koneksi.
- `POST /api/backend/events` — event operasional terautentikasi Firebase untuk integrasi berikutnya.

Jangan mengirim catatan klinis mentah ke endpoint event tersebut. Untuk data clinical relasional, kita akan menambahkan tabel dan API terpisah setelah skema final disepakati.
