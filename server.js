const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = "GSTUDIOADMIN2026";
const adminSessions = new Set();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database("./notepadkita.db");

// ===============================
// DATABASE HELPERS
// ===============================

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ===============================
// IP ADDRESS
// ===============================

function getUserIP(req) {
    let ip = "";

    // Proxy / hosting
    const forwarded = req.headers["x-forwarded-for"];

    if (forwarded) {
        ip = forwarded.split(",")[0].trim();
    }

    // Reverse proxy
    if (!ip) {
        const realIP = req.headers["x-real-ip"];

        if (realIP) {
            ip = realIP.trim();
        }
    }

    // Express socket
    if (!ip) {
        ip = req.socket?.remoteAddress || "";
    }

    // Fallback
    if (!ip) {
        ip = req.connection?.remoteAddress || "";
    }

    // Bersihkan IPv4-mapped IPv6
    if (ip.startsWith("::ffff:")) {
        ip = ip.substring(7);
    }

    // Localhost IPv6
    if (ip === "::1") {
        ip = "127.0.0.1";
    }

    if (!ip) {
        ip = "Tidak diketahui";
    }

    return ip;
}

// ===============================
// DATABASE SETUP
// ===============================

async function siapkanDatabase() {
    console.log("Menyiapkan database...");

    // USERS
    await run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT UNIQUE NOT NULL,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    let userColumns = await all(`PRAGMA table_info(users)`);

    if (!userColumns.some(c => c.name === "ip_address")) {
        await run(`
            ALTER TABLE users
            ADD COLUMN ip_address TEXT
        `);
    }

    userColumns = await all(`PRAGMA table_info(users)`);

    if (!userColumns.some(c => c.name === "last_seen")) {
        await run(`
            ALTER TABLE users
            ADD COLUMN last_seen DATETIME
        `);

        await run(`
            UPDATE users
            SET last_seen = CURRENT_TIMESTAMP
            WHERE last_seen IS NULL
        `);
    }

    // NOTES
    await run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'catatan',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    let noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "user_token")) {
        await run(`ALTER TABLE notes ADD COLUMN user_token TEXT`);
    }

    noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "title")) {
        await run(`ALTER TABLE notes ADD COLUMN title TEXT`);
    }

    noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "content")) {
        await run(`ALTER TABLE notes ADD COLUMN content TEXT`);
    }

    noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "type")) {
        await run(`
            ALTER TABLE notes
            ADD COLUMN type TEXT DEFAULT 'catatan'
        `);
    }

    noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "created_at")) {
        await run(`ALTER TABLE notes ADD COLUMN created_at DATETIME`);
    }

    noteColumns = await all(`PRAGMA table_info(notes)`);

    if (!noteColumns.some(c => c.name === "updated_at")) {
        await run(`ALTER TABLE notes ADD COLUMN updated_at DATETIME`);
    }

    await run(`
        UPDATE notes
        SET type = 'catatan'
        WHERE type IS NULL OR type = ''
    `);

    console.log("Database siap digunakan.");
}

// ===============================
// ADMIN AUTH
// ===============================

function getAdminToken(req) {
    return (
        req.headers["x-admin-token"] ||
        req.headers.authorization?.replace("Bearer ", "")
    );
}

function requireAdmin(req, res, next) {
    const token = getAdminToken(req);

    if (!token || !adminSessions.has(token)) {
        return res.status(401).json({
            success: false,
            message: "Akses admin diperlukan."
        });
    }

    next();
}

// LOGIN ADMIN
app.post("/api/admin/login", (req, res) => {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({
            success: false,
            message: "Password admin salah."
        });
    }

    const adminToken = crypto.randomBytes(32).toString("hex");

    adminSessions.add(adminToken);

    console.log("Admin berhasil login.");

    res.json({
        success: true,
        adminToken
    });
});

// CHECK ADMIN
app.get("/api/admin/check", requireAdmin, (req, res) => {
    res.json({
        success: true,
        admin: true
    });
});

