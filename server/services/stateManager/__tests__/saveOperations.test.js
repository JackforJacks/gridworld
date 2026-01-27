jest.mock('../../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../storage', () => ({
    srem: jest.fn(),
    hgetall: jest.fn(),
    pipeline: jest.fn()
}));

const pool = require('../../../config/database');
const storage = require('../../storage');
const saveOps = require('../saveOperations');

beforeEach(() => {
    jest.resetAllMocks();
});

describe('saveOperations helpers', () => {
    test('processFamilyDeletes removes eligible sets and executes expected DB queries', async () => {
        const fakePopulationState = {
            getPendingFamilyDeletes: jest.fn().mockResolvedValue([11, 22])
        };

        pool.query.mockResolvedValue({ rows: [] });

        const deleted = await saveOps.processFamilyDeletes(fakePopulationState);

        // Should report number of deletions
        expect(deleted).toBe(2);

        // storage.srem should be called for each id
        expect(storage.srem).toHaveBeenCalledWith('eligible:pregnancy:families', '11');
        expect(storage.srem).toHaveBeenCalledWith('eligible:pregnancy:families', '22');

        // DB queries: clearing family references in people and deleting families
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE people SET family_id = NULL WHERE family_id IN'), [11, 22]);
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM family WHERE id IN'), [11, 22]);
    });

    test('insertPendingVillages inserts pending villages and calls reassign', async () => {
        const villageData = {
            '-1': JSON.stringify({ id: -1, tile_id: 7, land_chunk_index: 0, name: 'T1', housing_slots: [], housing_capacity: 200, food_stores: 0, food_capacity: 500, food_production_rate: 0.2 })
        };

        const fakePopulationState = {
            getPendingVillageInserts: jest.fn().mockResolvedValue([-1]),
            reassignVillageIds: jest.fn().mockResolvedValue(true)
        };

        // First INSERT returns new id
        pool.query.mockResolvedValueOnce({ rows: [{ id: 200 }] });
        // tiles_lands update may succeed (resolve empty)
        pool.query.mockResolvedValueOnce({ rows: [] });

        const result = await saveOps.insertPendingVillages(villageData, fakePopulationState);

        expect(result.villagesInserted).toBe(1);
        expect(result.villageIdMappings).toEqual([{ tempId: -1, newId: 200 }]);

        expect(fakePopulationState.reassignVillageIds).toHaveBeenCalledWith([{ tempId: -1, newId: 200 }]);
    });

    test('processPeopleDeletes runs DELETE query and returns count', async () => {
        const fakePopulationState = {
            getPendingDeletes: jest.fn().mockResolvedValue([3, 4])
        };

        pool.query.mockResolvedValue({ rows: [] });

        const deletedCount = await saveOps.processPeopleDeletes(fakePopulationState);
        expect(deletedCount).toBe(2);
        expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM people WHERE id IN'), [3, 4]);
    });

    test('emitPopulationUpdate calls PopStats and emits to io', async () => {
        // Mock PopStats.getAllPopulationData
        jest.mock('../..//population/PopStats', () => ({ getAllPopulationData: jest.fn().mockResolvedValue({ totalPopulation: 5 }) }), { virtual: true });
        // Re-require to ensure our mock for PopStats is used by the module under test
        jest.resetModules();
        const saveOpsReloaded = require('../saveOperations');

        const io = { emit: jest.fn() };
        // call emitPopulationUpdate (exports remain stable)
        await saveOpsReloaded.emitPopulationUpdate(io);

        expect(io.emit).toHaveBeenCalledWith('populationUpdate', expect.objectContaining({ totalPopulation: 5 }));
    });
});