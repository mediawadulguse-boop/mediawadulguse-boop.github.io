# Cloudflare Pages dan Supabase Pro

Target aplikasi adalah Cloudflare Pages untuk tampilan dan Supabase PostgreSQL, Auth, serta Edge Functions untuk layanan data. Repositori sumber tetap `mediawadulguse-boop/mediawadulguse-boop.github.io`.

## Status persiapan

Branch persiapan menyediakan build Cloudflare dan pemetaan migrasi. Aplikasi yang dibangun masih menghubungi Core API Apps Script sesuai `config.json`. Mengaktifkan Supabase memerlukan implementasi transport, login, kebijakan akses, serta fungsi server setelah proyek tujuan terhubung.

## Build Cloudflare Pages

| Pengaturan | Nilai |
| --- | --- |
| Nama proyek yang diusulkan | `media-wadul-guse` |
| Framework | None |
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist` |
| Root directory | Root repositori |
| Versi Node | 22 atau lebih baru |
| Branch awal | Branch persiapan pada pull request |

`wrangler.toml` menetapkan output yang sama untuk Wrangler. Build menyalin aset CMS, template Excel, PDF.js, ikon, dan AI Clipper. Script menolak symlink serta field konfigurasi publik yang belum dikenal. File aplikasi yang dibaca sebelum login hanya boleh memuat konfigurasi publik.

Cloudflare dapat dihubungkan ke GitHub melalui dashboard Workers & Pages. Gunakan deployment pratinjau untuk menguji login, kalender, impor, sinkronisasi, dan AI. Nama domain tujuan dan pengalihan layanan diputuskan setelah pengujian aplikasi pada proyek tujuan.

Referensi resmi tersedia di [integrasi GitHub Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).

## Pemetaan data dan perilaku

| Bagian | Data yang perlu dipindahkan dan perilaku yang perlu dipertahankan |
| --- | --- |
| Akun dan izin | ID akun lama, profil, peran, izin khusus, status aktif/resign, jadwal staf, serta penugasan historis |
| Brief dan tugas | ID brief/tugas, relasi petugas, jobdesk, status produksi, persetujuan, target, histori perubahan, dan arsip |
| Hot Issue | Deskripsi, sumber, link, status tindak lanjut, hasil AI, antrean analisis, relasi brief dan aduan |
| Rapat dan template | Notulen, agenda, keputusan, tindak lanjut, template brief, serta format teks |
| Footage dan dokumen | Link Google Drive, relasi brief, metadata, isi HTML, dan aturan akses dokumen |
| Insight | Link publikasi, snapshot metrik, screenshot, komentar, analisis, serta relasi ke brief |
| Sistem | Preferensi, pengaturan staf, aktivitas, audit, pencadangan, dan integrasi |

Audit awal menemukan 67 nama action yang dipanggil secara literal melalui `API.call` atau `jsonpCall` dalam `app.js`. Jumlah tersebut belum mencakup seluruh mutasi CRUD, action dinamis, atau layanan Social Listening. Daftar action lengkap harus diperiksa terhadap kode backend saat implementasi.

## Urutan migrasi database

1. Hubungkan proyek Supabase tujuan dan pastikan paket, region, serta pemilik proyek sesuai akun pengguna.
2. Ekspor data sumber secara privat, catat jumlah per tabel dan relasi, lalu verifikasi cadangan sebelum impor.
3. Bentuk tabel aplikasi dan profil yang menyimpan ID lama. Gunakan ID lama untuk mempertahankan seluruh referensi brief, tugas, akun, dan publikasi.
4. Terapkan Supabase Auth dan kebijakan Row Level Security untuk setiap tabel berdasarkan izin yang berlaku. Rencana aktivasi akun ditentukan setelah struktur kredensial lama diperiksa.
5. Implementasikan action baca/tulis di Supabase, termasuk transaksi relasi brief-tugas, pemeriksaan konflik, dan request ID idempoten untuk retry antrean.
6. Pindahkan operasi AI, metadata, WhatsApp, dan integrasi yang memerlukan kredensial ke fungsi server. Simpan kredensial server di secret proyek.
7. Tambahkan transport Supabase pada frontend dan uji antrean offline, logout, pembaruan sesi, serta pemisahan cache antar pengguna dan endpoint.
8. Impor data, bandingkan jumlah dan relasi dengan cadangan, jalankan pemeriksaan tiap peran, lalu lakukan perpindahan layanan setelah hasilnya sesuai.

Detail hak akses yang perlu diuji meliputi pembatasan data staf, pengaturan khusus administrator, staf resign yang tetap tercatat dalam histori, serta kalender publik yang hanya mengeluarkan field yang memang publik.

Referensi resmi tersedia di [Supabase Auth](https://supabase.com/docs/guides/auth/passwords) dan [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Kebutuhan akses berikutnya

- Akun Cloudflare yang akan memiliki proyek Pages dan akses ke repositori GitHub tersebut.
- Proyek Supabase yang akan digunakan, termasuk persetujuan paket Pro pada akun pemilik.
- Akses privat ke ekspor database sumber atau metode ekspor yang tersedia bagi administrator aplikasi.
- Domain tujuan jika pengguna ingin memakai domain khusus. URL pratinjau Pages dapat digunakan selama pengujian.

Koneksi Supabase melalui ChatGPT memungkinkan pemeriksaan proyek dan migrasi melalui integrasi yang tersedia. Informasi rahasia dimasukkan melalui mekanisme autentikasi atau secret layanan yang sesuai.
