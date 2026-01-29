const PopulationState = require('../server/services/populationState/PeopleState');
const villageSeeder = require('../server/services/villageSeeder/redisSeeding');
const { inspect } = require('./inspect_duplicate_memberships');

async function main() {
    // Create 200 people on tile 230 with residency 0
    const people = [];
    for (let i = 0; i < 200; i++) {
        const id = String(-1000 - i); // temp negative ids
        const p = { id: id, tile_id: 230, residency: 0, sex: i % 2 === 0, date_of_birth: '3950-01-01' };
        people.push(p);
    }
    // Add to storage
    for (const p of people) await PopulationState.addPerson(p, true);
    console.log('Added people to storage');

    // Run village seeding storage-first
    const res = await villageSeeder.seedVillagesStorageFirst();
    console.log('Seeded villages:', res.created);

    // Run inspect
    const inspectRes = await require('./inspect_duplicate_memberships').inspect();
    console.log('Inspect result:', inspectRes);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });