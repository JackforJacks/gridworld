/**
 * Village Seeder - Database Utilities
 * Handles database schema setup and utilities
 */

const pool = require('../../config/database');

// Ensure tiles_lands has village_id column (older DBs may miss this column)
let ensureVillageIdColumnPromise = null;

/**
 * Ensure tiles_lands table has village_id column
 */
async function ensureVillageIdColumn() {
    if (!ensureVillageIdColumnPromise) {
        ensureVillageIdColumnPromise = (async () => {
            try {
                await pool.query(`ALTER TABLE tiles_lands ADD COLUMN IF NOT EXISTS village_id INTEGER REFERENCES villages(id) ON DELETE SET NULL`);
                await pool.query(`CREATE INDEX IF NOT EXISTS idx_tiles_lands_village_id ON tiles_lands(village_id)`);
                console.log('[villageSeeder] Ensured tiles_lands.village_id column exists');
            } catch (e) {
                console.warn('[villageSeeder] Failed to ensure tiles_lands.village_id column:', e.message);
            }
        })();
    }
    return ensureVillageIdColumnPromise;
}

module.exports = {
    ensureVillageIdColumn
};
