# Optimasi v1.34.0

## Perilaku aplikasi

- Semua pilihan penugasan dan filter memakai staf aktif. Parameter untuk memasukkan kembali staf resign ke pilihan sudah dihapus.
- Riwayat penugasan lama tetap tersimpan. Saat mengedit, nama lama ditampilkan sebagai keterangan di luar pilihan. Pengguna dapat mempertahankan penugasan atau memilih pengganti aktif.
- Konfirmasi tambahan pada tombol simpan dihilangkan. Validasi formulir dan konfirmasi hapus tetap berlaku.
- Editor yang sudah memiliki daftar staf dan status tersimpan langsung terbuka. Pembacaan ulang berjalan di belakang. Pembukaan pertama tetap menunggu data yang diperlukan agar pilihan tidak menggunakan data kosong.
- Status akun mempunyai antrean tersimpan di perangkat, terpisah per pengguna dan endpoint. Perubahan langsung memengaruhi pilihan staf; label menunggu sinkronisasi tetap tampil sampai server terverifikasi. Antrean diteruskan setelah reload atau jaringan kembali.
- Mengubah status saja tidak lagi mengirim ulang seluruh data akun dan hak aksesnya.
- Simpan Brief dan Tugas memeriksa bahwa antrean perangkat sudah diterima sebelum menutup formulir. Tugas relasi Brief diantrekan setelah konfirmasi utama agar tidak dikirim dua kali.
- Render dari beberapa konfirmasi digabung menjadi satu pembaruan per frame. Mengubah satu koleksi hanya membangun ulang indeks koleksi tersebut.
- Permintaan baca yang identik dan sedang berjalan memakai satu request bersama. Penyegaran izin tidak merender ulang halaman bila izin tidak berubah.

## Aset halaman

Kode utama dan gaya dipindahkan dari HTML menjadi `app.js` dan `app.css` tanpa mengubah urutan eksekusi. HTML awal turun dari 988.697 byte menjadi sekitar 6 KB. Ukuran ini adalah ukuran HTML, bukan seluruh aplikasi. Berkas aplikasi dapat memakai cache browser dan service worker sehingga kunjungan berikutnya tidak mengunduh seluruh kode bersama HTML.

Service worker memasang cache shell lengkap sebelum mengaktifkan versi baru. Antrean data, sesi, dan IndexedDB tidak dibersihkan saat pembaruan.

## Pembaruan GS yang diperlukan untuk Analis/Staf

Backend v1.31.5 tidak mengirim status ke akun tanpa `settings.view`. Frontend sudah membaca `status_staf`, `tanggal_resign`, dan `status_staf_updated_at` dari direktori akun. Agar semua role menerima status ini, GS perlu diperbarui dan deployment Web App yang sama perlu diterbitkan sebagai versi baru.

File GS lengkap v1.34.0 disiapkan terpisah dari konfigurasi publik repositori. File tersebut berbasis sumber v1.31.5 yang tersedia dalam pekerjaan ini. Bila sumber GS produksi telah diubah setelah versi tersebut, gunakan patch terbatas berikut untuk mempertahankan perubahan produksi lainnya:

1. Ganti dua fungsi `getReferencePackV1210_` dan `sanitizeAccountV122_` dengan versi dalam [staff-directory-v1.34.gs](../backend/staff-directory-v1.34.gs). Tambahkan helper `staffDirectoryStatusV134_` dan variabel cache eksekusinya satu kali.
2. Dalam `saveSystemSettings_`, sebelum invalidasi cache `SYSTEM_SETTINGS`, tambahkan:

```js
if (key === 'staff_roster') {
  STAFF_DIRECTORY_EXEC_V134_ = settings || {};
  touchModuleRevision_('accounts');
  recordSimpleCrudSyncV122_('saveAccount', {}, {});
}
```

3. Simpan dan perbarui deployment Web App yang sudah digunakan aplikasi. URL deployment tetap sama.

Patch hanya mengirim status administratif minimum. Hak akses password, nomor kontak, dan pengaturan lainnya tetap mengikuti izin sebelumnya. Staf biasa menerima entri akunnya sendiri, bukan seluruh direktori.

Publikasi frontend tidak otomatis memperbarui deployment Google Apps Script. Tidak ada perubahan yang ditulis ke data produksi selama pengujian lokal.

## Pengujian

```sh
npm install
npm test
npm run test:integration
```

Pengujian mencakup validasi impor, status dan outbox, direktori backend, penyimpanan offline, penugasan historis, pembukaan editor tanpa menunggu request lambat, serta pemisahan indeks koleksi.
