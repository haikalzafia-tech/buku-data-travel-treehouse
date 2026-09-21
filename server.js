const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { Pool } = require("pg");
const pgSession = require("connect-pg-simple")(session);

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Database (PostgreSQL) ----
// Railway: tambahkan service Database > PostgreSQL di project yang sama,
// lalu reference DATABASE_URL dari situ ke service ini (biasanya otomatis
// tersedia sebagai ${{Postgres.DATABASE_URL}} di tab Variables).
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set. Tambahkan PostgreSQL database di Railway lalu hubungkan DATABASE_URL-nya ke service ini.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      no TEXT,
      nama TEXT NOT NULL,
      travel TEXT,
      telepon TEXT,
      member TEXT,
      fotos JSONB DEFAULT '[]'::jsonb,
      ket TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      member_password TEXT NOT NULL DEFAULT 'anggota123',
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);
  await pool.query(`ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS member_password TEXT NOT NULL DEFAULT 'anggota123';`);
  const existing = await pool.query("SELECT 1 FROM admin_config WHERE id = 1");
  if (existing.rowCount === 0) {
    await pool.query("INSERT INTO admin_config (id, username, password, member_password) VALUES (1, 'admin', 'admin', 'anggota123')");
    console.log("Admin default dibuat -> username: admin | password: admin");
    console.log("Anggota default -> username: anggota | password: anggota123");
  }
  // Index untuk mempercepat pencarian pada dataset besar
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_entries_no ON entries (no);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_entries_member ON entries (member);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_entries_nama ON entries (nama);`);
  // Tabel untuk menyimpan session login (biar login tidak ke-reset tiap restart)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    ) WITH (OIDS=FALSE);
  `);
  await pool.query(`
    ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "session_pkey";
    ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  `);
  console.log("Database siap (PostgreSQL).");
}

// ---- Middleware ----
app.use(express.json({ limit: "15mb" }));
app.use(
  session({
    store: new pgSession({ pool: pool, tableName: "session" }),
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

function requireAdmin(req, res, next) {
  if (req.session && req.session.loggedIn && req.session.role === "admin") return next();
  if (req.session && req.session.loggedIn) {
    return res.status(403).json({ error: "Akun anggota tidak punya izin untuk melakukan ini." });
  }
  return res.status(401).json({ error: "Sesi berakhir, silakan login lagi." });
}

// ---- Auth routes ----
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const result = await pool.query("SELECT username, password, member_password FROM admin_config WHERE id = 1");
    const config = result.rows[0];
    if (!config) return res.status(401).json({ error: "Username atau password salah." });

    if (username === config.username && password === config.password) {
      req.session.loggedIn = true;
      req.session.username = username;
      req.session.role = "admin";
      return res.json({ ok: true, role: "admin" });
    }
    if (username === "anggota" && password === config.member_password) {
      req.session.loggedIn = true;
      req.session.username = "anggota";
      req.session.role = "anggota";
      return res.json({ ok: true, role: "anggota" });
    }
    return res.status(401).json({ error: "Username atau password salah." });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({
    loggedIn: !!(req.session && req.session.loggedIn),
    username: (req.session && req.session.username) || null,
    role: (req.session && req.session.role) || null
  });
});

// ---- Change admin/anggota password (admin only) ----
app.post("/api/change-password", requireAdmin, async (req, res) => {
  const { currentPassword, newUsername, newPassword, newMemberPassword } = req.body || {};
  try {
    const result = await pool.query("SELECT username, password, member_password FROM admin_config WHERE id = 1");
    const config = result.rows[0];

    if (!currentPassword || !config || currentPassword !== config.password) {
      return res.status(401).json({ error: "Password saat ini salah." });
    }

    const finalUsername = (newUsername || config.username || "admin").trim();
    const finalPassword = (newPassword && newPassword.length >= 4) ? newPassword : config.password;
    if (newPassword && newPassword.length < 4) {
      return res.status(400).json({ error: "Password admin baru minimal 4 karakter." });
    }
    let finalMemberPassword = config.member_password;
    if (newMemberPassword) {
      if (newMemberPassword.length < 4) {
        return res.status(400).json({ error: "Password anggota baru minimal 4 karakter." });
      }
      finalMemberPassword = newMemberPassword;
    }

    await pool.query(
      "UPDATE admin_config SET username = $1, password = $2, member_password = $3 WHERE id = 1",
      [finalUsername, finalPassword, finalMemberPassword]
    );

    req.session.destroy(() => {
      res.json({ ok: true });
    });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Terjadi kesalahan server." });
  }
});

// ---- Entries: list dengan pagination + pencarian di server (biar ringan di HP) ----
app.get("/api/entries", requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = (page - 1) * limit;
    const q = (req.query.q || "").trim();
    const member = (req.query.member || "").trim();
    const no = (req.query.no || "").trim();

    const conditions = [];
    const params = [];

    if (no) {
      params.push(`%${no}%`);
      conditions.push(`no ILIKE $${params.length}`);
    } else if (q) {
      params.push(`%${q}%`);
      const idx = params.length;
      conditions.push(`(nama ILIKE $${idx} OR travel ILIKE $${idx} OR telepon ILIKE $${idx} OR ket ILIKE $${idx})`);
    }
    if (member) {
      params.push(member);
      conditions.push(`member = $${params.length}`);
    }

    const whereClause = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const countResult = await pool.query(`SELECT COUNT(*) FROM entries ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(
      `SELECT id, no, nama, travel, telepon, member, ket, jsonb_array_length(fotos) AS foto_count
       FROM entries ${whereClause}
       ORDER BY created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err) {
    console.error("Get entries error:", err);
    res.status(500).json({ error: "Gagal mengambil data." });
  }
});

