jest.mock('../../config/database', () => ({ query: jest.fn() }));

const pool = require('../../config/database');

describe('IdAllocator', () => {
    let idAllocator;

    beforeEach(() => {
        jest.resetAllMocks();
        // Clear module cache to get fresh instance
        jest.resetModules();
        // Re-mock after reset
        jest.doMock('../../config/database', () => ({ query: pool.query }));
        // Re-require to get fresh instance with reset pools
        idAllocator = require('../idAllocator').default;
        // Reset pools manually since it's a singleton
        idAllocator.pools.people = { next: 0, max: 0, sequence: 'people_id_seq' };
        idAllocator.pools.family = { next: 0, max: 0, sequence: 'family_id_seq' };
        idAllocator.pools.villages = { next: 0, max: 0, sequence: 'villages_id_seq' };
    });

    describe('getNextId', () => {
        test('allocates IDs from Postgres sequence when pool is empty', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 1001 }] });

            const id = await idAllocator.getNextPersonId();

            expect(id).toBe(1001);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('setval'),
                ['people_id_seq', 1000]
            );
        });

        test('uses cached IDs when pool has available IDs', async () => {
            // First call allocates from DB
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 1001 }] });
            await idAllocator.getNextPersonId();

            // Reset mock to verify no more DB calls
            pool.query.mockClear();

            // Second call should use cached ID
            const id = await idAllocator.getNextPersonId();
            expect(id).toBe(1002);
            expect(pool.query).not.toHaveBeenCalled();
        });

        test('refills pool when exhausted', async () => {
            // Simulate pool being exhausted
            idAllocator.pools.people.next = 1000;
            idAllocator.pools.people.max = 1000;

            // Refill should happen
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 2001 }] });
            const id = await idAllocator.getNextPersonId();

            expect(id).toBe(2001);
            expect(pool.query).toHaveBeenCalledTimes(1);
        });
    });

    describe('getIdBatch', () => {
        test('returns array of sequential IDs', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 5001 }] });

            const ids = await idAllocator.getPersonIdBatch(5);

            expect(ids).toEqual([5001, 5002, 5003, 5004, 5005]);
        });

        test('allocates larger block when batch size exceeds default', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 1 }] });

            const ids = await idAllocator.getPersonIdBatch(2000);

            expect(ids).toHaveLength(2000);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('setval'),
                ['people_id_seq', 2000]
            );
        });
    });

    describe('entity-specific methods', () => {
        test('getNextFamilyId uses family sequence', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 100 }] });

            const id = await idAllocator.getNextFamilyId();

            expect(id).toBe(100);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('setval'),
                ['family_id_seq', 1000]
            );
        });

        test('getNextVillageId uses villages sequence', async () => {
            pool.query.mockResolvedValueOnce({ rows: [{ first_id: 50 }] });

            const id = await idAllocator.getNextVillageId();

            expect(id).toBe(50);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('setval'),
                ['villages_id_seq', 1000]
            );
        });
    });

    describe('getPoolStatus', () => {
        test('returns pool status for valid entity type', () => {
            idAllocator.pools.people.next = 100;
            idAllocator.pools.people.max = 200;

            const status = idAllocator.getPoolStatus('people');

            expect(status).toEqual({
                available: 100,
                next: 100,
                max: 200
            });
        });

        test('returns null for unknown entity type', () => {
            const status = idAllocator.getPoolStatus('unknown');
            expect(status).toBeNull();
        });
    });

    describe('getAllPoolStatus', () => {
        test('returns status for all pools', () => {
            const status = idAllocator.getAllPoolStatus();

            expect(status).toHaveProperty('people');
            expect(status).toHaveProperty('family');
            expect(status).toHaveProperty('villages');
        });
    });

    describe('error handling', () => {
        test('throws on unknown entity type', async () => {
            await expect(idAllocator.getNextId('invalid'))
                .rejects.toThrow('Unknown entity type: invalid');
        });

        test('propagates database errors', async () => {
            pool.query.mockRejectedValueOnce(new Error('Connection failed'));

            await expect(idAllocator.getNextPersonId())
                .rejects.toThrow('Connection failed');
        });
    });
});
