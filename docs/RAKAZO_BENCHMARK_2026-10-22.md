# Rakazo bridge benchmark — 22 October 2026

Pengukuran dilakukan terhadap bridge Rakazo yang berjalan di InstaBox Omega.
Request dikirim langsung ke endpoint bridge dengan header internal yang sama
dengan adapter Koasis. `headers` adalah waktu sampai NDJSON mulai tersedia,
`first delta` adalah waktu sampai token/hasil pertama diterima, dan `done`
adalah waktu sampai event selesai diterima.

## Hasil

| Jenis task | Status | Headers | First delta/activity | Selesai | Total | Catatan |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Chat singkat, jawaban satu token | 200 | 1.00 dtk | 7.19 dtk | 7.19 dtk | 7.19 dtk | 1 delta |
| Chat klinis biasa | 200 | 1.02 dtk | 3.01 dtk | 3.32 dtk | 3.32 dtk | 2 delta |
| Evidence research: pencarian web + baca PMC/BTS | 200 | 1.09 dtk | 27.87 dtk | 31.02 dtk | 31.03 dtk | 9 delta; search dan page-reading terlihat pada activity/status |
| Computer: buka Google Docs | 200 | 1.12 dtk | 1.14 dtk | 3.03 dtk | 3.04 dtk | 3 activity event; machine sudah running |
| Computer tanpa approval | 409 | — | — | — | 1.13 dtk | Ditolak sebelum menyentuh Computer |

## Uji konkurensi

Dua chat dikirim bersamaan dengan token pembeda:

| Request | Total | Antrean | Hasil |
| --- | ---: | --- | --- |
| A | 5.14 dtk | Tidak | `BENCH-ALPHA` |
| B | 7.29 dtk | Ya | `BENCH-BETA` |
| Wall-clock pasangan | 7.39 dtk | — | Tidak ada cross-talk |

Request B menunggu slot shared Rakazo sekitar dua detik, tetapi jawabannya
tetap milik request B. Ini adalah trade-off yang disengaja karena satu bot dan
Computer dipakai bersama.

## Kesimpulan

- Jalur chat normal sudah responsif untuk runtime remote; overhead sampai
  header sekitar satu detik berasal dari bridge/network.
- Evidence research memang paling lama karena melakukan beberapa pencarian web
  dan membaca halaman sumber sebelum menyusun jawaban. Pada uji ini selesai
  dalam sekitar 31 detik, bukan hang.
- Jalur Computer fast-path lebih cepat karena navigasi sederhana tidak melewati
  satu putaran planning LLM penuh.
- Approval boundary bekerja: request Computer tanpa izin ditolak dalam sekitar
  satu detik.
- Antrean shared-thread mencegah jawaban tertukar. Task paralel tidak dijalankan
  bersamaan pada native bot yang sama.

Satu batch benchmark gabungan sebelumnya dihentikan karena runner benchmark-nya
tidak mengeluarkan hasil akhir setelah task evidence berjalan lama; task evidence
kemudian diulang secara terisolasi dan berhasil selesai dengan data di atas.