// ---- Ambil foto satu entry saja (dimuat belakangan, bukan sekaligus di list) ----
app.get("/api/entries/:id/fotos", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT fotos FROM entries WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Data tidak ditemukan." });
    res.json({ fotos: result.rows[0].fotos || [] });
  } catch (err) {
    console.error("Get fotos error:", err);
    res.status(500).json({ error: "Gagal mengambil foto." });
  }
});

app.post("/api/entries", requireAdmin, async (req, res) => {
  try {
    const raw = req.body || {};
    const id = crypto.randomUUID();
    const countResult = await pool.query("SELECT COUNT(*) FROM entries");
    const no = (raw.no || "").toString().trim() || String(parseInt(countResult.rows[0].count, 10) + 1);
    let fotos = [];
    if (Array.isArray(raw.fotos)) fotos = raw.fotos.filter(Boolean);
    else if (raw.foto) fotos = [raw.foto];

    const entry = {
      id,
      no,
      nama: (raw.nama || "").toString().trim(),
      travel: (raw.travel || "").toString().trim(),
      telepon: (raw.telepon || "").toString().trim(),
      member: (raw.member || "").toString().trim(),
      fotos,
      ket: (raw.ket || "").toString()
    };

    await pool.query(
      "INSERT INTO entries (id, no, nama, travel, telepon, member, fotos, ket) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [entry.id, entry.no, entry.nama, entry.travel, entry.telepon, entry.member, JSON.stringify(entry.fotos), entry.ket]
    );
    res.json(entry);
  } catch (err) {
    console.error("Create entry error:", err);
    res.status(500).json({ error: "Gagal menyimpan data." });
  }
});

