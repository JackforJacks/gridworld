#!/usr/bin/env node
const storage = require('../server/services/storage');
const util = require('util');

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    const timeout = new Promise<never>((_, rej) => 
        setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
}

async function doChecks() {
    try {
        const adapter = storage.getAdapter ? storage.getAdapter() : null;
        let adapterName = 'unknown';
        try {
            if (adapter && adapter.constructor && adapter.constructor.name) adapterName = adapter.constructor.name;
            else if (adapter && adapter.client && adapter.client.constructor && adapter.client.constructor.name) adapterName = adapter.client.constructor.name;
        } catch (e) { console.warn('[checkStorage] Failed to determine adapter name:', e?.message ?? e); }

        console.log('storage.isAvailable:', storage.isAvailable());
        console.log('adapter:', adapterName);

        // Use timeouts around potentially-blocking storage calls
        try {
            const familyHash = await withTimeout(storage.hgetall('family'), 3000, 'hgetall family');
            const familyCount = familyHash ? Object.keys(familyHash).length : 0;
            console.log('familyHashCount:', familyCount);
        } catch (e) {
            console.warn('hgetall family failed or timed out:', e && e.message ? e.message : e);
        }

        try {
            const fertileMembers = await withTimeout(storage.smembers('fertile:members'), 3000, 'smembers fertile:members');
            console.log('fertile:members count:', Array.isArray(fertileMembers) ? fertileMembers.length : 0);
        } catch (e) {
            console.warn('smembers fertile:members failed or timed out:', e && e.message ? e.message : e);
        }

        try {
            const keys = await withTimeout(storage.keys('fertile:*'), 3000, 'keys fertile:*');
            console.log('fertile keys count (pattern fertile:*):', Array.isArray(keys) ? keys.length : 0);
        } catch (e) {
            console.warn('keys fertile:* failed or timed out:', e && e.message ? e.message : e);
        }
    } catch (err) {
        console.error('Storage diagnostic failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
}

// Run initial checks
doChecks();

// Re-run checks if adapter becomes ready (e.g., Redis connects after memory fallback)
try {
    if (typeof storage.on === 'function') {
        storage.on('ready', () => {
            console.log('storage event: ready — re-checking counts');
            // small delay to allow adapter.swap to settle
            setTimeout(() => doChecks(), 100);
        });
    }
} catch (e) { /* ignore */ }

