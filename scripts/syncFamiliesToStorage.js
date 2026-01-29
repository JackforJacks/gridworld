#!/usr/bin/env node
const FamilyState = require('../server/services/populationState/FamilyState');

(async function run() {
    try {
        console.log('Starting FamilyState.syncFromPostgres()...');
        const res = await FamilyState.syncFromPostgres();
        console.log('syncFromPostgres result:', res);
        if (res && res.total != null) console.log('Families synced:', res.total);
    } catch (err) {
        console.error('syncFamiliesToStorage failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
})();
