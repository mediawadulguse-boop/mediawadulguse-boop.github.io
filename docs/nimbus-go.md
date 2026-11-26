# Instalasi MEDIA WADUL GUS’E pada Nimbus Go

Target Gus: aplikasi dan database di DomaiNesia. Paket hosting belum dibeli. Perubahan ini menyiapkan runtime, konversi data, backup, pengujian dan deployment GitHub. Belum ada server, domain, data produksi atau DNS yang dipindahkan.

## Bentuk aplikasi

| Bagian | Penempatan |
|---|---|
| Tampilan CMS, editor, template dan pembaca PDF | `public/` dalam rilis aplikasi |
| Login, hak akses, CRUD, sinkronisasi dan AI | Node.js 22 atau lebih baru |
| Akun, brief, tugas, Hot Issue, rapat, HTML, insight dan pengaturan | PostgreSQL di akun hosting |
| Konfigurasi rahasia | `shared/.env` di luar direktori publik |
| Backup | `shared/storage/backups/`, di luar direktori publik |
| Kode dan deployment | Repository GitHub yang sama, GitHub Actions melalui SSH |

Build Nimbus menggunakan `/api` pada domain yang sama. Build asli untuk GitHub Pages tidak diubah. Google Apps Script dan Google Sheets tidak menjadi backend utama pada build Nimbus. Integrasi lain yang sebelumnya berada pada project terpisah perlu dipasangkan ulang.

DomaiNesia mencantumkan Node.js, SSH, Git dan PostgreSQL untuk layanan hostingnya. Setelah akun aktif, pastikan versi Node.js, akses PostgreSQL lokal dan pengaturan startup aplikasi pada akun yang dibeli sebelum mengaktifkan deployment.

