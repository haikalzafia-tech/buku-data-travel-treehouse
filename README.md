# Buku Data Travel Treehouse

Web pribadi untuk mencatat data kartu (NO, Nama, Travel, No HP/Telepon, Member,
Foto, Keterangan), dengan login admin dan database **PostgreSQL** — data
tersimpan permanen, tidak akan hilang lagi walau kode di-update atau di-deploy
ulang berkali-kali.

## ⚠️ Kenapa pindah dari file JSON ke PostgreSQL

Versi sebelumnya menyimpan data di file `data/db.json` di dalam project.
Railway (dan hosting sejenis) membuat ulang container dari nol setiap kali
ada deploy baru, sehingga file tersebut bisa ikut ter-reset. PostgreSQL
adalah database service terpisah yang hidup independen dari kode aplikasi —
deploy ulang, restart, atau update kode sebanyak apapun **tidak akan
menyentuh data di dalamnya**.

## Setup PostgreSQL di Railway (WAJIB, sekali saja)

1. Buka project Railway kamu (halaman canvas, bukan di dalam service)
2. Klik kanan area kosong → **Database** → pilih **PostgreSQL**
   (atau klik "New" → "Database" → "Add PostgreSQL")
3. Railway otomatis membuat service database baru bernama `Postgres`
4. Klik service **buku-data-travel-treehouse** (aplikasi kamu) → tab **Variables**
5. Klik **New Variable** → pilih **"Add Reference"** (bukan ketik manual) →
   pilih service `Postgres` → pilih `DATABASE_URL`
   - Ini penting: dengan cara **reference** (bukan copy-paste manual),
     variabelnya otomatis selalu update kalau Railway mengganti kredensial
6. Railway otomatis redeploy. Database dan tabel-tabelnya dibuat otomatis
   saat aplikasi pertama kali jalan (tidak perlu setup manual lewat SQL)

Setelah ini, kamu bisa **hapus Volume lama** (yang mount path-nya `/data`
atau `/data.`) kalau masih ada — sudah tidak dipakai lagi.

## Menjalankan di komputer sendiri (untuk coba-coba)

Butuh [Node.js](https://nodejs.org) dan PostgreSQL terinstal.

```bash
npm install
# set koneksi ke database lokal atau Railway kamu:
# Windows PowerShell:
$env:DATABASE_URL="postgres://user:password@localhost:5432/nama_db"
# Mac/Linux:
export DATABASE_URL="postgres://user:password@localhost:5432/nama_db"

npm start
```

Lalu buka `http://localhost:3000` di browser.

**Login default:** username `admin`, password `admin` (ganti lewat tombol
"Ganti password" di web setelah login pertama kali).

## Menaruh di hosting (Railway)

1. Push folder ini ke GitHub
2. Di Railway: New Project → Deploy from GitHub repo → pilih repo ini
3. Tambahkan PostgreSQL seperti langkah di atas
4. Railway otomatis `npm install && npm start`
5. Aktifkan domain publik lewat Settings → Networking → Generate Domain

## Struktur folder

```
buku-data-travel-treehouse/
  server.js          <- backend (login, database PostgreSQL, API, ekspor Excel)
  package.json
  public/
    login.html / login.js
    index.html / app.js
    style.css
```

## Catatan keamanan

- Password admin disimpan polos (plain text) di database demi kesederhanaan
  — cukup aman untuk pemakaian pribadi, tapi jangan pakai password yang
  sama dengan akun penting lain.
- Ganti nilai `secret` di `server.js` (bagian `express-session`) dengan
  teks acak sebelum dipakai serius di publik.
- Railway otomatis backup PostgreSQL secara berkala di paket berbayarnya;
  untuk jaga-jaga tambahan, tetap rutin klik "Ekspor ke Excel" di web
  sebagai cadangan manual.
