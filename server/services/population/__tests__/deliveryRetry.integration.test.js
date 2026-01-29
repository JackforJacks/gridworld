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
        zadd: (...args) => inst.zadd(...args),
        zrangebyscore: (...args) => inst.zrangebyscore(...args),
        zrem: (...args) => inst.zrem(...args),
    };
});

// Control locking behavior in this test
jest.mock('../../../utils/lock', () => ({
    acquireLock: jest.fn(),
    releaseLock: jest.fn().mockResolvedValue(true)
}));

const familyManager = require('../familyManager');
const storage = require('../../storage');
const PopulationState = require('../../populationState');
const lock = require('../../../utils/lock');
const serverConfig = require('../../../config/server');

beforeEach(async () => {
    // clear store
    await storage.del('person');
    await storage.del('family');
    await storage.del('counts:global');
    await storage.del('pending:deliveries:retry');
    await storage.del('pending:delivery:attempts');

    // seed parents and a family due now
    await storage.hset('person', '1', JSON.stringify({ id: 1, residency: 3, sex: true }));
    await storage.hset('person', '2', JSON.stringify({ id: 2, residency: 3, sex: false }));

    serverConfig.deliveryRetryDelayMs = 0; // immediate retry for test
    serverConfig.deliveryRetryMaxAttempts = 3;
});

test('processDeliveries requeues on lock failure and succeeds on retry', async () => {
    const family = { id: -200, husband_id: 1, wife_id: 2, tile_id: 7, pregnancy: true, delivery_date: '2026-01-28', children_ids: [] };
    await storage.hset('family', String(family.id), JSON.stringify(family));

    // First attempt: lock fails
    lock.acquireLock.mockResolvedValueOnce(null);

    const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 28 }) };

    const delivered1 = await familyManager.processDeliveries(null, fakeCalendar, null, 1);
    expect(delivered1).toBe(0);

    // Ensure entry was scheduled for retry
    const scheduled = await storage.zrangebyscore('pending:deliveries:retry', 0, Date.now() + 1000);
    expect(scheduled.includes(String(family.id))).toBe(true);

    const attempts = await storage.hget('pending:delivery:attempts', String(family.id));
    expect(parseInt(attempts, 10)).toBe(1);

    // Now make lock succeed and run again
    lock.acquireLock.mockResolvedValue('token');

    // Ensure deterministic baby ID
    jest.spyOn(PopulationState, 'getNextTempId').mockResolvedValue(-333);

    const delivered2 = await familyManager.processDeliveries(null, fakeCalendar, null, 1);
    expect(delivered2).toBe(1);

    // verify attempts cleared
    const attemptsAfter = await storage.hget('pending:delivery:attempts', String(family.id));
    expect(attemptsAfter).toBeNull();

    // verify child added
    const persons = await storage.hgetall('person');
    const people = Object.values(persons).map(j => JSON.parse(j));
    expect(people.find(p => p.id === -333)).toBeTruthy();
});