jest.mock('../../../../config/database', () => ({ query: jest.fn() }));

const pool = require('../../../../config/database');
const villages = require('../../parts/villages');

beforeEach(() => jest.resetAllMocks());

test('insertPendingVillages inserts and calls reassign', async () => {
    const villageData = {
        '-5': JSON.stringify({ id: -5, tile_id: 5, land_chunk_index: 0, name: 'VV', housing_slots: [], housing_capacity: 300, food_stores: 0, food_capacity: 400, food_production_rate: 0.1 })
    };

    const fakePopulationState = {
        getPendingVillageInserts: jest.fn().mockResolvedValue([-5]),
        reassignVillageIds: jest.fn().mockResolvedValue(true)
    };

    pool.query.mockResolvedValueOnce({ rows: [{ id: 555 }] });
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await villages.insertPendingVillages(villageData, fakePopulationState);

    expect(res.villagesInserted).toBe(1);
    expect(res.villageIdMappings).toEqual([{ tempId: -5, newId: 555 }]);
    expect(fakePopulationState.reassignVillageIds).toHaveBeenCalledWith([{ tempId: -5, newId: 555 }]);
});