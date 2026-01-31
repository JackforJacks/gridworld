#!/usr/bin/env node
const storage = require('../server/services/storage');

async function scanKeys(pattern) {
    const keys = [];
    const stream = storage.scanStream({ match: pattern, count: 1000 });
    for await (const batch of stream) {
        for (const k of batch) keys.push(k);
    }
    return keys;
}

async function doRebuild() {
    try {
        console.log('storage.isAvailable:', storage.isAvailable());

        // 1) collect and delete existing village membership sets
        console.log('Scanning for existing village membership sets...');
        const existing = await scanKeys('village:*:*:people');
        console.log('Found', existing.length, 'village membership keys');
        if (existing.length > 0) {
            // delete in chunks
            for (let i = 0; i < existing.length; i += 500) {
                const chunk = existing.slice(i, i + 500);
                await storage.del(...chunk);
            }
            console.log('Deleted existing village membership keys');
        }

        // 2) rebuild from person hash
        console.log('Loading person hash to rebuild sets...');
        const persons = await storage.hgetall('person') || {};
        const ids = Object.keys(persons);
        console.log('Person entries found:', ids.length);

        let added = 0;
        // Use pipelines in batches to reduce roundtrips
        const batchSize = 1000;
        for (let i = 0; i < ids.length; i += batchSize) {
            const chunk = ids.slice(i, i + batchSize);
            const pipeline = storage.pipeline();
            for (const id of chunk) {
                try {
                    const p = JSON.parse(persons[id]);
                    if (p && p.tile_id && p.residency !== null && p.residency !== undefined) {
                        const key = `village:${p.tile_id}:${p.residency}:people`;
                        pipeline.sadd(key, String(p.id));
                        added++;
                    }
                } catch (e) { console.warn('[rebuildVillageSets] Failed to parse person:', id, e?.message ?? e); }
            }
            await pipeline.exec();
        }

        console.log('Rebuilt village membership sets, total memberships added (approx):', added);

        // 3) recompute counts:global (total, male, female)
        let total = 0, male = 0, female = 0;
        for (const id of ids) {
            try {
                const p = JSON.parse(persons[id]);
                total++;
                if (p.sex === true) male++;
                else if (p.sex === false) female++;
            } catch (e) { console.warn('[rebuildVillageSets] Failed to parse person for counts:', id, e?.message ?? e); }
        }
        await storage.hset('counts:global', 'total', String(total));
        await storage.hset('counts:global', 'male', String(male));
        await storage.hset('counts:global', 'female', String(female));
        console.log('Recomputed counts:global ->', { total, male, female });

        console.log('Done.');
    } catch (err) {
        console.error('rebuildVillageSets failed:', err && err.message ? err.message : err);
        process.exitCode = 2;
    }
}

// Determine adapter and wait for Redis-ready if needed
try {
    const adapter = storage.getAdapter ? storage.getAdapter() : null;
    let adapterName = 'unknown';
    try {
        if (adapter && adapter.constructor && adapter.constructor.name) adapterName = adapter.constructor.name;
        else if (adapter && adapter.client && adapter.client.constructor && adapter.client.constructor.name) adapterName = adapter.client.constructor.name;
    } catch (e) { console.warn('[rebuildVillageSets] Failed to determine adapter name:', e?.message ?? e); }

    if (adapterName && adapterName.toLowerCase().includes('memory')) {
        console.log('Current adapter appears to be MemoryAdapter — waiting for Redis ready event before rebuilding (timeout 10s)');
        let ran = false;
        const timer = setTimeout(async () => {
            if (!ran) {
                console.warn('Timed out waiting for Redis ready — proceeding with current adapter');
                ran = true;
                await doRebuild();
            }
        }, 10000);

        if (typeof storage.on === 'function') {
            storage.on('ready', async () => {
                if (ran) return;
                ran = true;
                clearTimeout(timer);
                console.log('storage ready event received — running rebuild against Redis');
                await doRebuild();
            });
        }
    } else {
        // Adapter is likely Redis or already ready
        doRebuild();
    }
} catch (e) {
    // Fallback: just run
    doRebuild();
}
