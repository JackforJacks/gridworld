jest.mock('../../../storage', () => ({ srem: jest.fn() }));
jest.mock('../../../../config/database', () => ({ query: jest.fn() }));

const storage = require('../../../storage');
const pool = require('../../../../config/database');
const families = require('../../parts/families');

beforeEach(() => jest.resetAllMocks());

test('processFamilyDeletes removes sets and issues DB queries', async () => {
    const fakePopulationState = {
        getPendingFamilyDeletes: jest.fn().mockResolvedValue([10, 20])
    };

    pool.query.mockResolvedValue({ rows: [] });

    const count = await families.processFamilyDeletes(fakePopulationState);
    expect(count).toBe(2);
    expect(storage.srem).toHaveBeenCalledWith('eligible:pregnancy:families', '10');
    expect(storage.srem).toHaveBeenCalledWith('eligible:pregnancy:families', '20');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE people SET family_id = NULL WHERE family_id IN'), [10, 20]);
});