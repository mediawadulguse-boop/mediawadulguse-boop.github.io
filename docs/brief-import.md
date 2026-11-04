# Impor Brief Excel

Tersedia di **Brief Konten → Impor Excel** bagi akun dengan izin `brief.create`.
Tombol **Template Brief** tersedia di halaman yang sama dan di dialog impor.

## Template

Unduh [Template_Impor_Brief.xlsx](../templates/Template_Impor_Brief.xlsx).

- Isi sheet **BRIEF** mulai baris 2. **CONTOH** dan **PANDUAN** tidak diimpor.
- Kolom wajib: `tanggal`, `judul`, `detail_brief`.
- Batas: 100 brief / 8 MB per impor. Format `.xlsx`, `.xls`, dan `.csv`.
- Tanggal menerima sel tanggal Excel, `DD/MM/YYYY`, atau `YYYY-MM-DD`; kalender 1904 juga didukung.
- `deadline` kosong mengikuti tanggal tayang. Target kosong mengikuti pengaturan kategori aplikasi; nilai `0` tetap nol.
- Semua brief baru berstatus **Draft**, dengan approval **Draft**.
- `petugas` menerima nama lengkap, username, atau ID akun aktif. Pisahkan beberapa petugas dengan `;`.
- `jobdesk` menerima beberapa jobdesk per petugas, dipisahkan koma. Antarpetugas dipisahkan `;`, sesuai urutan kolom petugas.
- Contoh: petugas `Fathurrohman; Fahmi Ilham Pahwana`, jobdesk `Desainer; Videografer, Editor`.
- Tanpa penugasan, kosongkan `petugas` dan `jobdesk`. Staf resign ditolak.
- Pisahkan beberapa audience dan peralatan dengan `;`. Audience tambahan dimasukkan dalam `custom_audience`.

## Pemeriksaan dan penyimpanan

Pratinjau menampilkan semua baris, kesalahan, peringatan deadline, dan duplikat.
Baris valid dapat diimpor sambil melewati baris bermasalah dan duplikat. Perbaiki
baris yang tersisa dalam Excel, kemudian unggah ulang. Kolom tidak dikenal dan
kolom tanpa judul ditolak supaya isi file tidak hilang tanpa pemberitahuan.

Duplikat diperiksa berdasarkan tanggal tayang dan judul yang dinormalisasi,
termasuk arsip, isi file yang sama, dan ID impor yang pernah dibuat. ID impor
tetap sama ketika file diunggah ulang. Impor tidak dimaksudkan untuk mengedit
brief yang sudah ada.

Impor memakai antrean CRUD bersama yang sudah ada. Antrean disimpan di perangkat
sebelum dianggap diterima dan disinkronkan melalui batch server yang sudah
tersedia. Status **menunggu sinkronisasi** terpisah dari **tersimpan**. Penugasan
dibentuk oleh sinkronisasi relasi Brief → Tugas, menggunakan mekanisme aplikasi
yang sama. Penolakan server pada penugasan ditampilkan terpisah agar brief tidak
dianggap selesai ketika tugasnya belum tersimpan. Tombol coba ulang dapat
mengantrekan ulang penugasan tersebut.

Hasil pemeriksaan dapat diunduh sebagai CSV. Data yang sudah diterima antrean
tetap disinkronkan setelah dialog ditutup. Ringkasan dialog berlaku untuk sesi
halaman yang sedang dibuka; setelah reload, status tersimpan dan antrean dapat
dilihat pada daftar Brief dan indikator sinkronisasi aplikasi.

Tidak diperlukan perubahan atau deployment ulang Google Apps Script pada
kontrak backend v1.31.5 yang diperiksa. Pembaca Excel SheetJS 0.20.3 dimuat saat
dibutuhkan, sama dengan impor Hot Issue. Jika pemuat Excel gagal, format CSV
tetap tersedia.

## Validasi

```sh
node --test tests/brief-import.test.cjs tests/staff-roster.test.cjs
```

Pengujian integrasi lokal juga mencakup input campuran, penugasan otomatis,
impor ulang, kegagalan kapasitas/penyimpanan antrean, isolasi izin, escaping isi
file, dan pembacaan XLSX asli dari template. Pengujian tidak menulis ke data
produksi.
