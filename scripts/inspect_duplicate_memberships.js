// Diagnostic: inspect duplicate memberships across village sets
const storage = require('../server/services/storage');

async function inspect() {
  try {
    console.log('🔍 Scanning village membership sets...');
    const keys = await storage.keys('village:*:*:people');
    console.log(`🔑 Found ${keys.length} village people sets`);

    const personMap = new Map(); // id -> Set of keys
    for (const key of keys) {
      const members = await storage.smembers(key);
      for (const m of members) {
        const id = String(m);
        if (!personMap.has(id)) personMap.set(id, new Set());
        personMap.get(id).add(key);
      }
    }

    let totalMemberships = 0;
    for (const key of keys) {
      const sc = await storage.scard(key);
      totalMemberships += Number(sc || 0);
    }

    let duplicates = [];
    for (const [id, set] of personMap.entries()) {
      if (set.size > 1) duplicates.push({ id, sets: Array.from(set), count: set.size });
    }

    duplicates.sort((a,b) => b.count - a.count);

    console.log(`📊 Total memberships (sum of set cardinalities): ${totalMemberships}`);
    console.log(`👥 Unique person IDs across sets: ${personMap.size}`);
    console.log(`⚠️ Persons in multiple sets: ${duplicates.length}`);

    if (duplicates.length > 0) {
      console.log('\nTop 20 duplicated persons:');
      for (let i = 0; i < Math.min(20, duplicates.length); i++) {
        const d = duplicates[i];
        console.log(`${i+1}. id=${d.id}, count=${d.count}, sets=${d.sets.join(', ')}`);
      }

      // For first duplicated person, show person hash residency
      const sample = duplicates[0];
      const personJson = await storage.hget('person', sample.id);
      console.log('\nSample duplicated person details from person hash:');
      console.log('person hash:', personJson);
      try {
        if (personJson) console.log('parsed:', JSON.parse(personJson));
      } catch (e) {}

      // Also show which villages their membership points to
      console.log('\nMembership count distribution for duplicated persons (first 100):');
      const counts = {};
      for (let i = 0; i < Math.min(100, duplicates.length); i++) {
        const d = duplicates[i];
        counts[d.count] = (counts[d.count] || 0) + 1;
      }
      console.log(counts);
    }

    // Also detect stale keys or unexpected patterns
    const allKeys = await storage.keys('*');
    console.log(`\nTotal keys in storage: ${allKeys.length}`);

    return { totalMemberships, uniquePersons: personMap.size, duplicatesCount: duplicates.length };
  } catch (e) {
    console.error('Diagnostic failed:', e);
    process.exit(1);
  }
}

inspect().then(res => {
  console.log('\nDone.');
  process.exit(0);
});