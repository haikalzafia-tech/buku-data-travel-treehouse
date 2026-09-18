const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

// ---- Bootstrapping local files (acts as our simple personal database) ----
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ entries: [] }, null, 2));
}
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ username: "admin", password: "admin" }, null, 2)
  );
}
console.log("Menyimpan database di:", DATA_DIR);

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}
function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}

// ---- Middleware ----
app.use(express.json({ limit: "15mb" }));
app.use(
  session({
    secret: "ubah-secret-ini-sebelum-dipakai-serius",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
      sameSite: "lax"
    }
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  return res.status(401).json({ error: "Sesi berakhir, silakan login lagi." });
}

// ---- Auth routes ----
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const config = readConfig();
  if (username === config.username && password === config.password) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Username atau password salah." });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({
    loggedIn: !!(req.session && req.session.loggedIn),
    username: (req.session && req.session.username) || null
  });
});

// ---- Change admin username / password ----
app.post("/api/change-password", requireAuth, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  const config = readConfig();

  if (!currentPassword || currentPassword !== config.password) {
    return res.status(401).json({ error: "Password saat ini salah." });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password baru minimal 4 karakter." });
  }

  config.username = (newUsername || config.username || "admin").trim();
  config.password = newPassword;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

  // Selesai ganti password, minta login ulang demi keamanan.
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ---- Entries CRUD (this is the "database pribadi") ----
app.get("/api/entries", requireAuth, (req, res) => {
  res.json(readDB().entries);
});

app.post("/api/entries", requireAuth, (req, res) => {
  const db = readDB();
  const entry = req.body || {};
  entry.id = crypto.randomUUID();
  if (!entry.no) entry.no = String(db.entries.length + 1);
  db.entries.push(entry);
  writeDB(db);
  res.json(entry);
});

// ---- Bulk import (untuk data lama dari Excel) ----
app.post("/api/entries/bulk", requireAuth, (req, res) => {
  const incoming = (req.body && req.body.entries) || [];
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "Tidak ada data untuk diimpor." });
  }

  const db = readDB();
  let added = 0;
  let skipped = 0;

  incoming.forEach((raw) => {
    const nama = (raw.nama || "").toString().trim();
    if (!nama) {
      skipped++;
      return;
    }
    let fotos = [];
    if (Array.isArray(raw.fotos)) {
      fotos = raw.fotos.filter(Boolean);
    } else if (raw.foto) {
      fotos = [raw.foto];
    }
    const entry = {
      id: crypto.randomUUID(),
      no: (raw.no || "").toString().trim() || String(db.entries.length + 1),
      nama: nama,
      travel: (raw.travel || "").toString().trim(),
      telepon: (raw.telepon || "").toString().trim(),
      member: (raw.member || "").toString().trim(),
      fotos: fotos,
      ket: (raw.ket || "").toString()
    };
    db.entries.push(entry);
    added++;
  });

  writeDB(db);
  res.json({ ok: true, added: added, skipped: skipped, total: db.entries.length });
});

app.put("/api/entries/:id", requireAuth, (req, res) => {
  const db = readDB();
  const idx = db.entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Data tidak ditemukan." });
  db.entries[idx] = Object.assign({}, db.entries[idx], req.body, { id: req.params.id });
  writeDB(db);
  res.json(db.entries[idx]);
});

app.delete("/api/entries/:id", requireAuth, (req, res) => {
  const db = readDB();
  const before = db.entries.length;
  db.entries = db.entries.filter((e) => e.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true, deleted: before - db.entries.length });
});

// ---- Hapus semua data (untuk koreksi/reset sebelum impor ulang) ----
app.delete("/api/entries", requireAuth, (req, res) => {
  const db = readDB();
  const count = db.entries.length;
  db.entries = [];
  writeDB(db);
  res.json({ ok: true, deleted: count });
});

// ---- Export to Excel (server-side, with embedded photos) ----
function getFotosArr(entry) {
  if (Array.isArray(entry.fotos)) return entry.fotos.filter(Boolean);
  if (entry.foto) return [entry.foto];
  return [];
}

app.get("/api/export", requireAuth, async (req, res) => {
  try {
    const db = readDB();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data Kartu");

    const maxFotos = db.entries.reduce((max, e) => Math.max(max, getFotosArr(e).length), 0) || 1;

    const baseColumns = [
      { header: "NO", key: "no", width: 10 },
      { header: "NAMA", key: "nama", width: 22 },
      { header: "TRAVEL", key: "travel", width: 18 },
      { header: "NO HP/TELEPON", key: "telepon", width: 18 },
      { header: "MEMBER", key: "member", width: 12 }
    ];
    const fotoColumns = [];
    for (let i = 0; i < maxFotos; i++) {
      fotoColumns.push({ header: maxFotos > 1 ? `FOTO ${i + 1}` : "FOTO", key: `foto${i}`, width: 14 });
    }
    const fotoStartIndex = baseColumns.length; // 0-based column index where photos begin
    sheet.columns = baseColumns.concat(fotoColumns, [
      { header: "KETERANGAN", key: "ket", width: 28 }
    ]);

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).eachCell((cell) => {
      cell.border = { bottom: { style: "medium" } };
    });

    let rowIndex = 2;
    db.entries.forEach((e) => {
      const rowData = {
        no: e.no || "",
        nama: e.nama || "",
        travel: e.travel || "",
        telepon: e.telepon || "",
        member: e.member || "",
        ket: e.ket || ""
      };
      const row = sheet.addRow(rowData);
      row.height = 60;
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFDAD2BE" } } };
      });

      const fotos = getFotosArr(e);
      fotos.forEach((foto, i) => {
        const match = foto.match(/^data:image\/(png|jpeg|jpg);base64,(.*)$/);
        if (match) {
          const ext = match[1] === "jpg" ? "jpeg" : match[1];
          const imgId = workbook.addImage({ base64: foto, extension: ext });
          sheet.addImage(imgId, {
            tl: { col: fotoStartIndex + i, row: rowIndex - 1 },
            ext: { width: 60, height: 60 }
          });
        }
      });
      rowIndex++;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="data-kartu-${stamp}.xlsx"`);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buffer);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Gagal membuat file Excel." });
  }
});

// ---- Static assets (public, no sensitive data inside) ----
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "public", "style.css")));
app.get("/app.js", (req, res) => res.sendFile(path.join(__dirname, "public", "app.js")));
app.get("/login.js", (req, res) => res.sendFile(path.join(__dirname, "public", "login.js")));

// ---- Page routes (protected) ----
app.get("/login.html", (req, res) => {
  if (req.session && req.session.loggedIn) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get(["/", "/index.html"], (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  return res.redirect("/login.html");
});

app.listen(PORT, () => {
  console.log("Buku Data Travel Treehouse jalan di http://localhost:" + PORT);
  console.log("Login default -> username: admin | password: admin");
  console.log("Ubah di file data/config.json sebelum dipakai serius.");
});