app.put("/api/entries/:id", requireAdmin, async (req, res) => {
  try {
    const raw = req.body || {};
    let fotos = [];
    if (Array.isArray(raw.fotos)) fotos = raw.fotos.filter(Boolean);
    else if (raw.foto) fotos = [raw.foto];

    const result = await pool.query(
      `UPDATE entries SET no=$1, nama=$2, travel=$3, telepon=$4, member=$5, fotos=$6, ket=$7
       WHERE id=$8 RETURNING id, no, nama, travel, telepon, member, fotos, ket`,
      [
        (raw.no || "").toString().trim(),
        (raw.nama || "").toString().trim(),
        (raw.travel || "").toString().trim(),
        (raw.telepon || "").toString().trim(),
        (raw.member || "").toString().trim(),
        JSON.stringify(fotos),
        (raw.ket || "").toString(),
        req.params.id
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Data tidak ditemukan." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update entry error:", err);
    res.status(500).json({ error: "Gagal memperbarui data." });
  }
});

app.delete("/api/entries/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM entries WHERE id = $1", [req.params.id]);
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    console.error("Delete entry error:", err);
    res.status(500).json({ error: "Gagal menghapus data." });
  }
});

app.delete("/api/entries", requireAdmin, async (req, res) => {
  try {
    const countResult = await pool.query("SELECT COUNT(*) FROM entries");
    const count = parseInt(countResult.rows[0].count, 10);
    await pool.query("DELETE FROM entries");
    res.json({ ok: true, deleted: count });
  } catch (err) {
    console.error("Delete all error:", err);
    res.status(500).json({ error: "Gagal menghapus semua data." });
  }
});

// ---- Bulk import ----
app.post("/api/entries/bulk", requireAdmin, async (req, res) => {
  const incoming = (req.body && req.body.entries) || [];
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: "Tidak ada data untuk diimpor." });
  }

  const client = await pool.connect();
  let added = 0;
  let skipped = 0;
  try {
    await client.query("BEGIN");
    for (const raw of incoming) {
      const nama = (raw.nama || "").toString().trim();
      if (!nama) {
        skipped++;
        continue;
      }
      let fotos = [];
      if (Array.isArray(raw.fotos)) fotos = raw.fotos.filter(Boolean);
      else if (raw.foto) fotos = [raw.foto];

      const id = crypto.randomUUID();
      const no = (raw.no || "").toString().trim() || "";
      await client.query(
        "INSERT INTO entries (id, no, nama, travel, telepon, member, fotos, ket) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id, no, nama,
          (raw.travel || "").toString().trim(),
          (raw.telepon || "").toString().trim(),
          (raw.member || "").toString().trim(),
          JSON.stringify(fotos),
          (raw.ket || "").toString()
        ]
      );
      added++;
    }
    await client.query("COMMIT");
    const totalResult = await pool.query("SELECT COUNT(*) FROM entries");
    res.json({ ok: true, added, skipped, total: parseInt(totalResult.rows[0].count, 10) });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Bulk import error:", err);
    res.status(500).json({ error: "Gagal mengimpor data. Batch ini dibatalkan seluruhnya (tidak ada yang tersimpan sebagian)." });
  } finally {
    client.release();
  }
});

// ---- Export to Excel ----
function getFotosArr(entry) {
  if (Array.isArray(entry.fotos)) return entry.fotos.filter(Boolean);
  return [];
}

app.get("/api/export", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, no, nama, travel, telepon, member, fotos, ket FROM entries ORDER BY created_at ASC");
    const entries = result.rows;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data Kartu");

    const maxFotos = entries.reduce((max, e) => Math.max(max, getFotosArr(e).length), 0) || 1;

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
    const fotoStartIndex = baseColumns.length;
    sheet.columns = baseColumns.concat(fotoColumns, [
      { header: "KETERANGAN", key: "ket", width: 28 }
    ]);

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).eachCell((cell) => {
      cell.border = { bottom: { style: "medium" } };
    });

    let rowIndex = 2;
    entries.forEach((e) => {
      const row = sheet.addRow({
        no: e.no || "",
        nama: e.nama || "",
        travel: e.travel || "",
        telepon: e.telepon || "",
        member: e.member || "",
        ket: e.ket || ""
      });
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
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Gagal membuat file Excel." });
  }
});

// ---- Static assets ----
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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Buku Data Travel Treehouse jalan di http://localhost:" + PORT);
    });
  })
  .catch((err) => {
    console.error("Gagal inisialisasi database:", err);
    process.exit(1);
  });
