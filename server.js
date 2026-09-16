const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
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
app.use(express.json({ limit: "20mb" }));
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

// ---- Export to Excel (server-side, with embedded photos) ----
app.get("/api/export", requireAuth, async (req, res) => {
  try {
    const db = readDB();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data Kartu");

    sheet.columns = [
      { header: "NO", key: "no", width: 10 },
      { header: "NAMA", key: "nama", width: 22 },
      { header: "TRAVEL", key: "travel", width: 18 },
      { header: "NO HP/TELEPON", key: "telepon", width: 18 },
      { header: "BANK", key: "bank", width: 14 },
      { header: "FOTO", key: "foto", width: 14 },
      { header: "KETERANGAN", key: "ket", width: 28 }
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).eachCell((cell) => {
      cell.border = { bottom: { style: "medium" } };
    });

    let rowIndex = 2;
    db.entries.forEach((e) => {
      const row = sheet.addRow({
        no: e.no || "",
        nama: e.nama || "",
        travel: e.travel || "",
        telepon: e.telepon || "",
        bank: e.bank || "",
        foto: "",
        ket: e.ket || ""
      });
      row.height = 60;
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { bottom: { style: "thin", color: { argb: "FFDAD2BE" } } };
      });

      if (e.foto) {
        const match = e.foto.match(/^data:image\/(png|jpeg|jpg);base64,(.*)$/);
        if (match) {
          const ext = match[1] === "jpg" ? "jpeg" : match[1];
          const imgId = workbook.addImage({ base64: e.foto, extension: ext });
          sheet.addImage(imgId, {
            tl: { col: 5, row: rowIndex - 1 },
            ext: { width: 60, height: 60 }
          });
        }
      }
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
