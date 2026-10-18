# Koasis Computer + InstaBox

Computer sekarang memakai InstaBox sebagai workspace Linux per user. Browser tidak pernah menerima API key; browser hanya menerima Firebase ID token dan URL desktop sementara.

## Arsitektur

```text
Browser -> Firebase App Hosting /api/computer/*
             | Firebase bearer auth
             | PostgreSQL user -> machine mapping
             ` InstaBox API (INSTABOX_API_KEY, server-only)
```

`server/instabox.ts` memakai SDK resmi `@insforge/instabox-sdk`. Endpoint backend berada di `server/koasisBackend.ts`, sedangkan client UI berada di `src/lib/computerClient.ts` dan halaman Computers di `src/components/AgenticChat.tsx`.

## Konfigurasi runtime

Wajib di Firebase App Hosting Environment (runtime server-side):

```text
INSTABOX_API_KEY=<restricted key, never VITE_*>
INSTABOX_API_URL=https://api.instabox.sh
```

Rekomendasi key: scope `machines:write`; tidak perlu `machines:delete` atau `images:*` untuk flow ini.

Pengaturan lain:

```text
INSTABOX_TEMPLATE=agent-browser
INSTABOX_ALLOW_PROVISIONING=false
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
| `POST /api/computer/session` | Resume/provision machine, start desktop, dan membuat stream URL TTL 10 menit |
| `POST /api/computer/action` | Aksi desktop tervalidasi: screenshot, open, click, type, press, scroll |
| `POST /api/computer/revoke` | Mencabut seluruh stream URL machine user |
| `POST /api/computer/pause` | Menjeda machine dan mencabut session aktif |

Provisioning dan lifecycle memakai advisory lock PostgreSQL per user supaya request paralel tidak membuat dua machine. Mapping disimpan di `koasis_computer_machines`; session sementara disimpan di `koasis_computer_sessions`.

## Batas keamanan

- API key hanya berada di App Hosting runtime.
- `vault: false` dipakai saat machine baru dibuat agar secret account InstaBox tidak masuk ke workspace user.
- URL desktop dibuat ulang setiap session dan stream sebelumnya dicabut.
- Screenshot, password, isi ketikan, dan command tidak disimpan ke database.
- Command shell arbitrary belum diekspos ke browser; aksi yang tersedia dibatasi pada desktop control.
- Machine tidak dihapus otomatis dari flow user. Penghapusan perlu workflow admin terpisah karena bersifat irreversibel.

## Urutan aktivasi

1. Buat restricted API key di dashboard InstaBox.
2. Tambahkan `INSTABOX_API_KEY` melalui Environment settings pada backend App Hosting
   (jangan menaruhnya di `VITE_*`, repo, atau browser bundle).
3. Uji `GET /api/computer/status` dengan user login.
4. Untuk machine existing, set `INSTABOX_DEFAULT_MACHINE_NAME` dan `INSTABOX_DEFAULT_OWNER_UID`.
5. Untuk machine per user, ubah `INSTABOX_ALLOW_PROVISIONING=true` setelah quota akun dan kebijakan biaya disetujui.
