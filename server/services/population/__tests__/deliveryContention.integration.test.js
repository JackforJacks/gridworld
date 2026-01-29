// Integration test for concurrent delivery contention
jest.mock('../../storage', () => {
    const MemoryAdapter = require('../../storage/memoryAdapter');
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
        get: (...args) => inst.get(...args),
        set: (...args) => inst.set(...args),
        pipeline: () => inst.pipeline(),
        keys: (...args) => inst.keys(...args),
        getAdapter: () => inst,
    };
});

const familyManager = require('../familyManager');
const storage = require('../../storage');
const PopulationState = require('../../populationState');

beforeEach(async () => {
    // clear relevant storage keys
    await storage.del('person');
    await storage.del('family');
    await storage.del('counts:global');

    // seed a husband and wife
    await storage.hset('person', '1', JSON.stringify({ id: 1, residency: 3, sex: true }));
    await storage.hset('person', '2', JSON.stringify({ id: 2, residency: 3, sex: false }));
});

test('concurrent deliverBaby: only one succeeds and contention is logged', async () => {
    const family = { id: -100, husband_id: 1, wife_id: 2, tile_id: 7, pregnancy: true, delivery_date: '2026-01-28', children_ids: [] };
    await storage.hset('family', String(family.id), JSON.stringify(family));

    // Ensure deterministic baby ID allocation
    jest.spyOn(PopulationState, 'getNextId').mockResolvedValue(555);

    const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 28 }) };

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });

    // Spawn several concurrent delivery attempts
    const concurrent = 6;
    const promises = Array.from({ length: concurrent }).map(() =>
        familyManager.deliverBaby(null, fakeCalendar, null, family.id)
    );

    const results = await Promise.all(promises);

    const successes = results.filter(r => r !== null);
    expect(successes.length).toBe(1);

    // Verify baby added to storage
    const persons = await storage.hgetall('person');
    const people = Object.values(persons).map(j => JSON.parse(j));
    expect(people.find(p => p.id === 555)).toBeTruthy();

    // Verify family updated with one child
    const famJson = await storage.hget('family', String(family.id));
    const updatedFam = JSON.parse(famJson);
    expect(updatedFam.children_ids.length).toBe(1);

    // Ensure we logged contention messages
    expect(warnSpy).toHaveBeenCalled();
    const sawContentionMessage = warnSpy.mock.calls.some(c => String(c[0]).includes('Could not acquire lock for family') || String(c[0]).includes('skipping delivery'));
    expect(sawContentionMessage).toBe(true);

    warnSpy.mockRestore();
});
