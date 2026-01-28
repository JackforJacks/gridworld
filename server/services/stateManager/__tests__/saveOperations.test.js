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
        jest.mock('../../population/PopStats', () => ({ getAllPopulationData: jest.fn().mockResolvedValue({ totalPopulation: 5 }) }));
        // Re-require to ensure our mock for PopStats is used by the module under test
        jest.resetModules();
        const saveOpsReloaded = require('../saveOperations');

        const io = { emit: jest.fn() };
        // call emitPopulationUpdate (exports remain stable)
        await saveOpsReloaded.emitPopulationUpdate(io);

        expect(io.emit).toHaveBeenCalledWith('populationUpdate', expect.objectContaining({ totalPopulation: 5 }));
    });

    describe('insertPendingFamilies', () => {
        test('inserts families with valid husband and wife IDs', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: 1, wife_id: 2, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] },
                    { id: -2, husband_id: 3, wife_id: 4, tile_id: 20, pregnancy: true, delivery_date: '2026-02-01', children_ids: [5] }
                ]),
                reassignFamilyIds: jest.fn()
            };

            // Mock person existence checks
            pool.query
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // husband 1 exists
                .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // wife 2 exists
                .mockResolvedValueOnce({ rows: [{ id: 3 }] }) // husband 3 exists
                .mockResolvedValueOnce({ rows: [{ id: 4 }] }) // wife 4 exists
                .mockResolvedValueOnce({ rows: [{ id: 100 }] }) // first insert returns id 100
                .mockResolvedValueOnce({ rows: [{ id: 101 }] }); // second insert returns id 101

            const result = await saveOps.insertPendingFamilies(mockPopulationState);

            expect(pool.query).toHaveBeenCalledTimes(6); // 4 existence checks + 2 inserts
            expect(pool.query).toHaveBeenCalledWith('SELECT 1 FROM people WHERE id = $1', [1]);
            expect(pool.query).toHaveBeenCalledWith('SELECT 1 FROM people WHERE id = $1', [2]);
            expect(pool.query).toHaveBeenCalledWith(
                `
                INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [1, 2, 10, false, null, []]);
            expect(result).toEqual({
                familiesInserted: 2,
                familyIdMappings: expect.arrayContaining([
                    { tempId: -1, newId: expect.any(Number) },
                    { tempId: -2, newId: expect.any(Number) }
                ])
            });
            expect(mockPopulationState.reassignFamilyIds).toHaveBeenCalledWith([
                { tempId: -1, newId: expect.any(Number) },
                { tempId: -2, newId: expect.any(Number) }
            ]);
        });

        test('sets husband_id and wife_id to null when people do not exist', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: 999, wife_id: 888, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }
                ]),
                reassignFamilyIds: jest.fn()
            };

            // Mock person existence checks - people don't exist
            pool.query
                .mockResolvedValueOnce({ rows: [] }) // husband 999 doesn't exist
                .mockResolvedValueOnce({ rows: [] }) // wife 888 doesn't exist
                .mockResolvedValueOnce({ rows: [{ id: 200 }] }); // insert returns id 200

            const result = await saveOps.insertPendingFamilies(mockPopulationState);

            expect(pool.query).toHaveBeenCalledWith(
                `
                INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [null, null, 10, false, null, []]);
            expect(result.familiesInserted).toBe(1);
        });

        test('handles negative IDs correctly (new people)', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: -5, wife_id: -10, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }
                ]),
                reassignFamilyIds: jest.fn()
            };

            pool.query.mockResolvedValueOnce({ rows: [{ id: 300 }] });

            const result = await saveOps.insertPendingFamilies(mockPopulationState);

            // Negative IDs should be set to null without existence checks
            expect(pool.query).toHaveBeenCalledWith(
                `
                INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, delivery_date, children_ids)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id
            `, [null, null, 10, false, null, []]);
            expect(result.familiesInserted).toBe(1);
        });

        test('handles empty pending inserts', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([]),
                reassignFamilyIds: jest.fn()
            };

            const result = await saveOps.insertPendingFamilies(mockPopulationState);

            expect(pool.query).not.toHaveBeenCalled();
            expect(mockPopulationState.reassignFamilyIds).not.toHaveBeenCalled();
            expect(result).toEqual({
                familiesInserted: 0,
                familyIdMappings: []
            });
        });

        test('handles database errors during existence checks', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: 1, wife_id: 2, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }
                ]),
                reassignFamilyIds: jest.fn()
            };

            // Mock existence check failure
            pool.query.mockRejectedValueOnce(new Error('DB error'));

            await expect(saveOps.insertPendingFamilies(mockPopulationState)).rejects.toThrow('DB error');
        });

        test('reserve inserts families without existence checks', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: 1, wife_id: 2, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }
                ]),
                reassignFamilyIds: jest.fn()
            };

            // Only placeholder INSERT expected
            pool.query.mockResolvedValueOnce({ rows: [{ id: 200 }] });

            const result = await saveOps.insertPendingFamiliesReserve(mockPopulationState);

            expect(pool.query).toHaveBeenCalledTimes(1);
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO family (husband_id, wife_id, tile_id'),
                [null, null, 10, false, null, []]
            );
            expect(result.familiesInserted).toBe(1);
            expect(mockPopulationState.reassignFamilyIds).toHaveBeenCalledWith([{ tempId: -1, newId: expect.any(Number) }]);
        });

        test('reserve + people insert + updateFamilyReferences sets husband/wife after person insert', async () => {
            const mockPopulationState = {
                getPendingFamilyInserts: jest.fn().mockResolvedValue([
                    { id: -1, husband_id: -5, wife_id: -6, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }
                ]),
                reassignFamilyIds: jest.fn(),
                getPendingInserts: jest.fn().mockResolvedValue([
                    { id: -5, tile_id: 10, sex: 'male', date_of_birth: '2020-01-01', residency: null, family_id: 100 },
                    { id: -6, tile_id: 10, sex: 'female', date_of_birth: '2020-01-01', residency: null, family_id: 100 }
                ]),
                reassignIds: jest.fn(),
                getFamily: jest.fn().mockResolvedValue({ husband_id: -5, wife_id: -6, children_ids: [] })
            };

            // Family placeholder insert, then a batched people insert (single query returning both rows), then family UPDATE
            pool.query
                .mockResolvedValueOnce({ rows: [{ id: 100 }] }) // family reserve
                .mockResolvedValueOnce({ rows: [{ id: 200 }, { id: 201 }] }); // batched people insert returns two rows

            const { familiesInserted, familyIdMappings } = await saveOps.insertPendingFamiliesReserve(mockPopulationState);
            expect(familiesInserted).toBe(1);
            expect(mockPopulationState.reassignFamilyIds).toHaveBeenCalledWith([{ tempId: -1, newId: expect.any(Number) }]);

            const { insertedCount, idMappings } = await saveOps.insertPendingPeople(mockPopulationState, familyIdMappings);
            expect(insertedCount).toBe(2);

            // Now update family refs using the resulting mappings
            await saveOps.updateFamilyReferences(familyIdMappings, [{ tempId: -5, newId: 200 }, { tempId: -6, newId: 201 }], mockPopulationState);

            // Expect an UPDATE to family with the new husband/wife ids
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE family SET husband_id'),
                [200, 201, expect.any(Number)]
            );
        });
    });

    describe('updateFamilyReferences', () => {
        test('updates family references with mapped IDs', async () => {
            const familyIdMappings = [
                { tempId: -1, newId: 100 },
                { tempId: -2, newId: 101 }
            ];
            const idMappings = [
                { tempId: -5, newId: 200 },
                { tempId: -10, newId: 201 },
                { tempId: -15, newId: 202 },
                { tempId: -20, newId: 203 },
                { tempId: -25, newId: 204 }
            ];

            const mockPopulationState = {
                getFamily: jest.fn()
                    .mockResolvedValueOnce({ husband_id: -5, wife_id: -10, children_ids: [-15] }) // family 100
                    .mockResolvedValueOnce({ husband_id: -20, wife_id: -25, children_ids: [] }) // family 101
            };

            pool.query.mockResolvedValue({});

            await saveOps.updateFamilyReferences(familyIdMappings, idMappings, mockPopulationState);

            expect(mockPopulationState.getFamily).toHaveBeenCalledWith(100);
            expect(mockPopulationState.getFamily).toHaveBeenCalledWith(101);
            expect(pool.query).toHaveBeenCalledTimes(3); // 2 husband/wife updates + 1 children update
            // Check that husband/wife updates were called
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE family SET husband_id'),
                expect.any(Array)
            );
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE family SET children_ids'),
                expect.any(Array)
            );
        });

        test('skips update when no mappings provided', async () => {
            const mockPopulationState = {};

            await saveOps.updateFamilyReferences([], [], mockPopulationState);

            expect(pool.query).not.toHaveBeenCalled();
        });

        test('handles families not found in storage', async () => {
            const familyIdMappings = [{ tempId: -1, newId: 100 }];
            const idMappings = [{ tempId: -5, newId: 200 }];

            const mockPopulationState = {
                getFamily: jest.fn().mockResolvedValue(null)
            };

            await saveOps.updateFamilyReferences(familyIdMappings, idMappings, mockPopulationState);

            expect(mockPopulationState.getFamily).toHaveBeenCalledWith(100);
            expect(pool.query).not.toHaveBeenCalled();
        });
    });
});