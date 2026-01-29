const storage = require('../server/services/storage');
const PopulationState = require('../server/services/populationState');
const pool = require('../server/config/database');

async function testSaveFlow() {
    console.log('Waiting for storage to be ready...');
    await new Promise(r => setTimeout(r, 1500));
    
    console.log('\n=== CURRENT STATE ===');
    
    // Check Redis state
    const people = await storage.hgetall('person');
    const villages = await storage.hgetall('village');
    const families = await storage.hgetall('family');
    const pendingPersonInserts = await storage.smembers('pending:person:inserts');
    const pendingVillageInserts = await storage.smembers('pending:village:inserts');
    const pendingFamilyInserts = await storage.smembers('pending:family:inserts');
    const tilesRegen = await storage.sismember('pending:tiles:regenerate', 'true');
    
    console.log('Redis:');
    console.log('  - People:', Object.keys(people || {}).length);
    console.log('  - Villages:', Object.keys(villages || {}).length);
    console.log('  - Families:', Object.keys(families || {}).length);
    console.log('  - Pending person inserts:', pendingPersonInserts?.length || 0);
    console.log('  - Pending village inserts:', pendingVillageInserts?.length || 0);
    console.log('  - Pending family inserts:', pendingFamilyInserts?.length || 0);
    console.log('  - Tiles regenerate flag:', tilesRegen);
    
    // Check Postgres state
    const pgPeople = await pool.query('SELECT COUNT(*) FROM people');
    const pgVillages = await pool.query('SELECT COUNT(*) FROM villages');
    const pgFamilies = await pool.query('SELECT COUNT(*) FROM family');
    const pgTiles = await pool.query('SELECT COUNT(*) FROM tiles');
    
    console.log('Postgres:');
    console.log('  - People:', pgPeople.rows[0].count);
    console.log('  - Villages:', pgVillages.rows[0].count);
    console.log('  - Families:', pgFamilies.rows[0].count);
    console.log('  - Tiles:', pgTiles.rows[0].count);
    
    process.exit(0);
}

testSaveFlow().catch(e => {
    console.error(e);
    process.exit(1);
});
