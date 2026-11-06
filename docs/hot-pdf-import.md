# Impor PDF Hot Issue

Menu **Hot Issue → Impor PDF/Excel/CSV** menerima PDF laporan monitoring berteks dengan kartu bernomor dalam dua kolom. Setiap kartu berisi judul, sumber/akun, label sentimen, deskripsi, dan tautan. PDF hasil pindai/foto dan tata letak lain ditolak dengan pesan yang jelas; tidak ada OCR atau pengisian isi yang hilang.

PDF dibaca di browser dengan PDF.js 5.6.205 yang disimpan di `vendor/pdfjs-5.6.205/`. Modul dan worker dimuat hanya saat memilih PDF. File asli tidak dikirim ke server. Ukuran maksimal 8 MB, 100 halaman, 500 kartu. Tautan annotation lengkap didahulukan atas teks tautan yang terpotong. Kutipan deskripsi tetap sesuai PDF dan diberi catatan pada pratinjau.

Pengguna memilih bagian Hot Issue, Sentimen Negatif, atau seluruh mention; bagian Hot Issue dipilih secara default. Tanggal mengikuti periode monitoring pada sampul, dapat diubah, dan tetap mengikuti tanggal pilihan saat disimpan. Jika periode tidak terbaca, tanggal awal adalah hari ini. Pengguna dapat memilih kartu dan membuka deskripsinya sebelum impor.

Komentar berbeda dengan URL postingan sama tetap disimpan. Duplikat PDF diperiksa berdasarkan tanggal, judul, dan akun pada data yang telah tersedia di perangkat serta file yang dipilih. Server `bulkImportHotIssues` lama menyamakan URL sebagai duplikat, sehingga PDF menggunakan antrean `saveHotIssue` yang sudah tersedia. Ini tidak memerlukan perubahan GS. Antrean idempoten per request bertahan ketika halaman dimuat ulang dan diproses melalui transport CRUD yang sudah ada. Kapasitas bersama 200 perubahan; pengguna diminta mengurangi pilihan atau menunggu jika kapasitas tersisa tidak cukup. Excel/CSV tetap menggunakan endpoint massal sebelumnya.

Laporan membedakan isu yang diterima perangkat, menunggu sinkron, berhasil disimpan server, dan gagal. Status AI mengikuti antrean backend setelah penyimpanan. Laporan CSV dapat diunduh. Tidak ada data laporan monitoring pribadi yang dimasukkan ke repositori; tes menggunakan kartu sintetis.

Validasi: `npm test`, `node tests/hot-pdf.integration.cjs`, dan integrasi yang sudah ada. File PDF pengguna diuji secara lokal tanpa menyalin dokumen atau isi laporan menjadi fixture publik.
