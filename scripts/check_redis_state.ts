const storage = require('../server/services/storage');
const PopulationState = require('../server/services/populationState');

async function check() {
    await new Promise(r => setTimeout(r, 1000)); // wait for storage
    if (!storage.isAvailable()) {
        console.log('Storage not available');
        process.exit(1);
    }

    const inserts = await storage.smembers('pending:person:inserts');
    const deletes = await storage.smembers('pending:person:deletes');
    const personHash = await storage.hgetall('person');
    const personCount = personHash ? Object.keys(personHash).length : 0;
    const globalCounts = await storage.hgetall('counts:global');

    console.log('pending:person:inserts count:', inserts.length);
    console.log('pending:person:deletes count:', deletes.length);
    console.log('person hash count:', personCount);
    console.log('counts:global:', globalCounts);

    if (personCount > 0) {
        const sampleIds = Object.keys(personHash).slice(0, 5);
        console.log('Sample person IDs:', sampleIds);
        for (const id of sampleIds) {
            const person = JSON.parse(personHash[id]);
            console.log('  Person', id, ':', { tile_id: person.tile_id, residency: person.residency, _isNew: person._isNew });
        }
    }

    // Check village membership sets
    const keys = await storage.keys('village:*:*:people');
    console.log('Village membership set keys:', keys.length);
    for (const key of keys.slice(0, 5)) {
        const members = await storage.smembers(key);
        console.log(' ', key, ':', members.length, 'members');
    }

    process.exit(0);
}

check().catch(console.error);
