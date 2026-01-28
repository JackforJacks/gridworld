const pool = require('../server/config/database');
const storage = require('../server/services/storage');

async function run() {
  const tileId = process.argv[2] ? Number(process.argv[2]) : 974;
  console.log(`Checking tile ${tileId}...`);
  try {
    const villages = await pool.query('SELECT id, name, housing_capacity, housing_slots FROM villages WHERE tile_id = $1 ORDER BY id', [tileId]);
    console.log('Villages on tile:', villages.rows.length);
    villages.rows.forEach(v => {
      const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : 0;
      console.log(`  Village ${v.id}: ${occ}/${v.housing_capacity} housing`);
    });

    const peopleCount = await pool.query('SELECT COUNT(*) as count FROM people WHERE tile_id = $1', [tileId]);
    console.log('People in Postgres on tile:', peopleCount.rows[0].count);

    const sample = await pool.query('SELECT id, residency, family_id, date_of_birth, sex FROM people WHERE tile_id = $1 LIMIT 20', [tileId]);
    console.log('People sample (up to 20):', sample.rows.length);

    // Redis checks
    if (!storage.isAvailable()) {
      console.warn('Redis/storage not available; skipping Redis checks');
    } else {
      const keys = await storage.keys(`village:${tileId}:*:people`);
      console.log('Redis keys matching village:<tile>:*:people:', keys.length);
      let totalMemberships = 0;
      const members = [];
      for (const k of keys) {
        const arr = await storage.smembers(k);
        console.log(`  ${k}: ${arr.length} members`);
        totalMemberships += arr.length;
        members.push(...arr);
      }
      console.log('Total Redis memberships:', totalMemberships);
      console.log('Unique person IDs in memberships:', new Set(members).size);

      // breakdown by residency
      const byResidency = {};
      for (const k of keys) {
        const parts = k.split(':'); // ['village', tile, residency, 'people']
        const residency = parts[2];
        const c = await storage.scard(k);
        byResidency[residency] = (byResidency[residency] || 0) + c;
      }
      console.log('By residency:', byResidency);
    }

    process.exit(0);
  } catch (err) {
    console.error('Diagnostics failed:', err);
    process.exit(1);
  }
}

run();
