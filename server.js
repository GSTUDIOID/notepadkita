
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./notepadkita.db");


// ======================================
// MEMBUAT / MEMPERBARUI TABEL DATABASE
// ======================================

db.serialize(() => {

    // ==================================
    // TABEL PENGGUNA
    // ==================================

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_token TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);


    // ==================================
    // TABEL CATATAN
    // ==================================

    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            title TEXT NOT NULL,

            content TEXT NOT NULL,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (user_id)
                REFERENCES users(id)
        )
    `);


    // ==================================
    // TAMBAHKAN LAST_SEEN
    // ==================================

    db.all(
        `PRAGMA table_info(users)`,
        (error, columns) => {

            if (error) {

                console.error(
                    "Gagal memeriksa tabel users:",
                    error
                );

                return;
            }


            const hasLastSeen =
                columns.some(
                    column =>
                        column.name === "last_seen"
                );


            if (!hasLastSeen) {

                db.run(`
                    ALTER TABLE users
                    ADD COLUMN last_seen DATETIME
                `,

                error => {

                    if (error) {

                        console.error(
                            "Gagal menambahkan last_seen:",
                            error
                        );

                    } else {

                        console.log(
                            "Kolom last_seen berhasil ditambahkan."
                        );

                    }

                });

            }

        }
    );

});


// ======================================
// MEMBUAT USER OTOMATIS
// ======================================

app.post("/api/users", (req, res) => {

    const userToken =
        crypto.randomBytes(32).toString("hex");


    db.run(
        `
        INSERT INTO users
        (
            user_token,
            last_seen
        )

        VALUES
        (
            ?,
            CURRENT_TIMESTAMP
        )
        `,
        [userToken],

        function(error) {

            if (error) {

                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "Gagal membuat pengguna."
                });

            }


            res.json({

                success: true,

                userId:
                    this.lastID,

                userToken:
                    userToken

            });

        }
    );

});


// ======================================
// MEMERIKSA USER
// ======================================

app.get("/api/users/:token", (req, res) => {

    const token =
        req.params.token;


    db.get(
        `
        SELECT id
        FROM users
        WHERE user_token = ?
        `,
        [token],

        (error, user) => {

            if (error) {

                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "Gagal memeriksa pengguna."
                });

            }


            if (!user) {

                return res.status(404).json({
                    success: false,
                    message: "Pengguna tidak ditemukan."
                });

            }


            // Perbarui aktivitas user

            db.run(
                `
                UPDATE users

                SET last_seen = CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [user.id]
            );


            res.json({

                success: true,

                userId:
                    user.id

            });

        }
    );

});


// ======================================
// HEARTBEAT USER
// ======================================
//
// Frontend akan memanggil endpoint ini
// secara berkala agar server tahu bahwa
// user masih aktif.
//

app.post(
    "/api/users/:token/heartbeat",
    (req, res) => {

        const token =
            req.params.token;


        db.run(
            `
            UPDATE users

            SET last_seen = CURRENT_TIMESTAMP

            WHERE user_token = ?
            `,
            [token],

            function(error) {

                if (error) {

                    console.error(error);

                    return res.status(500).json({

                        success: false,

                        message:
                            "Gagal memperbarui status pengguna."

                    });

                }


                if (this.changes === 0) {

                    return res.status(404).json({

                        success: false,

                        message:
                            "Pengguna tidak ditemukan."

                    });

                }


                res.json({

                    success: true

                });

            }
        );

    }
);


// ======================================
// ADMIN:
// MENGAMBIL USER YANG SEDANG ONLINE
// ======================================
//
// User dianggap online jika aktivitas
// terakhir kurang dari 60 detik.
//

app.get(
    "/api/admin/online-users",
    (req, res) => {

        const ONLINE_SECONDS = 60;


        db.all(
            `
            SELECT
                id,
                created_at,
                last_seen

            FROM users

            ORDER BY
                last_seen DESC
            `,

            (error, rows) => {

                if (error) {

                    console.error(error);

                    return res.status(500).json({

                        success: false,

                        message:
                            "Gagal mengambil pengguna."

                    });

                }


                const now =
                    Date.now();


                const onlineUsers =
                    rows
                        .filter(user => {

                            if (!user.last_seen) {

                                return false;

                            }


                            const lastSeen =
                                new Date(
                                    user.last_seen +
                                    " UTC"
                                ).getTime();


                            const difference =
                                now - lastSeen;


                            return (
                                difference <=
                                ONLINE_SECONDS * 1000
                            );

                        })
                        .map(user => ({

                            username:
                                `User #${user.id}`,

                            userId:
                                user.id,

                            lastSeen:
                                user.last_seen

                        }));


                res.json({

                    success: true,

                    onlineCount:
                        onlineUsers.length,

                    totalCount:
                        rows.length,

                    users:
                        onlineUsers

                });

            }
        );

    }
);


// ======================================
// SIMPAN CATATAN
// ======================================

