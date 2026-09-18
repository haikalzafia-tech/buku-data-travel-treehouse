# Buku Data Travel Treehouse

Web pribadi untuk mencatat data kartu (NO, Nama, Travel, No HP/Telepon, Bank,
Foto, Keterangan), dengan login admin dan database tersimpan di server —
jadi bisa dibuka dari HP, laptop, atau perangkat lain mana saja selama
kamu login.

## Menjalankan di komputer sendiri (untuk coba-coba)

Butuh [Node.js](https://nodejs.org) terinstal (versi 18 ke atas).

```bash
npm install
npm start
```

Lalu buka `http://localhost:3000` di browser.

**Login default:**
- Username: `admin`
- Password: `admin`

Ubah username/password di file `data/config.json` sebelum dipakai serius.

## Menaruh di hosting sungguhan (biar bisa diakses dari mana saja)

Karena ini punya backend (server Node.js) — bukan cuma file statis — kamu
butuh hosting yang **mendukung Node.js**, bukan hosting file statis biasa
(seperti GitHub Pages atau shared hosting tanpa Node). Beberapa opsi yang
gampang dipakai dan ada paket gratisnya:

- **Railway** (railway.app)
- **Render** (render.com)
- **Fly.io** (fly.io)
- VPS sendiri (DigitalOcean, Vultr, dll) — jalankan dengan `pm2` atau `systemd`
  supaya server tetap hidup

Langkah umum di layanan seperti Railway/Render:
1. Upload folder ini ke GitHub, atau upload langsung lewat dashboard mereka
2. Set start command: `npm install && npm start`
3. Setelah deploy, kamu dapat URL publik (misal `buku-data.up.railway.app`)
4. Buka URL itu dari HP/laptop mana saja, login, langsung bisa dipakai

## Struktur folder

```
buku-data-travel-treehouse/
  server.js          <- backend (login, database, API, ekspor Excel)
  package.json
  data/
    db.json          <- database pribadi (semua data tersimpan di sini)
    config.json       <- username & password admin
  public/
    login.html / login.js
    index.html / app.js
    style.css
```

## ⚠️ PENTING: Kenapa data suka hilang & cara mencegahnya permanen

Railway (dan hosting sejenis) itu **container sementara** — setiap kali ada
deploy baru (baik karena kamu push kode, atau Railway restart sendiri),
seluruh isi container dibuat ulang dari nol. Kalau database (`data/db.json`)
disimpan di dalam folder project biasa, dia ikut ke-reset setiap saat itu
terjadi — makanya data yang diinput manual bisa tiba-tiba hilang.

**Solusi permanen: pakai Railway Volume** (disk terpisah yang tidak ikut
di-reset). Sudah disiapkan di kode ini lewat environment variable `DATA_DIR`.

### Cara setup (cuma perlu sekali):

1. Buka project kamu di Railway, klik service `buku-data-travel-treehouse`
2. Masuk ke tab **Settings** → cari bagian **Volumes**
3. Klik **New Volume**, isi:
   - Mount path: `/data`
   - Ukuran: default (biasanya 1GB, lebih dari cukup)
4. Masuk ke tab **Variables**, tambahkan environment variable baru:
   - Key: `DATA_DIR`
   - Value: `/data`
5. Railway otomatis redeploy setelah kamu tambah volume/variable.
   Setelah ini, `data/db.json` disimpan di volume permanen, **bukan** lagi
   ikut kode — jadi berapa kali pun kamu update & push kode ke GitHub,
   data yang sudah ada di dalam aplikasi TIDAK akan pernah ikut terhapus.

⚠️ Karena ini disk baru yang kosong, **kamu perlu impor ulang data yang ada
satu kali terakhir** setelah volume ini aktif. Setelah itu, aman selamanya.

## Data lama sudah ter-commit di Git — bersihkan referensinya

Kalau sebelumnya folder `data/` sempat ke-push ke GitHub, jalankan ini
sekali di folder project kamu (setelah menambahkan `.gitignore` yang baru)
supaya Git berhenti melacak folder tersebut:

```bash
git rm -r --cached data
git add .
git commit -m "berhenti melacak folder data, sudah pakai Railway Volume"
git push
```



- Password admin disimpan polos (plain text) di `data/config.json` demi
  kesederhanaan — cukup aman untuk pemakaian pribadi, tapi **jangan pakai
  password penting/sama dengan akun lain**.
- Ganti nilai `secret` di `server.js` (bagian `express-session`) dengan
  teks acak sebelum dipakai di hosting publik.
- Backup folder `data/` secara berkala (atau rutin ekspor ke Excel) —
  itu satu-satunya tempat data kamu tersimpan.
