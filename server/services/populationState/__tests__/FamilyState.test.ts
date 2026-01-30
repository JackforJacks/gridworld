// Use MemoryAdapter mock like PeopleState tests
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

const FamilyState = require('../FamilyState').default;

describe('FamilyState (memory adapter)', () => {
    test('addFamily, getAllFamilies, pending inserts', async () => {
        const family = { id: -1, husband_id: null, wife_id: null, tile_id: 1 };
        const ok = await FamilyState.addFamily(family, true);
        expect(ok).toBe(true);

        const all = await FamilyState.getAllFamilies();
        expect(all.length).toBeGreaterThanOrEqual(1);
        expect(all.some(f => f.id === -1)).toBe(true);

        const pending = await FamilyState.getPendingInserts();
        expect(pending.some(f => f.id === -1)).toBe(true);
    });

    test('fertile family set operations', async () => {
        const ok = await FamilyState.addFertileFamily(-1, 1);
        expect(ok).toBe(true);
        const fertile = await FamilyState.getFertileFamilies(1);
        expect(Array.isArray(fertile)).toBe(true);
        expect(fertile.some(id => id === '-1' || id === -1)).toBeTruthy();

        const removed = await FamilyState.removeFertileFamily(-1);
        expect(removed).toBe(true);
    });

    test('reassignIds updates family and people writes without throwing', async () => {
        // Seed family and person entries that reassignIds expects
        await FamilyState.addFamily({ id: -2, husband_id: -10, wife_id: -11, children_ids: [-12] }, true);
        const mappings = [{ tempId: -2, newId: 200 }];
        await FamilyState.reassignIds(mappings);

        const all = await FamilyState.getAllFamilies();
        expect(all.some(f => f.id === 200)).toBe(true);
    });
});