- [Spesifikasi resmi](https://www.domainesia.com/hosting/)
- [Panduan Node.js](https://www.domainesia.com/panduan/cara-install-nodejs-di-hosting/)
- [Panduan SSH](https://www.domainesia.com/panduan/cara-akses-ssh-di-cpanel-hosting/)

## Persiapan setelah pembelian

1. Tentukan domain/subdomain CMS. Aplikasi ini dipasang pada root domain/subdomain, bukan subfolder URL.
2. Aktifkan HTTPS. Buat database PostgreSQL baru dan pengguna yang memiliki akses ke database tersebut.
3. Aktifkan lingkungan Node.js 22/24 melalui panel. Catat direktori `bin` Node dan informasi SSH resmi, termasuk port sebenarnya.
4. Buat direktori aplikasi privat, misalnya `/home/USER/mwg-cms`. Gunakan `Application root` ini dan `Application startup file` `app.js` pada pengaturan aplikasi Node.
5. Isi `shared/.env` dari `nimbus-server/.env.example`; set permission `600`. `DATABASE_URL` menggunakan database lokal akun hosting. Encode karakter khusus password pada URL. `PUBLIC_URL` adalah origin HTTPS CMS, misalnya `https://cms.example.com`.
6. API key Gemini diisi lewat pengaturan aplikasi atau environment privat setelah instalasi. Pengaturan koneksi dan kuota provider perlu diuji kembali.

Tidak perlu menaruh password cPanel, database, API key atau file ekspor data pada repository.

## Ekspor data lama

Tambahkan isi `backend/export-nimbus.gs` pada project Apps Script database lama, lalu jalankan `exportForNimbus()` dari editor sebagai pemilik database. Fungsi membuat JSON privat di Google Drive dan tidak mengubah data asal. Unduh hasilnya lewat akun pemilik.

Ekspor mencakup semua sheet, ID, pengaturan staf dan dokumen HTML dari Drive. Jika fungsi konektor lama tersedia, spreadsheet Social Listening juga diekspor dengan awalan `LISTENING__`. Data cluster, digest dan arsip mentah disimpan di PostgreSQL. Log teknis tanpa ID mendapat ID internal; ID sumber Listening tetap dipertahankan sebagai `cluster_id`/`legacy_id`.

Manifest memuat jumlah baris dan checksum per sheet. Jika `html_errors` atau `external_errors` tidak kosong, perbaiki akses yang disebut dan ekspor ulang. Semua file HTML wajib ikut agar migrasi selesai. Jika Social Listening memang tidak dipakai, operator dapat memanggil `exportForNimbus({includeListening:false})` secara eksplisit.

File ekspor memuat password lama untuk dikonversi. Simpan secara privat; jangan unggah ke GitHub atau direktori publik. API key Gemini dan koneksi pada Script Properties tidak ikut diekspor; isi kembali di hosting.

## Instalasi pertama dan impor

Di komputer pengembang atau runner GitHub:

```bash
npm ci --ignore-scripts
npm ci --prefix nimbus-server --ignore-scripts
npm test
npm run test:integration
npm run test:nimbus
npm run build:nimbus
tar -czf mwg-nimbus.tar.gz -C dist/nimbus .
```

Unggah paket melalui SFTP/File Manager ke area privat. Ekstrak ke `/home/USER/mwg-cms/releases/initial`. Aset publik tidak boleh dicampur dengan file server di `public_html`. Aplikasi Node menyajikan hanya folder `public/` melalui URL aplikasi.

Aktifkan lingkungan Node dari perintah yang diberikan panel. Sesuaikan `USER` dan semua path dengan akun sebenarnya:

```bash
cd /home/USER/mwg-cms/releases/initial
ln -s /home/USER/mwg-cms/shared/.env .env
ln -s /home/USER/mwg-cms/shared/storage storage
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
node scripts/admin.cjs migrate
node scripts/admin.cjs verify /home/USER/private/MWG_NIMBUS_EXPORT.json
node scripts/admin.cjs import /home/USER/private/MWG_NIMBUS_EXPORT.json
```

`verify` menolak checksum berbeda, ID/username ganda, sheet berisi data yang belum dipetakan, HTML yang belum ikut, serta relasi yatim. Selesaikan masalah data asal sebelum ekspor ulang. `--allow-orphans` hanya untuk operator yang sudah meninjau laporan dan memilih mempertahankan relasi lama yang rusak; opsi ini tidak menghapus baris.

`import` hanya bekerja pada database kosong. Seluruh penulisan dalam satu transaksi. ID dan password lama dipertahankan untuk login, tetapi password disimpan sebagai hash scrypt. Password baru minimal delapan karakter. Jumlah hasil impor diverifikasi sebelum transaksi selesai.

Jika ini instalasi tanpa data lama, gunakan `bootstrap FILE.json` dengan file privat berisi `username`, `nama`, `password`. Jangan menjalankan bootstrap sebelum impor data lama karena database harus kosong.

Setelah impor, buat symlink `current` menuju direktori `releases/initial`. Buat `/home/USER/mwg-cms/app.js` dengan isi:

```js
'use strict';
require('./current/app.js');
```

Restart aplikasi melalui panel. Simpan versi awal yang sudah lolos uji sebagai jalur pemulihan sebelum deployment otomatis pertama.

## Verifikasi sebelum pengalihan

- `/healthz` merespons JSON dengan `ok: true`, `backend: nimbus` dan revision rilis.
- Login administrator, analis dan staf. Uji hak akses masing-masing, termasuk pembatasan tugas milik sendiri.
- Cocokkan jumlah akun, brief, tugas, Hot Issue, rapat, dokumen dan insight dengan manifest.
- Buka data lama, termasuk teks panjang, tautan publikasi dan HTML. Link publik HTML pada domain baru memakai tanda tangan; link Apps Script lama tidak otomatis berubah.
- Uji membuat, mengedit, mengarsipkan dan menghapus data contoh; uji koneksi terputus dan pengiriman ulang.
- Periksa On hijau, Siaga kuning, Off merah; pastikan staf resign hilang dari pilihan baru dan riwayatnya tetap terbaca.
- Uji impor brief Excel dengan status/kategori dan impor Hot Issue PDF/Excel menggunakan salinan data contoh.
- Uji backup dan restore ke database uji yang berbeda.

Jadwalkan jeda perubahan pada aplikasi lama saat ekspor final. Jika data lama berubah setelah ekspor latihan, ekspor ulang dan impor ke database baru yang kosong. Alihkan domain/tim setelah seluruh pemeriksaan berhasil. Data lama tetap disimpan sampai data dan backup baru benar-benar terverifikasi.

## GitHub otomatis

Workflow `.github/workflows/nimbus.yml` menjalankan pengujian pada pull request. Deployment hanya berjalan pada `main` setelah variabel repository `NIMBUS_DEPLOY_ENABLED` diisi `true`.

Buat environment GitHub `nimbus-production`. Isi secrets berikut melalui GitHub Settings, dengan kunci SSH khusus akun deployment:

| Secret | Isi |
|---|---|
| `NIMBUS_SSH_HOST` | Host SSH resmi akun |
| `NIMBUS_SSH_USER` | Username SSH |
| `NIMBUS_SSH_PORT` | Port SSH sebenarnya |
| `NIMBUS_SSH_PRIVATE_KEY` | Private key khusus deployment |
| `NIMBUS_SSH_KNOWN_HOSTS` | Host key SSH yang sudah diverifikasi dari sumber terpercaya |

Isi repository variables `NIMBUS_APP_ROOT` dengan `/home/USER/mwg-cms` dan `NIMBUS_NODE_BIN` dengan direktori absolut yang berisi `node` dan `npm` dari lingkungan panel. Jangan menaruh password database pada Actions; database dibaca dari `shared/.env` di hosting.

Deployment membangun aset, memverifikasi checksum rilis, memasang dependency produksi, membuat backup database, menjalankan schema yang bersifat tambahan, mengganti symlink rilis, dan memeriksa revision lewat HTTPS. Jika pemeriksaan gagal, rilis sebelumnya diaktifkan kembali. Data database tidak ditimpa oleh rollback kode. Hosting, SSH, startup/restart panel dan HTTPS baru bisa dibuktikan setelah akun aktif.

## Backup, worker dan perawatan

Jalankan dari direktori `current` dengan binary Node yang benar:

```bash
node scripts/admin.cjs backup
node scripts/worker.cjs
node scripts/admin.cjs maintenance
```

Pasang cron worker setiap menit dan gunakan `flock` agar eksekusi tidak menumpuk. Worker memproses antrean AI persisten; API juga memicunya saat data baru disimpan. Pasang backup harian dan maintenance harian. `maintenance` membersihkan sesi kedaluwarsa, receipt/sync log lebih dari 30 hari, serta request screenshot lama. Riwayat konten tidak dibersihkan oleh perintah ini.

Backup menghasilkan `.json.gz` dan `.sha256`, permission `600`, lalu membacanya ulang untuk verifikasi. Simpan salinan backup di lokasi terpisah dari akun hosting. Restore hanya ke database kosong:

```bash
node scripts/admin.cjs restore /home/USER/private/BACKUP-ID.json.gz
```

File migrasi/backup JSON dibatasi 128 MB agar penggunaan memori terkontrol. Untuk database lebih besar, gunakan backup PostgreSQL native (`pg_dump`) dan restore teruji, bukan menambah batas memori tanpa pemeriksaan. Pantau penggunaan disk dan simpan arsip lama di lokasi terpisah.

## Hal yang masih perlu diuji pada akun nyata

Pengujian otomatis memakai data sintetis, PostgreSQL kompatibel melalui PGlite, dan DOM aplikasi. Pengujian tidak membuktikan versi PostgreSQL, batas resource, outbound Gemini, jalur restart dan koneksi SSH pada akun yang belum dibeli. Uji ketahanan dan beban pada database PostgreSQL hosting sebelum produksi.

Perhitungan ulang nilai Insight A–E masih perlu disamakan dengan backend produksi. Salinan kode Apps Script yang tersedia memanggil `calculateInsightScore_`, tetapi tidak memuat definisinya. Nilai historis ikut diimpor; snapshot baru menyimpan metrik dan memperbarui total jangkauan, dengan nilai `-` sampai rumus asli berhasil diverifikasi. Finalisasi bagian ini sebelum pengalihan produksi.

Dashboard Social Listening, kurasi manual, dan konversi ke Hot Issue menggunakan PostgreSQL. Collector otomatis yang sebelumnya berjalan di project terpisah memerlukan konektor yang sesuai `LISTENING_API_URL`/`LISTENING_API_TOKEN`; ketersediaan konektor ini belum dibuktikan. Gateway WhatsApp terpisah perlu dipasangkan ulang, dan Google Calendar belum merupakan konektor aktif. Tidak ada hasil AI simulasi pada backend Nimbus: bila provider belum dikonfigurasi, fitur memberikan status konfigurasi atau error.