app.post("/api/notes", (req, res) => {

    const {
        userToken,
        title,
        content
    } = req.body;


    if (!userToken) {

        return res.status(401).json({
            success: false,
            message: "Pengguna belum terdaftar."
        });

    }


    if (!content || content.trim() === "") {

        return res.status(400).json({
            success: false,
            message: "Catatan tidak boleh kosong."
        });

    }


    if (content.length > 1000) {

        return res.status(400).json({
            success: false,
            message:
                "Catatan maksimal 1000 karakter."
        });

    }


    db.get(
        `
        SELECT id
        FROM users
        WHERE user_token = ?
        `,
        [userToken],

        (error, user) => {

            if (error) {

                console.error(error);

                return res.status(500).json({
                    success: false,
                    message:
                        "Gagal memeriksa pengguna."
                });

            }


            if (!user) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Pengguna tidak ditemukan."
                });

            }


            // User aktif

            db.run(
                `
                UPDATE users

                SET last_seen =
                    CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [user.id]
            );


            const noteTitle =
                title && title.trim()
                    ? title.trim()
                    : "Tanpa Judul";


            db.run(
                `
                INSERT INTO notes
                (
                    user_id,
                    title,
                    content
                )

                VALUES (?, ?, ?)
                `,
                [
                    user.id,
                    noteTitle,
                    content.trim()
                ],

                function(error) {

                    if (error) {

                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            message:
                                "Gagal menyimpan catatan."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Catatan berhasil disimpan.",

                        id:
                            this.lastID

                    });

                }
            );

        }
    );

});


// ======================================
// MENGAMBIL CATATAN USER
// ======================================

app.get("/api/notes/:token", (req, res) => {

    const token =
        req.params.token;


    db.get(
        `
        SELECT id
        FROM users
        WHERE user_token = ?
        `,
        [token],

        (error, user) => {

            if (error) {

                console.error(error);

                return res.status(500).json({
                    success: false,
                    message:
                        "Gagal memeriksa pengguna."
                });

            }


            if (!user) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Pengguna tidak ditemukan."
                });

            }


            // User aktif

            db.run(
                `
                UPDATE users

                SET last_seen =
                    CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [user.id]
            );


            db.all(
                `
                SELECT
                    id,
                    title,
                    content,
                    created_at,
                    updated_at

                FROM notes

                WHERE user_id = ?

                ORDER BY updated_at DESC
                `,
                [user.id],

                (error, rows) => {

                    if (error) {

                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            message:
                                "Gagal mengambil catatan."
                        });

                    }


                    res.json({

                        success: true,

                        notes:
                            rows

                    });

                }
            );

        }
    );

});


// ======================================
// EDIT CATATAN
// ======================================

app.put("/api/notes/:id", (req, res) => {

    const {
        userToken,
        title,
        content
    } = req.body;


    const noteId =
        req.params.id;


    if (!userToken) {

        return res.status(401).json({
            success: false,
            message:
                "Pengguna tidak ditemukan."
        });

    }


    if (!content || content.trim() === "") {

        return res.status(400).json({
            success: false,
            message:
                "Catatan tidak boleh kosong."
        });

    }


    if (content.length > 1000) {

        return res.status(400).json({
            success: false,
            message:
                "Catatan maksimal 1000 karakter."
        });

    }


    db.get(
        `
        SELECT id
        FROM users
        WHERE user_token = ?
        `,
        [userToken],

        (error, user) => {

            if (error || !user) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Pengguna tidak ditemukan."
                });

            }


            // User aktif

            db.run(
                `
                UPDATE users

                SET last_seen =
                    CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [user.id]
            );


            const noteTitle =
                title && title.trim()
                    ? title.trim()
                    : "Tanpa Judul";


            db.run(
                `
                UPDATE notes

                SET
                    title = ?,
                    content = ?,
                    updated_at =
                        CURRENT_TIMESTAMP

                WHERE
                    id = ?
                    AND user_id = ?
                `,
                [
                    noteTitle,
                    content.trim(),
                    noteId,
                    user.id
                ],

                function(error) {

                    if (error) {

                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            message:
                                "Gagal mengedit catatan."
                        });

                    }


                    if (this.changes === 0) {

                        return res.status(404).json({
                            success: false,
                            message:
                                "Catatan tidak ditemukan."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Catatan berhasil diperbarui."

                    });

                }
            );

        }
    );

});


// ======================================
// HAPUS CATATAN
// ======================================

app.delete("/api/notes/:id", (req, res) => {

    const {
        userToken
    } = req.body;


    const noteId =
        req.params.id;


    if (!userToken) {

        return res.status(401).json({
            success: false,
            message:
                "Pengguna tidak ditemukan."
        });

    }


    db.get(
        `
        SELECT id
        FROM users
        WHERE user_token = ?
        `,
        [userToken],

        (error, user) => {

            if (error || !user) {

                return res.status(401).json({
                    success: false,
                    message:
                        "Pengguna tidak ditemukan."
                });

            }


            // User aktif

            db.run(
                `
                UPDATE users

                SET last_seen =
                    CURRENT_TIMESTAMP

                WHERE id = ?
                `,
                [user.id]
            );


            db.run(
                `
                DELETE FROM notes

                WHERE
                    id = ?
                    AND user_id = ?
                `,
                [
                    noteId,
                    user.id
                ],

                function(error) {

                    if (error) {

                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            message:
                                "Gagal menghapus catatan."
                        });

                    }


                    if (this.changes === 0) {

                        return res.status(404).json({
                            success: false,
                            message:
                                "Catatan tidak ditemukan."
                        });

                    }


                    res.json({

                        success: true,

                        message:
                            "Catatan berhasil dihapus."

                    });

                }
            );

        }
    );

});


// ======================================
// MENJALANKAN SERVER
// ======================================

app.listen(PORT, () => {

    console.log(
        `NotepadKita berjalan di http://localhost:${PORT}`
    );

});