// LOGOUT
app.post("/api/admin/logout", requireAdmin, (req, res) => {
    const token = getAdminToken(req);

    adminSessions.delete(token);

    res.json({
        success: true
    });
});

// ===============================
// HTML
// ===============================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index1.html"));
});

app.get("/:file", (req, res, next) => {
    const file = req.params.file;

    if (!file.endsWith(".html")) {
        return next();
    }

    const filePath = path.join(__dirname, file);

    res.sendFile(filePath, err => {
        if (err) next();
    });
});

// ===============================
// USERS
// ===============================

// BUAT USER BARU
app.post("/api/users", async (req, res) => {
    try {
        const userToken = crypto.randomBytes(32).toString("hex");

        const ipAddress = getUserIP(req);

        console.log("================================");
        console.log("USER BARU");
        console.log("TOKEN:", userToken);
        console.log("IP ADDRESS:", JSON.stringify(ipAddress));
        console.log("REMOTE ADDRESS:", req.socket?.remoteAddress);
        console.log("X-FORWARDED-FOR:", req.headers["x-forwarded-for"]);
        console.log("X-REAL-IP:", req.headers["x-real-ip"]);
        console.log("================================");

        await run(`
            INSERT INTO users (
                user_token,
                ip_address,
                last_seen
            )
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [
            userToken,
            ipAddress
        ]);

        res.json({
            success: true,
            userToken,
            ipAddress
        });

    } catch (error) {
        console.error("Gagal membuat user:", error);

        res.status(500).json({
            success: false,
            message: "Gagal membuat pengguna."
        });
    }
});

// DATA USER
app.get("/api/users/:token", async (req, res) => {
    try {
        const user = await get(`
            SELECT
                id,
                user_token,
                ip_address,
                created_at,
                last_seen
            FROM users
            WHERE user_token = ?
        `, [
            req.params.token
        ]);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Pengguna tidak ditemukan."
            });
        }

        res.json({
            success: true,
            user
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Terjadi kesalahan server."
        });
    }
});

// HEARTBEAT USER
app.post("/api/users/:token/heartbeat", async (req, res) => {
    try {
        const userToken = req.params.token;
        const currentIP = getUserIP(req);

        const user = await get(`
            SELECT id
            FROM users
            WHERE user_token = ?
        `, [
            userToken
        ]);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Pengguna tidak ditemukan."
            });
        }

        await run(`
            UPDATE users
            SET
                last_seen = CURRENT_TIMESTAMP,
                ip_address = ?
            WHERE user_token = ?
        `, [
            currentIP,
            userToken
        ]);

        res.json({
            success: true,
            ipAddress: currentIP
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false
        });
    }
});

// ===============================
// ADMIN - ONLINE USERS
// ===============================

app.get("/api/admin/online-users", requireAdmin, async (req, res) => {
    try {
        const users = await all(`
            SELECT
                id,
                user_token,
                ip_address,
                last_seen
            FROM users
            WHERE last_seen >= datetime('now', '-5 minutes')
            ORDER BY last_seen DESC
        `);

        const total = await get(`
            SELECT COUNT(*) AS total
            FROM users
        `);

        res.json({
            success: true,
            onlineCount: users.length,
            totalCount: total?.total || 0,

            users: users.map(user => ({
                id: user.id,
                username: `User #${user.id}`,
                user_token: user.user_token,
                ip_address: user.ip_address || "Tidak diketahui",
                last_seen: user.last_seen
            }))
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil user online."
        });
    }
});

// ===============================
// ADMIN - SEMUA USERS
// ===============================

app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
        const users = await all(`
            SELECT
                id,
                user_token,
                ip_address,
                created_at,
                last_seen
            FROM users
            ORDER BY id ASC
        `);

        res.json({
            success: true,
            users
        });

    } catch (error) {
        console.error("Gagal mengambil semua user:", error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil data semua user."
        });
    }
});

