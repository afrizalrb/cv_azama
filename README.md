# Sistem Informasi CV Azama Sejahtera

Sistem internal untuk produsen air demineral di Malang. Menggantikan
pencatatan manual di Excel. Masalah paling mendesak yang diselesaikan:
**piutang tidak terpantau** — seluruh customer bertempo 14–30 hari, tapi
selama ini tidak ada satu pun pencatatan pembayaran.

Status saat ini: **Fase 0 selesai** (fondasi + migrasi data). Lihat
[Peta fase](#peta-fase) di bagian bawah.

---

## Cara kerjanya

```
Peramban staf
     │  POST { action, token, payload }   Content-Type: text/plain
     ▼
GitHub Pages ──────────► Apps Script Web App ──────────► Google Sheets
(frontend statis)         (seluruh logika bisnis)         (database)
```

Tiga hal yang menentukan bentuk sistem ini:

**Frontend tidak dipercaya.** Seluruh perhitungan uang, stok, saldo galon,
dan pemeriksaan hak akses dikerjakan di Apps Script. Frontend hanya
menampilkan dan mengirim. Menyembunyikan menu hanya membuat tampilan rapi —
siapa pun bisa memanggil endpoint langsung tanpa lewat antarmuka.

**Sheets bukan basis data.** Tidak ada foreign key, tidak ada transaksi.
Karena itu setiap validasi referensial ditulis manual, dan setiap operasi
tulis dibungkus `LockService`.

**Stok adalah buku besar yang hanya bertambah.** Tidak pernah ada kolom
"stok akhir" yang ditimpa. Stok saat ini = `SUM(qty)` dari `stock_movements`.
Berlaku sama untuk saldo galon. Dengan begitu setiap angka selalu bisa
ditelusuri asalnya.

---

## Apps Script dan Git tidak terhubung

Ini titik yang paling sering membingungkan, jadi ditulis di depan.

`clasp` dan `git` **tidak saling tahu sama sekali**. Keduanya kebetulan
bekerja di folder yang sama, itu saja.

```
             folder apps-script/ di komputer Anda
                    ╱                  ╲
          git push ╱                    ╲ clasp push
                  ▼                      ▼
             GitHub                  Google Apps Script
          (arsip kode)              (yang benar-benar jalan)
```

Konsekuensinya:

- `git push` **tidak** memperbarui sistem yang berjalan.
- `clasp push` **tidak** menyimpan apa pun ke GitHub.
- Setiap perubahan kode backend perlu keduanya.

Ada satu jebakan lagi yang lebih halus: **`clasp push` pun belum membuat
kode baru aktif.** Kode sudah naik ke Google, tapi URL `/exec` masih
menyajikan versi lama sampai Anda membuat *versi deployment* baru. Ini
penyebab tersering gejala "sudah saya ubah tapi tidak ada bedanya".
Prosedur lengkapnya ada di [Memperbarui backend](#memperbarui-backend).

Berkas `.clasp.json` adalah jembatan lokal antara folder ini dan proyek
Apps Script Anda. Berkas itu berisi Script ID, dan bersama `.clasprc.json`
(token OAuth Google) **wajib** masuk `.gitignore`. Keduanya sudah ada di
sana.

---

## Struktur repo

```
cv_azama/
├── apps-script/            Backend. Diunggah ke Google lewat clasp.
│   ├── appsscript.json     Manifest: zona waktu, mode akses web app
│   ├── Sheets.gs           Satu-satunya lapisan yang menyentuh Spreadsheet.
│   │                       Berisi SKEMA seluruh tab, helper baca/tulis,
│   │                       LockService, penomoran ID, audit log.
│   ├── Auth.gs             Hash password, token HMAC, penegakan role
│   ├── Sales.gs            sales.create/list/get/cancel — validasi di depan,
│   │                       penulisan di belakang, rollback bila gagal
│   ├── Master.gs           Produk, customer, harga khusus
│   ├── Setup.gs            Fungsi sekali jalan: buat tab, verifikasi data
│   └── Code.gs             Router doPost — tabel rute dan penegakan akses
│
├── frontend/               React + Vite + Tailwind, tayang di GitHub Pages
│   ├── src/lib/api.js      Pembungkus fetch, penanganan error
│   ├── src/lib/auth.js     Penyimpanan sesi di sessionStorage
│   ├── src/lib/format.js   Rupiah dan tanggal berbahasa Indonesia
│   ├── src/lib/hooks.js    useMuat dan useKirim
│   ├── src/components/     Shell (menu samping) dan komponen bersama
│   ├── src/pages/          Login, SalesList, SalesEntry, SalesDetail,
│   │                       Masters, Akun
│   ├── vite.config.js      base: '/cv_azama/'  ← harus sama dengan nama repo
│   └── postcss.config.js   Penghenti pencarian konfigurasi PostCSS
│
├── scripts/
│   ├── migrate_excel.py    Migrasi sekali jalan: xlsx → CSV per tab
│   ├── generate_seeder.cjs CSV → data/Seed.gs, pengisi data tanpa dialog impor
│   ├── lib/harness.cjs     Tiruan SpreadsheetApp, Utilities, LockService
│   ├── local_test.cjs      Uji Apps Script di komputer, tanpa akun Google
│   └── local_server.cjs    Sajikan backend lewat HTTP lokal untuk dev
│
├── .github/workflows/
│   └── deploy.yml          Build frontend → GitHub Pages
│
└── data/                   TIDAK ter-commit. Excel sumber, CSV, kredensial.
```

---

## Menjalankan di komputer sendiri

Bagian ini tidak memerlukan akun Google sama sekali. Kerjakan ini lebih dulu
sebelum menyentuh Google.

**Prasyarat:** Node 20+, Python 3.8+, Git.

### 1. Migrasi data Excel

Letakkan berkas Excel sumber di `data/`:

```bash
py -m pip install openpyxl
py scripts/migrate_excel.py
```

Menghasilkan satu CSV per tab di `data/csv/`, plus ringkasan baris masuk,
baris dilewati beserta alasannya, dan daftar hal yang perlu diisi manual.

Skrip juga mencetak **password awal seluruh user** dan menyimpannya di
`data/csv/KREDENSIAL_AWAL.txt`. Yang masuk ke `users.csv` hanya hash-nya —
password polos tidak bisa dipulihkan dari sana. Hapus berkas kredensial itu
setelah semua orang mengganti passwordnya.

### 2. Uji backend tanpa Google

```bash
node scripts/local_test.cjs
```

Harness ini menyediakan tiruan `SpreadsheetApp`, `Utilities`, `LockService`,
dan `PropertiesService` di memori, lalu memuat berkas `.gs` apa adanya dan
menjalankan `doPost` sungguhan terhadap data hasil migrasi.

Yang diuji: penanganan rute, login, pemalsuan token, kedaluwarsa token,
penegakan role, dan integritas referensial seluruh data migrasi.

Yang **tidak** bisa diuji di sini: perilaku kuota Apps Script, penguncian
antar eksekusi bersamaan, dan cara Google Sheets diam-diam mengubah tipe
kolom saat impor CSV. Tiga hal itu hanya muncul di lingkungan aslinya.

### 3. Jalankan backend tiruan

```bash
node scripts/local_server.cjs
```

Menyajikan berkas `.gs` yang sama persis dengan yang nanti diunggah ke Google,
lewat `http://localhost:8787`. Keadaan datanya disimpan di
`data/local_state/`, terpisah dari hasil migrasi yang asli. Hapus folder itu
untuk kembali ke data awal.

Server ini juga meniru perilaku CORS Apps Script, dan sengaja **mencetak
peringatan** kalau ada permintaan preflight `OPTIONS` masuk. Apps Script
sesungguhnya tidak melayani `OPTIONS`, jadi preflight di lokal berarti
sesuatu akan gagal di lingkungan asli — lebih baik ketahuan sekarang.

### 4. Jalankan frontend

```bash
cd frontend
cp .env.example .env.local     # lalu isi VITE_API_URL=http://localhost:8787
npm install
npm run dev
```

Buka `http://localhost:5173` dan kerjakan keempat langkah di halaman Cek
Koneksi. Kalau langkah 4 menampilkan total omzet **Rp 49.020.000**, seluruh
rantai sudah tersambung benar — dan itu semua tanpa menyentuh akun Google.

Setelah deploy ke Google nanti, cukup ganti isi `.env.local` dengan URL
`/exec` sungguhan.

---

## Deploy pertama kali

### Tahap 1 — Spreadsheet

1. Buka `drive.google.com` → Baru → Google Spreadsheet
2. Beri nama `DB_AZAMA_PRODUCTION`
3. Salin **Spreadsheet ID** dari URL:

```
https://docs.google.com/spreadsheets/d/1AbCdEfGh...XyZ/edit
                                      └──────┬──────┘
                                     ini Spreadsheet ID
```

Simpan di catatan pribadi. **Jangan pernah ditulis di berkas dalam repo.**

Buat juga `DB_AZAMA_SANDBOX` untuk uji coba. Anda akan berterima kasih pada
diri sendiri saat pertama kali menguji fungsi pembatalan penjualan.

### Tahap 2 — Proyek Apps Script

Aktifkan dulu Apps Script API di
`https://script.google.com/home/usersettings`. Tanpa ini, `clasp push`
akan ditolak.

```bash
npm install -g @google/clasp
clasp login

cd apps-script
clasp create-script --type webapp --title "AZAMA_API" --rootDir .
```

> Perintah di atas untuk clasp v3. Kalau Anda memakai v2, namanya
> `clasp create`. Cek dengan `clasp --version`. Semua perintah v2 masih
> tersedia sebagai alias di v3.

Akan tercipta `.clasp.json` — sudah ter-ignore, biarkan saja.

**Kalau `clasp login` bermasalah** (sering terjadi di jaringan kantor yang
memblokir callback OAuth ke localhost), ada jalur cadangan yang sepenuhnya
sah: buka `script.google.com`, buat proyek baru, lalu salin-tempel isi
keempat berkas `.gs` ke editor. Repo tetap menjadi sumber kebenaran, hanya
sinkronisasinya manual. Semua langkah berikutnya tetap sama.

### Tahap 3 — Script Properties

Bangkitkan kunci acak:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Buka editor Apps Script:

```bash
clasp open-script
```

Masuk ke **⚙ Project Settings → Script Properties → Add script property**:

| Property | Value |
|---|---|
| `SPREADSHEET_ID` | ID dari Tahap 1 |
| `SECRET_KEY` | hasil perintah di atas |

Nilai-nilai ini tersimpan di server Google, bukan di kode. Inilah sebabnya
repo publik tetap aman.

> `SECRET_KEY` adalah kunci penanda tangan seluruh token sesi. Menggantinya
> membatalkan semua sesi yang sedang berjalan seketika — itu satu-satunya
> cara mencabut token yang bocor sebelum masa berlakunya habis.

### Tahap 4 — Unggah kode dan buat tab

```bash
cd apps-script
clasp push
```

Di editor Apps Script, jalankan fungsi berikut **berurutan** lewat menu
Run. Google akan meminta izin akses pada fungsi pertama — setujui.

1. `cekKonfigurasi()` — pastikan kedua Script Property terbaca
2. `createAllSheets()` — membuat 15 tab beserta header

`createAllSheets()` aman dijalankan berulang kali. Tab yang sudah ada tidak
disentuh isinya, hanya headernya yang diperiksa.

### Tahap 5 — Isi data

Dua cara. Yang pertama jauh lebih aman.

**A. Lewat berkas penyemai (disarankan)**

```bash
node scripts/generate_seeder.cjs
```

Menghasilkan `data/Seed.gs`. Di editor Apps Script, tambah berkas baru
bernama `Seed`, tempel seluruh isinya, simpan, lalu jalankan
`imporSemuaData()`.

Datanya ditulis lewat `setValues()` dengan tipe yang sudah ditentukan dari
`SKEMA`, jadi tidak ada dialog yang bisa salah disetel. Fungsi itu juga
menolak menimpa tab yang sudah berisi data kecuali `TIMPA_DATA_YANG_ADA`
diubah ke `true`.

Hapus berkas `Seed` dari proyek setelah selesai — isinya data perusahaan.

**B. Impor CSV manual**

Untuk tiap CSV di `data/csv/`: **File → Import → Upload**, dengan

- **Import location:** Replace data at selected cell
- **Sel yang dipilih:** `A2` pada tab bersangkutan
- **Convert text to numbers, dates, and formulas:** **matikan**

Opsi terakhir itu yang berbahaya. Kalau menyala, Google Sheets mengubah
`2024-09-30` jadi objek tanggal, dan hash password 64 karakter bisa berubah
jadi notasi ilmiah — user tidak akan pernah bisa login lagi, tanpa cara
memulihkan selain mengulang migrasi.

**Akhiri dengan `cekIsiData()`** apa pun caranya. Fungsi ini memeriksa jumlah
baris, keutuhan hash password, konsistensi format tanggal, dan apakah ada
order yang menunjuk customer tidak ada.

### Tahap 6 — Deploy web app

Di editor Apps Script: **Deploy → New deployment → ⚙ → Web app**

| Pengaturan | Nilai | Alasan |
|---|---|---|
| Execute as | **Me** | Script mengakses spreadsheet atas nama Anda |
| Who has access | **Anyone** | Wajib, agar bisa dipanggil dari GitHub Pages |

Salin **Web app URL** yang berakhiran `/exec`.

> "Anyone" berarti URL ini benar-benar publik. Itulah sebabnya sistem ini
> membangun token auth sendiri: endpoint-nya terbuka, tapi setiap permintaan
> diverifikasi tanda tangannya sebelum apa pun dijalankan.

Verifikasi:

```bash
curl -L -H "Content-Type: text/plain" -d "{\"action\":\"ping\"}" "URL_ANDA/exec"
```

Harus mengembalikan `{"ok":true,"data":{"service":"AZAMA API",...}}`.

**Perhatikan bahwa perintah itu tidak memakai `-X POST`.** Ini penting, dan
berlawanan dengan naluri.

Apps Script membalas POST dengan redirect 302 ke `googleusercontent.com`,
dan jawaban yang sudah dihitung itu harus diambil dengan **GET**. Perilaku
bawaan curl saat mengikuti redirect memang persis begitu — POST ke `/exec`,
lalu GET ke tujuan redirect. `-d` sendiri sudah membuat permintaan pertama
menjadi POST, jadi `-X POST` tidak diperlukan.

Menambahkan `-X POST` justru merusaknya: curl akan memaksa POST pada redirect
tanpa mengirim ulang badan permintaan, dan Google menolak dengan
`411 Length Required`. Memaksanya lagi dengan `--post302` menghasilkan
kegagalan berbeda — POST ke `googleusercontent.com` dibalas halaman Drive
"Maaf, saat ini tidak dapat membuka file", yang menyesatkan karena terlihat
seperti masalah izin akses.

Yang benar cukup `-L` dan `-d`.

### Tahap 7 — Hubungkan frontend

```bash
cd frontend
cp .env.example .env.local
```

Isi `.env.local`:

```
VITE_API_URL=https://script.google.com/macros/s/AKfycb.../exec
```

```bash
npm run dev
```

Buka halaman Cek Koneksi dan kerjakan keempat langkahnya berurutan. Kalau
langkah 4 menampilkan total omzet **Rp 49.020.000**, seluruh rantai —
frontend, token, Apps Script, Sheets — sudah tersambung benar. Angka itu
sama persis dengan total di DASHBOARD Excel lama.

### Tahap 8 — GitHub Pages

1. Repo → **Settings → Secrets and variables → Actions → New repository secret**
   Nama `VITE_API_URL`, isi URL `/exec` Anda.
2. Repo → **Settings → Pages → Source: GitHub Actions**
3. Push ke `main`. Tab **Actions** akan menjalankan workflow.

Situs tayang di `https://<user>.github.io/cv_azama/`. Deploy pertama biasanya
2–3 menit.

Workflow sengaja gagal lebih awal dengan pesan jelas kalau secret
`VITE_API_URL` belum diisi. Tanpa pemeriksaan itu, build tetap berhasil tapi
situsnya tidak bisa menghubungi backend sama sekali — gejala yang jauh lebih
sulit dilacak.

---

## Memperbarui backend

Setelah deploy pertama, mengubah kode `.gs` memerlukan **tiga** langkah,
bukan satu. Ini bagian yang paling sering terlewat.

```bash
cd apps-script

# 1. Unggah kode ke Google
clasp push

# 2. Bekukan jadi versi baru — catat nomor versi yang tercetak
clasp create-version "perbaikan perhitungan aging"

# 3. Arahkan deployment yang sudah ada ke versi baru itu
clasp list-deployments                      # cari deployment ID Anda
clasp update-deployment <deploymentId> -V <nomorVersi>
```

Langkah 3 yang menjaga **URL `/exec` tetap sama**. Kalau Anda membuat
deployment baru (`clasp create-deployment` tanpa `-i`), Google memberi URL
baru, dan frontend Anda masih menunjuk yang lama.

Lewat editor web, langkah yang setara: **Deploy → Manage deployments →
pilih deployment → ✏ Edit → Version: New version → Deploy**.

Jangan lupa `git push` juga — itu langkah yang terpisah sepenuhnya.

---

## Masalah yang sering muncul

| Gejala | Penyebab | Solusi |
|---|---|---|
| Halaman Pages putih kosong tanpa error | `base` di `vite.config.js` salah | Harus persis `'/cv_azama/'`, sama dengan nama repo |
| `curl` menjawab `411 Length Required` | `-X POST` memaksa POST pada redirect tanpa badan permintaan | Buang `-X POST`, cukup `-L` dan `-d` |
| `curl` menjawab halaman Drive "tidak dapat membuka file" | `--post302` mem-POST ke `googleusercontent.com` | Buang `--post*`, biarkan curl beralih ke GET |
| `curl` mengembalikan HTML, bukan JSON | Redirect tidak diikuti | Tambahkan flag `-L` |
| Frontend gagal dengan error CORS | Header `Content-Type: application/json` memicu preflight | Sudah ditangani: `api.js` memakai `text/plain` |
| Balasan berupa halaman login Google | Deployment tidak diatur "Anyone" | Ubah di Manage deployments |
| `clasp push` ditolak | Apps Script API belum aktif | Buka `script.google.com/home/usersettings` |
| Perubahan kode tidak terasa efeknya | Deployment masih menunjuk versi lama | Lihat [Memperbarui backend](#memperbarui-backend) |
| Actions merah di langkah `npm ci` | `package-lock.json` belum ter-commit | Commit berkas itu dari folder `frontend` |
| Semua user tiba-tiba tidak bisa login | Kolom `password_hash` rusak saat impor | Jalankan `cekIsiData()`; setel kolom ke Teks Polos, impor ulang |
| Build gagal menyebut `@tailwind base` | Konfigurasi PostCSS milik folder induk ikut terbaca | Sudah ditangani `frontend/postcss.config.js` |
| Error `CONFIG_MISSING` | Script Property belum diisi | Jalankan `cekKonfigurasi()` |

---

## Catatan data hasil migrasi

Hal-hal yang perlu diverifikasi manusia. Skrip migrasi mencetak ulang daftar
ini setiap kali dijalankan.

- **Seluruh 111 invoice historis diberi status `paid`.** Kolom Status di
  Excel kosong 100%, jadi ini asumsi, bukan fakta. Kalau ada yang sebenarnya
  belum dibayar, laporan aging piutang akan salah sejak hari pertama.
- **HPP produk `GTDS019` diisi Rp 14.000** (margin 30% dari harga jual
  20.000). Excel tidak punya angkanya. Perlu dikonfirmasi ke bagian produksi.
- **Pabrik Bentoel tercatat membeli `GD05` seharga Rp 20.000**, padahal
  harga masternya 7.500. Di master ada produk `GTDS005` "Galon Mini 5 liter"
  seharga persis 20.000. Kemungkinan besar salah tulis kode. Cek nota asli.
- **`deposit_amount` dan `min_stock` semuanya nol.** Excel tidak punya
  datanya. Alert stok minimum belum akan berfungsi sampai diisi.
- **Enam customer ditandai punya harga khusus tapi nominalnya tidak pernah
  ditulis**, dan riwayatnya memakai harga normal. Isi manual di tab
  `customer_prices` kalau memang ada kesepakatan.
- **Riwayat penjualan tidak menghasilkan mutasi stok maupun galon.**
  Kolom "Stok Akhir" di Excel sudah memperhitungkan semua penjualan lama;
  menulis ulang riwayatnya akan menghitung ganda. Saldo galon dimulai bersih
  dari tanggal sistem dipakai — galon dari 2024–2025 secara fisik sudah
  ditukar berkali-kali.
- **`13C26SGS` (Pabrik Bentoel) tidak punya sales.** Customer ini tidak akan
  terlihat oleh user role `sales` mana pun sampai kolomnya diisi.

---

## Peta fase

| Fase | Isi | Status |
|---|---|:--:|
| 0 | Fondasi: skema, Sheets.gs, Auth.gs, router, migrasi, README | selesai |
| 1 | Penjualan: `sales.*`, master produk & customer, Login, SalesEntry, SalesList | selesai |
| 2 | Dashboard & pemeriksa integritas | selesai |
| 3 | Piutang & Galon: `payment.*`, `receivable.aging`, `gallon.*` | — |
| 4 | Produksi, Bahan, Biaya: `production.*`, `expense.*`, laporan laba bersih | — |
| 5 | Manajemen user: `user.*`, pengetatan role menyeluruh | — |

**Modul stok sengaja tidak dibangun.** Model bisnisnya pre-order: produksi
mengikuti pesanan yang masuk, tidak ada penyetokan barang jadi. Angka stok
akan selalu mendekati nol lalu minus, dan alert stok minimum hanya akan
menyalakan peringatan palsu setiap hari sampai orang berhenti membacanya.

Buku besar `stock_movements` tetap diisi setiap penjualan sebagai riwayat
barang keluar, hanya tidak ditampilkan. Begitu batch produksi dicatat di
Fase 4, produksi masuk akan otomatis mengimbanginya tanpa perlu membangun
ulang apa pun.

Yang tetap dilacak adalah **galon kosong di tangan customer**. Itu bukan
persediaan barang jadi melainkan aset fisik milik perusahaan yang bisa hilang,
dan saldonya muncul di Dashboard sebagai indikator risiko.

---

## Batas yang perlu disadari

Autentikasi di sistem ini dibangun sendiri karena Apps Script yang di-deploy
dengan akses "Anyone" tidak menyediakan lapisan itu. Bentuknya: password
di-hash SHA-256 dengan salt acak per user, token ditandatangani HMAC-SHA256
dan berlaku 8 jam.

Ini memadai untuk sistem internal dengan 3–10 pengguna di jaringan
tepercaya. Ini **bukan** keamanan tingkat perbankan. Yang secara khusus
belum ada: pembatasan laju percobaan login, pencabutan token per pengguna,
dan autentikasi dua faktor.

Begitu sistem ini menyentuh kanal belanja, pembayaran daring, atau data
pihak ketiga, lapisan auth ini wajib diganti penyedia auth sungguhan.
