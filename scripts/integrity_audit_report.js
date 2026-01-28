const storage = require('../server/services/storage');

async function run() {
    if (!storage.isAvailable()) {
        console.error('Storage (Redis) is not available. Aborting.');
        process.exit(1);
    }

    console.log('Scanning village membership keys...');
    const keys = await storage.keys('village:*:*:people');
    console.log(`Found ${keys.length} membership keys`);

    const tileMap = new Map(); // tileId -> { totalMemberships, membersSet, byResidency }

    for (const k of keys) {
        // k = village:<tile>:<residency>:people
        const parts = k.split(':');
        if (parts.length < 4) continue;
        const tile = parts[1];
        const residency = parts[2];
        const members = await storage.smembers(k);

        if (!tileMap.has(tile)) {
            tileMap.set(tile, { totalMemberships: 0, membersSet: new Set(), byResidency: {} });
        }
        const rec = tileMap.get(tile);
        rec.totalMemberships += members.length;
        for (const m of members) rec.membersSet.add(m);
        rec.byResidency[residency] = (rec.byResidency[residency] || 0) + members.length;
    }

    // Summarize
    const summary = [];
    let overallMemberships = 0;
    let overallUnique = new Set();

    for (const [tile, rec] of tileMap.entries()) {
        const uniqueCount = rec.membersSet.size;
        const duplicates = rec.totalMemberships - uniqueCount;
        overallMemberships += rec.totalMemberships;
        for (const id of rec.membersSet) overallUnique.add(id);
        summary.push({ tile: Number(tile), totalMemberships: rec.totalMemberships, uniqueCount, duplicates, duplicateRatio: rec.totalMemberships ? duplicates / rec.totalMemberships : 0, byResidency: rec.byResidency });
    }

    summary.sort((a, b) => b.duplicates - a.duplicates);

    console.log('\n=== Overall ===');
    console.log(`Total tiles with membership keys: ${summary.length}`);
    console.log(`Total memberships: ${overallMemberships}`);
    console.log(`Total unique persons across memberships: ${overallUnique.size}`);
    console.log(`Total duplicate memberships: ${overallMemberships - overallUnique.size}`);

    const TOP = 20;
    console.log(`\n=== Top ${TOP} tiles by duplicate count ===`);
    for (let i = 0; i < Math.min(TOP, summary.length); i++) {
        const s = summary[i];
        console.log(`#${i + 1} Tile ${s.tile}: memberships=${s.totalMemberships}, unique=${s.uniqueCount}, duplicates=${s.duplicates}, ratio=${(s.duplicateRatio * 100).toFixed(2)}%`);
        console.log('   byResidency:', s.byResidency);
    }

    summary.sort((a, b) => b.duplicateRatio - a.duplicateRatio);
    console.log(`\n=== Top ${TOP} tiles by duplicate ratio ===`);
    for (let i = 0; i < Math.min(TOP, summary.length); i++) {
        const s = summary[i];
        console.log(`#${i + 1} Tile ${s.tile}: memberships=${s.totalMemberships}, unique=${s.uniqueCount}, duplicates=${s.duplicates}, ratio=${(s.duplicateRatio * 100).toFixed(2)}%`);
    }

    process.exit(0);
}

run().catch(err => { console.error('Audit failed:', err); process.exit(1); });
