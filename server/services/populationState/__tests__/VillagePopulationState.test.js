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
        pipeline: () => inst.pipeline(),
        scanStream: (...args) => inst.scanStream(...args),
        keys: (...args) => inst.keys(...args),
    };
});

const VillagePopulationState = require('../VillagePopulationState');

describe('VillagePopulationState (memory adapter)', () => {
    test('next temp id and pending inserts', async () => {
        const temp = await VillagePopulationState.getNextId();
        expect(typeof temp).toBe('number');

        const ok = await VillagePopulationState.markVillageAsNew(-1);
        expect(ok).toBe(true);

        const pending = await VillagePopulationState.getPendingInserts();
        expect(Array.isArray(pending)).toBe(true);
    });

    test('reassignIds moves village and cleared counts', async () => {
        // seed village and village:cleared
        const storage = require('../../storage');
        await storage.hset('village', '-5', JSON.stringify({ id: -5, tile_id: 1, land_chunk_index: 0, _isNew: true }));
        await storage.hset('village:cleared', '-5', '3');
        await storage.sadd('pending:village:inserts', '-5');

        await VillagePopulationState.reassignIds([{ tempId: -5, newId: 500 }]);

        const pending = await VillagePopulationState.getPendingInserts();
        expect(pending).not.toContain(-5);

        // The 'village' hash should contain the new ID as a field
        const villageJson = await storage.hget('village', '500');
        expect(villageJson).toBeTruthy();

        const cleared = await storage.hget('village:cleared', '500');
        expect(cleared).toBe('3');
    });
});