const PopulationService = require('../server/services/PopulationService');
const pool = require('../server/config/database');

async function main() {
    const svc = new PopulationService(null, null);
    try {
        console.log('Resetting population...');
        await svc.resetPopulation();
        const habitableRows = await pool.query('SELECT id FROM tiles WHERE is_habitable = TRUE');
        const habitableIds = habitableRows.rows.map(r => r.id);
        console.log('Habitable tiles:', habitableIds.length);
        const res = await svc.initializeTilePopulations(habitableIds);
        console.log('Init result:', res);
        // Also report total villages and populated tiles
        const villageRows = await pool.query('SELECT COUNT(*) as count FROM villages');
        console.log('Total Villages:', parseInt(villageRows.rows[0].count, 10));
        const populated = await require('../server/services/populationState/PeopleState').getAllTilePopulations();
        console.log('Populated Tiles (storage) count:', Object.keys(populated).length);

        // Also check Postgres people -> show how many tiles persisted
        try {
            const byTile = await pool.query('SELECT tile_id, COUNT(*) AS c FROM people WHERE tile_id IS NOT NULL GROUP BY tile_id');
            console.log('Persisted populated tiles (Postgres):', byTile.rows.length);
            if (byTile.rows.length > 0) console.log('Sample persisted tile counts:', byTile.rows.slice(0, 5));
        } catch (err) {
            console.warn('Could not query Postgres people table:', err.message || err);
        }
    } catch (e) {
        console.error('Error during repro:', e);
    } finally {
        process.exit(0);
    }
}

main();