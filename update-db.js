
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./notepadkita.db");

db.serialize(() => {

    console.log("Memeriksa database...");

    db.all(
        "PRAGMA table_info(notes)",
        (error, columns) => {

            if (error) {

                console.error(error);

                return;
            }

            const sudahAda =
                columns.some(
                    column =>
                        column.name === "user_id"
                );

            if (sudahAda) {

                console.log(
                    "Kolom user_id sudah ada."
                );

                db.close();

                return;
            }


            console.log(
                "Menambahkan kolom user_id..."
            );


            db.run(
                `
                ALTER TABLE notes
                ADD COLUMN user_id INTEGER
                `,
                error => {

                    if (error) {

                        console.error(
                            "Gagal:",
                            error
                        );

                        return;
                    }


                    console.log(
                        "Kolom user_id berhasil ditambahkan!"
                    );


                    db.close();

                }
            );

        }
    );

});
