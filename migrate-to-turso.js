require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@libsql/client');

if (!process.env.DATABASE_URL || !process.env.DATABASE_AUTH_TOKEN) {
    console.error('ERROR: DATABASE_URL and DATABASE_AUTH_TOKEN must be specified in the .env file.');
    process.exit(1);
}

const localDb = new sqlite3.Database('./database.db');
const tursoClient = createClient({
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_AUTH_TOKEN
});

async function migrate() {
    console.log('================================================================');
    console.log('🚀 Starting CCS Sit-in Database Migration to Turso Cloud...');
    console.log('Target URL:', process.env.DATABASE_URL);
    console.log('================================================================');

    const tables = [
        'users',
        'sessions',
        'sit_in_records',
        'feedbacks',
        'reservations',
        'notifications',
        'lab_software',
        'system_settings'
    ];

    try {
        for (const table of tables) {
            console.log(`\n📦 Migrating table: [${table}]`);

            // 1. Fetch all rows from local database
            const rows = await new Promise((resolve, reject) => {
                localDb.all(`SELECT * FROM ${table}`, [], (err, res) => {
                    if (err) reject(err);
                    else resolve(res);
                });
            });

            console.log(`   - Local DB Rows: ${rows.length}`);

            if (rows.length === 0) {
                console.log(`   - Skipping (table is empty).`);
                continue;
            }

            // 2. Clear existing/seeded data in Turso for this table to prevent duplicates
            try {
                await tursoClient.execute(`DELETE FROM ${table}`);
                console.log(`   - Cleared existing cloud rows in Turso.`);
            } catch (err) {
                console.log(`   - Table may not exist yet in cloud. Initializing schema...`);
            }

            // 3. Perform batch inserts
            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => '?').join(', ');
            const insertSql = `INSERT INTO ${table} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;

            // Chunk inserts in sizes of 50 to fit HTTP payload limits comfortably
            const chunkSize = 50;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                const statements = chunk.map(row => {
                    const args = columns.map(col => row[col]);
                    return {
                        sql: insertSql,
                        args: args
                    };
                });

                await tursoClient.batch(statements);
                console.log(`   - Progress: ${Math.min(i + chunkSize, rows.length)}/${rows.length} rows migrated.`);
            }

            console.log(`   - Table [${table}] migrated successfully! ✅`);
        }

        console.log('\n================================================================');
        console.log('🎉 DATABASE MIGRATION TO TURSO CLOUD COMPLETED SUCCESSFULLY! 🚀');
        console.log('================================================================');

    } catch (error) {
        console.error('\n❌ Migration failed with error:', error.message || error);
    } finally {
        localDb.close();
    }
}

migrate();
