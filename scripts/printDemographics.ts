#!/usr/bin/env node
const pool = require('../server/config/database');
const { getPopulationStats } = require('../server/services/population/PopStats');

(async function run() {
    try {
        const stats = await getPopulationStats(pool, null, null);
        console.log('Demographic stats:');
        console.log(JSON.stringify(stats, null, 2));
    } catch (err) {
        console.error('printDemographics failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    } finally {
        try { await pool.end(); } catch (_) { }
    }
})();
