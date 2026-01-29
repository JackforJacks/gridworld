#!/usr/bin/env node
const storage = require('../server/services/storage');
const { getFamilyStatistics } = require('../server/services/population/PopStats');
const FamilyState = require('../server/services/populationState/FamilyState');

function withTimeout(promise, ms, label) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms));
    return Promise.race([promise, timeout]);
}

async function fetchAndPrint() {
    try {
        const stats = await getFamilyStatistics();
        console.log('getFamilyStatistics result:');
        console.log(JSON.stringify(stats, null, 2));

        // If storage has 0 families but Postgres has families, try syncing
        if (stats.totalFamilies === 0 && storage.isAvailable()) {
            try {
                const famHash = await withTimeout(Promise.resolve().then(() => storage.hgetall('family')), 2000, 'hgetall family');
                const count = famHash ? Object.keys(famHash).length : 0;
                if (count === 0) {
                    console.log('No families in storage — syncing from Postgres (this may take a moment)');
                    await FamilyState.syncFromPostgres();
                    const stats2 = await getFamilyStatistics();
                    console.log('After sync — getFamilyStatistics result:');
                    console.log(JSON.stringify(stats2, null, 2));
                }
            } catch (e) {
                console.warn('Could not inspect storage family hash or sync:', e && e.message ? e.message : e);
            }
        }
    } catch (err) {
        console.error('printFamilyStats failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
}

// If storage not ready yet, wait for 'ready' event (but also time out)
if (storage.isAvailable()) {
    fetchAndPrint();
} else {
    const timeoutMs = 5000;
    let done = false;
    const timer = setTimeout(() => {
        if (!done) {
            console.warn(`storage did not become available within ${timeoutMs}ms — running fetch anyway`);
            fetchAndPrint().finally(() => process.exit());
        }
    }, timeoutMs);

    if (typeof storage.on === 'function') {
        storage.on('ready', async () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            await fetchAndPrint();
            process.exit();
        });
    } else {
        // Fallback: try after short delay
        setTimeout(async () => { await fetchAndPrint(); process.exit(); }, 1000);
    }
}

