#!/usr/bin/env node
const StateManager = require('../server/services/stateManager');

(async function run() {
    try {
        console.log('Starting full StateManager.loadFromDatabase() (bincode -> Redis)');
        const res = await StateManager.loadFromDatabase();
        console.log('StateManager.loadFromDatabase result:', res);
    } catch (err) {
        console.error('fullSyncStorage failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
})();
