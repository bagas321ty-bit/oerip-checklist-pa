# Checklist Laporan Harian PA · Oerip Indonesia

Aplikasi web untuk mencentang tugas harian per divisi. Halaman dipasang di GitHub Pages;
data tugas disimpan di Supabase dan hanya bisa dibuka oleh akun yang terdaftar.

Hak akses yang dipakai: CEO = admin; Vice CEO dan Personal Assistant = edit; Finance dan HRO = lihat.

## Isi folder

| File | Fungsi |
| --- | --- |
| `index.html` | Halaman aplikasi |
| `app.js` | Logika aplikasi |
| `config.js` | Alamat dan kunci Supabase (diisi saat pemasangan) |
| `schema.sql` | Tabel database dan aturan akses (dijalankan sekali di Supabase) |

## Cara pakai harian

- **Admin (CEO):** buka menu **Kelola anggota**, isi nama, email, dan hak akses karyawan, lalu klik **Simpan anggota**.
- **Karyawan:** buka aplikasi, klik **Belum punya kata sandi? Buat akun**, isi email yang didaftarkan dan buat kata sandi.
  Klik link konfirmasi di email (sekali saja), lalu masuk.

## Pemasangan ulang dari nol (hanya bila perlu)

### 1. Buat database di Supabase
1. Buka https://supabase.com, daftar, lalu **New project** (pilih region Singapore).
2. Buka **SQL Editor → New query**.
3. Di bagian 7 `schema.sql`, pastikan email admin benar.
4. Tempel seluruh isi `schema.sql`, lalu klik **Run**.

### 2. Atur alamat aplikasi
Di **Authentication → URL Configuration**, isi **Site URL** dengan alamat aplikasi di GitHub Pages,
supaya link konfirmasi email membuka aplikasi.

### 3. Sambungkan aplikasi
1. Buka **Project Settings → API**.
2. Salin **Project URL** dan **anon public key** ke `config.js`.

### 4. Pasang di GitHub Pages
1. Upload keempat file ke repository GitHub.
2. Buka **Settings → Pages → Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, lalu **Save**.
3. Setelah 1–2 menit, aplikasi bisa dibuka di `https://<username>.github.io/<nama-repo>/`.

## Hak akses
| Peran | Bisa apa |
| --- | --- |
| admin | Semua, termasuk menu Kelola anggota |
| edit | Tambah, centang, ubah status, catatan, hapus tugas |
| lihat | Melihat checklist dan rekap mingguan |

## Keamanan
- Kunci `anon` di `config.js` memang dirancang boleh terlihat publik. Data tetap terkunci oleh aturan
  akses di database: tanpa login dan tanpa terdaftar di tabel `members`, tidak ada data yang bisa dibaca.
- Nama pengubah dan jam ubah diisi oleh server, bukan oleh browser, jadi tidak bisa dipalsukan.
- Paket gratis Supabase menghentikan sementara proyek yang tidak dipakai selama 7 hari. Selama checklist
  dibuka setiap hari kerja, ini tidak akan terjadi.
