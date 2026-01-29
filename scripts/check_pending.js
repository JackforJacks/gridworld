const pool = require('../server/config/database');
const storage = require('../server/services/storage');

async function check() {
    await new Promise(r => setTimeout(r, 1000)); // wait for storage

    if (!storage.isAvailable()) {
        console.log('Storage not available');
        process.exit(1);
    }

    const inserts = await storage.smembers('pending:person:inserts');
    const deletes = await storage.smembers('pending:person:deletes');

    console.log('pending:person:inserts count:', inserts.length);
    console.log('pending:person:deletes count:', deletes.length);

    if (inserts.length > 0) {
        console.log('Sample insert IDs:', inserts.slice(0, 10));
    }

    if (deletes.length > 0) {
        console.log('Sample delete IDs:', deletes.slice(0, 10));
    }

    process.exit(0);
}

check().catch(console.error);
