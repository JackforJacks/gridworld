jest.mock('../../../../config/database', () => ({ query: jest.fn() }));
const pool = require('../../../../config/database');
const people = require('../../parts/people');

beforeEach(() => jest.resetAllMocks());

test('processPeopleDeletes issues delete query', async () => {
    const fakePopulationState = { getPendingDeletes: jest.fn().mockResolvedValue([1, 2, 3]) };
    pool.query.mockResolvedValue({ rows: [] });

    const count = await people.processPeopleDeletes(fakePopulationState);
    expect(count).toBe(3);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM people WHERE id IN'), [1, 2, 3]);
});