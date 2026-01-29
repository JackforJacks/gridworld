/**
 * Debug script to trace the save flow and identify where population is being lost
 * Run this separately from the server to inspect Redis state
 */

const storage = require('../server/services/storage');

async function debugSaveFlow() {
    console.log('=== Debug Save Flow ===\n');
    
    // Wait for storage to be ready
    if (!storage.isAvailable()) {
        console.log('Waiting for storage...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log('Storage available:', storage.isAvailable());
    
    // Check all keys
    try {
        const keys = await storage.keys('*');
        console.log('\nAll Redis keys:', keys);
    } catch (e) {
        console.log('Could not get keys:', e.message);
    }
    
    // Check person hash
    try {
        const people = await storage.hgetall('person');
        const personCount = people ? Object.keys(people).length : 0;
        console.log('\nPerson hash count:', personCount);
        if (personCount > 0 && personCount <= 5) {
            console.log('Sample people:', Object.entries(people).slice(0, 3));
        }
    } catch (e) {
        console.log('Could not get person hash:', e.message);
    }
    
    // Check village hash
    try {
        const villages = await storage.hgetall('village');
        const villageCount = villages ? Object.keys(villages).length : 0;
        console.log('\nVillage hash count:', villageCount);
    } catch (e) {
        console.log('Could not get village hash:', e.message);
    }
    
    // Check tile hash
    try {
        const tiles = await storage.hgetall('tile');
        const tileCount = tiles ? Object.keys(tiles).length : 0;
        console.log('\nTile hash count:', tileCount);
    } catch (e) {
        console.log('Could not get tile hash:', e.message);
    }
    
    // Check family hash
    try {
        const families = await storage.hgetall('family');
        const familyCount = families ? Object.keys(families).length : 0;
        console.log('\nFamily hash count:', familyCount);
    } catch (e) {
        console.log('Could not get family hash:', e.message);
    }
    
    // Check pending sets
    try {
        const pendingPeople = await storage.smembers('pending:person:inserts');
        console.log('\nPending person inserts:', pendingPeople ? pendingPeople.length : 0);
    } catch (e) {
        console.log('Could not get pending person inserts:', e.message);
    }
    
    console.log('\n=== End Debug ===');
    process.exit(0);
}

debugSaveFlow().catch(err => {
    console.error('Debug failed:', err);
    process.exit(1);
});