// ===============================
// ADMIN - CATATAN USER
// ===============================

app.get("/api/admin/user-notes/:token", requireAdmin, async (req, res) => {
    try {
        const notes = await all(`
            SELECT
                id,
                user_token,
                title,
                content,
                type,
                created_at,
                updated_at
            FROM notes
            WHERE user_token = ?
            ORDER BY updated_at DESC, id DESC
        `, [
            req.params.token
        ]);

        res.json({
            success: true,
            notes
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil catatan user."
        });
    }
});

// ===============================
// NOTES
// ===============================

// TAMBAH CATATAN / JURNAL
app.post("/api/notes", async (req, res) => {
    try {
        const {
            userToken,
            title,
            content,
            type
        } = req.body;

        if (!userToken) {
            return res.status(400).json({
                success: false,
                message: "User token tidak ditemukan."
            });
        }

        if (!content) {
            return res.status(400).json({
                success: false,
                message: "Isi tidak boleh kosong."
            });
        }

        const noteType =
            type === "jurnal"
                ? "jurnal"
                : "catatan";

        const user = await get(`
            SELECT id
            FROM users
            WHERE user_token = ?
        `, [
            userToken
        ]);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Pengguna tidak ditemukan."
            });
        }

        let noteTitle = title;

        if (!noteTitle || !noteTitle.trim()) {
            noteTitle =
                noteType === "jurnal"
                    ? "Jurnal Tanpa Judul"
                    : "Tanpa Judul";
        }

        const result = await run(`
            INSERT INTO notes (
                user_token,
                title,
                content,
                type,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [
            userToken,
            noteTitle,
            content,
            noteType
        ]);

        res.json({
            success: true,
            noteId: result.lastID,
            type: noteType
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal menyimpan data."
        });
    }
});

// AMBIL CATATAN / JURNAL
app.get("/api/notes/:token", async (req, res) => {
    try {
        const notes = await all(`
            SELECT
                id,
                user_token,
                title,
                content,
                type,
                created_at,
                updated_at
            FROM notes
            WHERE user_token = ?
            ORDER BY updated_at DESC, id DESC
        `, [
            req.params.token
        ]);

        res.json({
            success: true,
            notes
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil data."
        });
    }
});

// EDIT NOTE
app.put("/api/notes/:id", async (req, res) => {
    try {
        const {
            userToken,
            title,
            content
        } = req.body;

        if (!userToken) {
            return res.status(400).json({
                success: false,
                message: "User token tidak ditemukan."
            });
        }

        if (!content || !content.trim()) {
            return res.status(400).json({
                success: false,
                message: "Isi tidak boleh kosong."
            });
        }

        const result = await run(`
            UPDATE notes
            SET
                title = ?,
                content = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            AND user_token = ?
        `, [
            title || "Tanpa Judul",
            content,
            req.params.id,
            userToken
        ]);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Data tidak ditemukan."
            });
        }

        res.json({
            success: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal memperbarui data."
        });
    }
});

// HAPUS NOTE
app.delete("/api/notes/:id", async (req, res) => {
    try {
        const { userToken } = req.body;

        if (!userToken) {
            return res.status(400).json({
                success: false,
                message: "User token tidak ditemukan."
            });
        }

        const result = await run(`
            DELETE FROM notes
            WHERE id = ?
            AND user_token = ?
        `, [
            req.params.id,
            userToken
        ]);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Data tidak ditemukan."
            });
        }

        res.json({
            success: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal menghapus data."
        });
    }
});

// ===============================
// START SERVER
// ===============================

siapkanDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log("================================");
            console.log(`NotepadKita berjalan di http://localhost:${PORT}`);
            console.log("Admin security aktif.");
            console.log("IP tracking aktif.");
            console.log("================================");
        });
    })
    .catch(error => {
        console.error("Gagal menyiapkan database:", error);
        process.exit(1);
    });