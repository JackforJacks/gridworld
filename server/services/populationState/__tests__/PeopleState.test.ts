const MemoryAdapter = require('../../storage/memoryAdapter').default;

// Mock the storage module to use MemoryAdapter instance for deterministic tests
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
    };
});

const PeopleState = require('../PeopleState').default;

describe('PeopleState (memory adapter)', () => {
    test('addPerson and getAllPeople and pending inserts', async () => {
        const person = { id: -1, tile_id: 1, residency: 0, sex: true, date_of_birth: '2000-01-01' };
        const ok = await PeopleState.addPerson(person, true);
        expect(ok).toBe(true);

        const all = await PeopleState.getAllPeople();
        expect(all.length).toBeGreaterThanOrEqual(1);
        const found = all.find(p => p.id === -1);
        expect(found).toBeDefined();

        const pending = await PeopleState.getPendingInserts();
        expect(pending.some(p => p.id === -1)).toBe(true);

        const counts = await PeopleState.getGlobalCounts();
        expect(counts.total).toBeGreaterThanOrEqual(1);
        expect(counts.male).toBeGreaterThanOrEqual(1);
    });

    test('updatePerson changes residency and pending updates', async () => {
        const person = { id: -2, tile_id: 2, residency: 1, sex: false };
        await PeopleState.addPerson(person, true);

        const ok = await PeopleState.updatePerson(-2, { residency: 0 });
        expect(ok).toBe(true);

        const p = await PeopleState.getPerson(-2);
        expect(p.residency).toBe(0);

        const pending = await PeopleState.getPendingUpdates();
        // since id < 0, it should not be in pending updates; ensure no crash
        expect(Array.isArray(pending)).toBe(true);
    });

    test('removePerson removes and updates counts', async () => {
        const person = { id: -3, tile_id: 3, residency: 0, sex: true };
        await PeopleState.addPerson(person, true);
        const before = await PeopleState.getGlobalCounts();
        const ok = await PeopleState.removePerson(-3, false);
        expect(ok).toBe(true);
        const after = await PeopleState.getGlobalCounts();
        expect(after.total).toBeLessThanOrEqual(before.total);
    });
});
