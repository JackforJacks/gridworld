const storage = require('../server/services/storage');

async function run() {
  const tileId = process.argv[2] ? Number(process.argv[2]) : 475;
  console.log(`Checking duplicates for tile ${tileId}...`);
  if (!storage.isAvailable()) {
    console.warn('Redis not available; cannot run duplicate check');
    process.exit(1);
  }

  try {
    const keys = await storage.keys(`village:${tileId}:*:people`);
    if (keys.length === 0) {
      console.log('No village membership keys for this tile');
      process.exit(0);
    }

    const idMap = new Map(); // id -> Set of residency keys

    const pipeline = storage.pipeline();
    for (const k of keys) pipeline.smembers(k);
    const results = await pipeline.exec();

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const parts = k.split(':');
      const residency = parts[2];
      const [err, members] = results[i];
      if (err || !Array.isArray(members)) continue;
      for (const id of members) {
        if (!idMap.has(id)) idMap.set(id, new Set());
        idMap.get(id).add(residency);
      }
    }

    const dupes = [];
    for (const [id, set] of idMap.entries()) {
      if (set.size > 1) dupes.push({ id, residencies: Array.from(set) });
    }

    console.log(`Found ${dupes.length} duplicated person IDs out of ${idMap.size} unique persons`);
    if (dupes.length > 0) {
      console.log('Sample duplicates (up to 20):', dupes.slice(0, 20));
    }

    process.exit(0);
  } catch (err) {
    console.error('Duplicate check failed:', err.message || err);
    process.exit(1);
  }
}

run();