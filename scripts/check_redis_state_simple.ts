// Check Redis state
import Redis from 'ioredis';

const redis = new Redis();

async function main() {
    // Check ID counters
    const nextPersonId = await redis.get('next:person:id');
    const nextFamilyId = await redis.get('next:family:id');
    const nextVillageId = await redis.get('next:village:id');
    
    console.log('ID Counters:');
    console.log('  next:person:id =', nextPersonId);
    console.log('  next:family:id =', nextFamilyId);
    console.log('  next:village:id =', nextVillageId);
    
    // Check tile:populations
    const tilePops = await redis.hgetall('tile:populations');
    console.log('\nTile populations count:', Object.keys(tilePops || {}).length);
    if (Object.keys(tilePops || {}).length > 0) {
        for (const [tid, pop] of Object.entries(tilePops).slice(0, 10)) {
            console.log('  Tile', tid, '=', pop);
        }
    }
    
    // Count people
    const people = await redis.hgetall('person');
    console.log('\nPeople count:', Object.keys(people || {}).length);
    
    // Count villages 
    const villages = await redis.hgetall('village');
    console.log('Villages count:', Object.keys(villages || {}).length);
    
    // Check if tiles 165 and 675 have populations
    console.log('\nTile 165 population:', tilePops?.['165'] || 'none');
    console.log('Tile 675 population:', tilePops?.['675'] || 'none');
    
    await redis.quit();
}

main().catch(console.error);
