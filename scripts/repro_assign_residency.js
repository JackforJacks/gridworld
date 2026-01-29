const PopulationState = require('../server/services/populationState/PeopleState');
const { assignResidencyStorage } = require('../server/services/villageSeeder/redisSeeding');

async function main() {
    // Add 200 people to tile 230 with residency 0
    for (let i = 0; i < 200; i++) {
        const id = String(-2000 - i);
        const p = { id: id, tile_id: 230, residency: 0, sex: i % 2 === 0, date_of_birth: '3950-01-01' };
        await PopulationState.addPerson(p, true);
    }
    console.log('Added 200 people on tile 230 residency 0');

    // Create two villages on tile 230 with different land_chunk_index
    const villages = [{ id: -1, tile_id: 230, land_chunk_index: 0, housing_capacity: 100, housing_slots: [] }, { id: -2, tile_id: 230, land_chunk_index: 3, housing_capacity: 100, housing_slots: [] }];

    const res = await assignResidencyStorage([230], villages);
    console.log('assignResidencyStorage finished');

    // Inspect duplicates
    const inspect = require('./inspect_duplicate_memberships');
    await inspect.inspect();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });