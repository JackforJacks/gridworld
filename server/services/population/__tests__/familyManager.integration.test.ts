// Integration test for createFamily + lock behavior
jest.mock('../../storage', () => {
    const MemoryAdapter = require('../../storage/memoryAdapter').default;
    const inst = new MemoryAdapter();
    return {
        isAvailable: () => inst.isAvailable(),
        hget: (...args) => inst.hget(...args),
        hset: (...args) => inst.hset(...args),
        hgetall: (...args) => inst.hgetall(...args),
        hdel: (...args) => inst.hdel(...args),
        hincrby: (...args) => inst.hincrby(...args),
        smembers: (...args) => inst.smembers(...args),
        sadd: (...args) => inst.sadd(...args),
        srem: (...args) => inst.srem(...args),
        scard: (...args) => inst.scard(...args),
        del: (...args) => inst.del(...args),
        pipeline: () => inst.pipeline(),
        scanStream: (...args) => inst.scanStream(...args),
        keys: (...args) => inst.keys(...args),
        get: (...args) => inst.get(...args),
        set: (...args) => inst.set(...args),
    };
});

const familyManager = require('../familyManager');
const storage = require('../../storage');

beforeEach(async () => {
    // Clear storage between tests
    await storage.del('person');
    await storage.del('family');
    await storage.del('pending:family:inserts');
    await storage.del('counts:global');
});

test('createFamily creates one family when called concurrently for the same couple', async () => {
    // Seed two people
    const husband = { id: 1, sex: true, family_id: null };
    const wife = { id: 2, sex: false, family_id: null };
    await storage.hset('person', husband.id.toString(), JSON.stringify(husband));
    await storage.hset('person', wife.id.toString(), JSON.stringify(wife));

    // Call createFamily concurrently
    const [res1, res2] = await Promise.all([
        familyManager.createFamily(null, 1, 2, 7),
        familyManager.createFamily(null, 1, 2, 7)
    ]);

    const results = [res1, res2].filter(r => r !== null);
    expect(results.length).toBe(1); // only one should succeed

    // Verify family stored and persons updated
    const families = await storage.hgetall('family');
    const familyList = Object.values(families).map(j => JSON.parse(j));
    expect(familyList.length).toBe(1);

    const fam = familyList[0];
    expect(fam.husband_id).toBe(1);
    expect(fam.wife_id).toBe(2);

    const h = JSON.parse(await storage.hget('person', '1'));
    const w = JSON.parse(await storage.hget('person', '2'));
    expect(h.family_id).toBe(fam.id);
    expect(w.family_id).toBe(fam.id);
});
