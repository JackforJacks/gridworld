/**
 * Test script to debug the person hash issue
 * Run this standalone to isolate the Redis behavior
 */

async function testRedisPersonHash() {
    const storage = require('./server/services/storage');
    
    // Wait for Redis to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('Storage available:', storage.isAvailable());
    
    // Clear everything first
    console.log('Flushing Redis...');
    await storage.flushdb();
    
    // Add test people
    console.log('Adding 10 test people...');
    for (let i = 1; i <= 10; i++) {
        const result = await storage.hset('person', i.toString(), JSON.stringify({ id: i, name: `Person ${i}` }));
        console.log(`  Added person ${i}, result:`, result);
    }
    
    // Check the hash
    console.log('\nChecking person hash...');
    const people = await storage.hgetall('person');
    console.log('Person count:', people ? Object.keys(people).length : 0);
    
    // List all keys
    const keys = await storage.keys('*');
    console.log('All Redis keys:', keys);
    
    // Wait 5 seconds
    console.log('\nWaiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check again
    console.log('\nChecking person hash after wait...');
    const people2 = await storage.hgetall('person');
    console.log('Person count:', people2 ? Object.keys(people2).length : 0);
    
    // List all keys again
    const keys2 = await storage.keys('*');
    console.log('All Redis keys:', keys2);
    
    console.log('\n=== TEST COMPLETE ===');
    process.exit(0);
}

testRedisPersonHash().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
