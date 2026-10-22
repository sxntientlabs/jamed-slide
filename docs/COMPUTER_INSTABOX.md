# Koasis Computer + InstaBox

Computer sekarang memakai InstaBox sebagai workspace Linux per user. Browser tidak pernah menerima API key; browser hanya menerima Firebase ID token dan URL desktop sementara.

## Arsitektur

```text
Browser -> Firebase App Hosting (chat and lightweight API)
       -> Dokploy Koasis App /koasis-app/api/computer/*
             | Firebase bearer auth
             | private PostgreSQL user -> machine mapping
             ` InstaBox API (INSTABOX_API_KEY, server-only)
```

`server/instabox.ts` memakai SDK resmi `@insforge/instabox-sdk`. Endpoint backend berada di `server/koasisBackend.ts`, sedangkan client UI berada di `src/lib/computerClient.ts` dan halaman Computers di `src/components/AgenticChat.tsx`.

## Konfigurasi runtime

Wajib di environment runtime service `Koasis App` pada Dokploy:

```text
INSTABOX_API_KEY=<restricted key, never VITE_*>
INSTABOX_API_URL=https://api.instabox.sh
```

App Hosting hanya menyimpan URL publik API Dokploy sebagai build/runtime
configuration. API key tidak boleh dimasukkan ke `VITE_*` atau browser bundle.
PostgreSQL tetap memakai hostname internal Dokploy dan tidak perlu membuka port
database ke internet.

Rekomendasi key: scope `machines:write`; tidak perlu `machines:delete` atau `images:*` untuk flow ini.

Pengaturan lain:

```text
INSTABOX_TEMPLATE=agent-browser
INSTABOX_ALLOW_PROVISIONING=false
INSTABOX_ALLOW_AGENT_CONTROL=false
INSTABOX_MACHINE_TIMEOUT_MS=14400000
INSTABOX_AUTO_SUSPEND_MS=1800000
```

Provisioning default sengaja `false`. Setelah key diuji dan kebijakan quota disetujui, ubah menjadi `true` agar user baru dapat membuat machine lazy saat pertama kali membuka Computer.

Untuk memakai machine yang sudah ada, misalnya `sundaland`, tanpa membuat machine baru:

```text
INSTABOX_DEFAULT_MACHINE_NAME=sundaland
INSTABOX_DEFAULT_OWNER_UID=<Firebase UID pemilik>
```

Binding tersebut hanya berlaku jika kedua nilai cocok. User lain tidak dapat mengambil machine itu.

## Endpoint

Semua endpoint memerlukan `Authorization: Bearer <Firebase ID token>`.

| Endpoint | Kegunaan |
| --- | --- |
| `GET /api/computer/status` | Membaca status mapping dan machine tanpa membangunkannya |
| `POST /api/computer/session` | Resume/provision machine, start desktop, dan membuat stream URL TTL 10 menit; session biasa default view-only |
| `POST /api/computer/action` | Aksi desktop tervalidasi: screenshot, open, click, type, press, scroll; hanya session kontrol yang bisa memanggilnya |
| `POST /api/computer/revoke` | Mencabut seluruh stream URL machine user |
| `POST /api/computer/pause` | Menjeda machine dan mencabut session aktif |

Provisioning dan lifecycle memakai advisory lock PostgreSQL per user supaya request paralel tidak membuat dua machine. Mapping disimpan di `koasis_computer_machines`; session sementara disimpan di `koasis_computer_sessions`.

## Batas keamanan

- API key hanya berada di runtime service Koasis App pada Dokploy.
- `vault: false` dipakai saat machine baru dibuat agar secret account InstaBox tidak masuk ke workspace user.
- URL desktop dibuat ulang setiap session dan stream sebelumnya dicabut.
- Screenshot, password, isi ketikan, dan command tidak disimpan ke database.
- Command shell arbitrary belum diekspos ke browser; aksi yang tersedia dibatasi pada desktop control.
- Agent hanya mendapat tool Computer ketika pesan user secara eksplisit meminta browser/desktop/computer. Tool memakai session kontrol server-side terpisah, maksimal 32 aksi dalam 16 putaran per permintaan, lalu session dicabut otomatis.
- `INSTABOX_ALLOW_AGENT_CONTROL` adalah sakelar terpisah dari provisioning. Biarkan `false` bila agent hanya boleh menjawab teks; ubah ke `true` setelah kebijakan kontrol, quota, dan review disetujui.
- Machine tidak dihapus otomatis dari flow user. Penghapusan perlu workflow admin terpisah karena bersifat irreversibel.

## Urutan aktivasi

1. Buat restricted API key di dashboard InstaBox.
2. Tambahkan `INSTABOX_API_KEY` melalui Environment settings service `Koasis App` di Dokploy
   (jangan menaruhnya di `VITE_*`, repo, atau browser bundle).
3. Pastikan domain service `https://server.eltexlabs.com/koasis-app` aktif dan
   `KOASIS_CORS_ORIGINS` mencakup `https://koasis.my.id`.
4. Uji `GET /api/backend/health` pada domain Dokploy; respons harus menunjukkan
   database configured dan reachable.
5. Uji `GET /api/computer/status` dengan user login dari App Hosting.
6. Untuk machine existing, set `INSTABOX_DEFAULT_MACHINE_NAME` dan `INSTABOX_DEFAULT_OWNER_UID`.
7. Untuk machine per user, ubah `INSTABOX_ALLOW_PROVISIONING=true` setelah quota akun dan kebijakan biaya disetujui.
8. Untuk mengaktifkan agent menggunakan Computer, set `INSTABOX_ALLOW_AGENT_CONTROL=true`. Ini tidak diperlukan untuk tombol manual `Buka desktop` atau `Ambil kontrol`.

## Keep-alive shared machines

Lima machine shared dapat melewati batas idle 30 menit pada InstaBox. Repository
menyediakan single-run job yang aman dijalankan oleh scheduler Dokploy:

```text
npm run instabox:keepalive
```

Job ini memakai `INSTABOX_API_KEY` dari environment server, me-resume machine
yang sudah paused, lalu menjalankan command no-op `true` agar timer idle
ter-reset. Job tidak membuka desktop, tidak membaca/menulis file, dan tidak
mencetak API key.

Tambahkan Cron Job pada service `Koasis App` di Dokploy dengan jadwal berikut
(25 menit dipilih agar tidak balapan dengan batas auto-pause 30 menit):

```cron
*/25 * * * *
```

Command-nya:

```bash
npm run instabox:keepalive
```

Gunakan environment runtime yang sama dengan `Koasis App`, minimal
`INSTABOX_API_KEY`, `INSTABOX_API_URL`, dan `INSTABOX_SHARED_MACHINE_IDS`.
Jangan menaruh key di repo, `VITE_*`, browser, atau Secret Manager yang tidak
Anda kelola. Menjaga kelima machine tetap aktif meningkatkan pemakaian
resource; bila ingin menghindari biaya idle, jangan pasang job ini dan biarkan
Instabox melakukan auto-pause.
