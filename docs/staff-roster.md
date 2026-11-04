# Jadwal Siaga / Off dan status staf

Fitur tersedia mulai versi 1.32.0. Buka **Kalender → Siaga / Off** dengan akun pengelola.

- **Pola Mingguan** mengatur Siaga / Off per staf untuk setiap hari. Pilihan “—” berarti belum diatur; aplikasi tidak membuat jadwal awal secara otomatis.
- **Atur Tanggal** menerapkan perubahan untuk satu tanggal atau rentang tanggal, staf terpilih, jam siaga WIB, dan catatan opsional. Perubahan khusus tanggal memiliki prioritas atas pola mingguan.
- Pilih **Ikuti Pola Mingguan** untuk menghapus perubahan khusus pada tanggal dan staf yang dipilih.
- Klik tanggal untuk melihat seluruh staf beserta jam dan catatannya. Filter staf dan status tersedia di atas kalender.
- **Akun → Edit → Status Staf** menyediakan Aktif / Resign dan tanggal resign. Jadwal sebelum tanggal resign serta data tugas dan brief tetap disimpan. Akun dapat diaktifkan kembali.

## Akses

Tab jadwal mengikuti izin `settings.view`, dan perubahan memerlukan `settings.edit`. Perubahan status staf juga memerlukan `account.manage_permissions`. Kalender Brief / Tugas dan kalender publik tetap menggunakan izin yang sudah ada. Akun staf biasa tidak menerima isi pengaturan sistem.

Pilihan petugas oleh pengelola menggunakan akun aktif. Petugas resign yang sudah tercatat pada brief atau tugas tetap tersedia ketika penugasan lama diedit. Filter riwayat tetap mencakup nama staf lama.

Status kepegawaian adalah informasi administrasi. Pencabutan akses login dan sesi tidak termasuk perubahan ini.

## Penyimpanan dan kompatibilitas

Pola mingguan, pengecualian tanggal, dan status staf disimpan sebagai objek `staff_roster` pada `SYSTEM_SETTINGS`, melalui aksi `getSystemSettings` / `saveSystemSettings` yang sudah tersedia. Tidak diperlukan kolom baru pada `AKUN`. Kontrak penyimpanan telah diperiksa terhadap sumber Apps Script v1.31.5.

Sebelum menyimpan, aplikasi membaca pengaturan terbaru, menerapkan perubahan, lalu membaca ulang hasilnya dan mencocokkan `write_id`. Kegagalan koneksi, izin, atau konfirmasi penyimpanan ditampilkan sebagai galat; antarmuka tidak melaporkan perubahan tersebut sebagai berhasil. Perubahan pola mingguan hanya menimpa hari yang diubah, dan konflik pada hari yang sama meminta pengguna memuat ulang.

Rentang maksimal 366 hari per operasi. Ukuran JSON dibatasi 45.000 karakter sebelum dikirim agar sesuai kapasitas sel pengaturan. Gunakan pola mingguan untuk jadwal rutin dan pengecualian untuk perubahan khusus.

## Validasi

Jalankan pengujian logika tanpa dependensi tambahan:

```sh
node --test tests/staff-roster.test.cjs
```

Pengujian mencakup prioritas jadwal, tanggal kabisat, rentang tanggal, jam lintas malam, riwayat resign dan aktivasi kembali, izin, koneksi terputus, kegagalan konfirmasi, batas penyimpanan, dan perubahan bersamaan pada pola mingguan.

Integrasi DOM aplikasi telah diuji dalam mode demo untuk kalender, formulir jadwal, penyimpanan ulang, status akun, penugasan lama, pergantian akun, dan isolasi kalender publik. Pengujian ini tidak menggunakan sesi atau data produksi.
