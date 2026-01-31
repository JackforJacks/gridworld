#!/usr/bin/env node
const storage = require('../server/services/storage');

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    const timeout = new Promise<never>((_, rej) => 
        setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)
    );
    return Promise.race([promise, timeout]);
}

(async function run() {
    try {
        console.log('storage.isAvailable:', storage.isAvailable());
        const counts = await withTimeout(storage.hgetall('counts:global'), 3000, 'hgetall counts');
        console.log('counts:global:', counts || {});

        let personHash = {};
        try {
            personHash = await withTimeout(storage.hgetall('person'), 5000, 'hgetall person');
        } catch (e) {
            console.warn('hgetall person failed or timed out:', e.message || e);
        }

        const ids = Object.keys(personHash || {});
        console.log('person count in storage:', ids.length);

        // Sample up to 10 people and print DOB and family_id
        const sample = ids.slice(0, 10).map(id => {
            try { return JSON.parse(personHash[id]); } catch { return null; }
        }).filter(Boolean);

        console.log('Sample people (id, date_of_birth, family_id, sex):');
        for (const p of sample) {
            console.log({ id: p.id, date_of_birth: p.date_of_birth, family_id: p.family_id, sex: p.sex });
        }

        // Count how many have non-null DOB
        let dobCount = 0;
        for (const v of Object.values(personHash || {})) {
            try {
                const p = JSON.parse(v);
                if (p && p.date_of_birth) dobCount++;
            } catch (e) { console.warn('[checkPeople] Failed to parse person:', e?.message ?? e); }
        }
        console.log('people with non-null date_of_birth:', dobCount);
    } catch (err) {
        console.error('checkPeople failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
})();
