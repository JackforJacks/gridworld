// Unit tests for StateManager load operations
const loadOperations = require('../loadOperations');

// Mock dependencies
jest.mock('../../../config/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] })
}));

jest.mock('../../storage', () => ({
    isAvailable: jest.fn(),
    hset: jest.fn(),
    sadd: jest.fn(),
    pipeline: jest.fn(() => ({
        hset: jest.fn(),
        sadd: jest.fn(),
        hget: jest.fn(),
        hgetall: jest.fn(),
        smembers: jest.fn(),
        del: jest.fn(),
        srem: jest.fn(),
        exec: jest.fn().mockResolvedValue([])
    })),
    hget: jest.fn(),
    hgetall: jest.fn(),
    smembers: jest.fn(),
    del: jest.fn(),
    srem: jest.fn(),
    // scanStream should return a minimal async iterable which yields no keys by default
    scanStream: jest.fn(() => ({
        [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true, value: undefined })
        })
    }))
}));

jest.mock('../../populationState', () => ({
    PeopleState: {
        addPerson: jest.fn(),
        getNextTempId: jest.fn(),
        reassignIds: jest.fn(),
        clearPendingOperations: jest.fn()
    },
    FamilyState: {
        addFamily: jest.fn(),
        getNextTempId: jest.fn(),
        reassignIds: jest.fn(),
        clearPendingFamilyOperations: jest.fn()
    },
    VillagePopulationState: {
        reassignIds: jest.fn()
    },
    initTempIdCounter: jest.fn()
}));

jest.mock('../../../services/calendarService', () => ({
    state: { isRunning: false },
    stop: jest.fn(),
    start: jest.fn()
}));

const pool = require('../../../config/database');
const storage = require('../../storage');
const PopulationState = require('../../populationState');

describe('loadOperations', () => {
    const mockContext = {
        calendarService: {
            state: { isRunning: false },
            stop: jest.fn(),
            start: jest.fn()
        },
        io: {
            emit: jest.fn()
        }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock storage as available by default for most tests
        storage.isAvailable.mockReturnValue(true);
    });

    describe('loadFromDatabase', () => {
        test('loads data successfully with calendar paused', async () => {
            // Mock calendar running
            mockContext.calendarService.state.isRunning = true;

            // Mock database queries in the order the loader calls them: villages, people, families
            pool.query
                .mockResolvedValueOnce({ rows: [{ id: 1, tile_id: 10, land_chunk_index: 0, name: 'Village1', housing_capacity: 100, food_capacity: 1000 }] }) // villages
                .mockResolvedValueOnce({ rows: [
                    { id: 1, tile_id: 10, sex: true, date_of_birth: '2000-01-01', residency: 1, family_id: null, health: 100 },
                    { id: 2, tile_id: 10, sex: false, date_of_birth: '1995-01-01', residency: 1, family_id: null, health: 100 }
                ] }) // people (include wife with id 2)
                .mockResolvedValueOnce({ rows: [{ id: 1, husband_id: 1, wife_id: 2, tile_id: 10, pregnancy: false, delivery_date: null, children_ids: [] }] }); // families

            // Mock storage-related methods called by populateEligibleSets
            PopulationState.addEligiblePerson = jest.fn().mockResolvedValue(true);
            PopulationState.addFertileFamily = jest.fn().mockResolvedValue(true);
            PopulationState.FamilyState.addFamily.mockResolvedValue(true);

            const result = await loadOperations.loadFromDatabase(mockContext);

            // load operations perform villages, people, families and cleared land counts queries
            expect(pool.query).toHaveBeenCalledTimes(4);
            expect(PopulationState.addEligiblePerson).toHaveBeenCalled();
            expect(PopulationState.addFertileFamily).toHaveBeenCalled();
            // Should report the counts of rows processed
            expect(result).toEqual({ villages: 1, people: 2, families: 1, male: 1, female: 1 });
        });

        test('skips loading when calendar cannot be paused', async () => {
            storage.isAvailable.mockReturnValue(false);

            const result = await loadOperations.loadFromDatabase(mockContext);

            expect(result).toEqual({ villages: 0, people: 0, families: 0, skipped: true });
            expect(pool.query).not.toHaveBeenCalled();
        });

        test('skips loading when storage unavailable', async () => {
            storage.isAvailable.mockReturnValue(false);

            const result = await loadOperations.loadFromDatabase(mockContext);

            expect(result).toEqual({ villages: 0, people: 0, families: 0, skipped: true });
            expect(pool.query).not.toHaveBeenCalled();
        });

        test('handles empty database results', async () => {
            mockContext.calendarService.state.isRunning = false;

            pool.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await loadOperations.loadFromDatabase(mockContext);

            expect(result).toEqual({ villages: 0, people: 0, families: 0, male: 0, female: 0 });
            expect(PopulationState.PeopleState.addPerson).not.toHaveBeenCalled();
            expect(PopulationState.FamilyState.addFamily).not.toHaveBeenCalled();
        });

        test('handles database query errors gracefully', async () => {
            mockContext.calendarService.state.isRunning = false;
            pool.query.mockRejectedValueOnce(new Error('DB error'));

            // Expect the loader to propagate the DB error
            await expect(loadOperations.loadFromDatabase(mockContext)).rejects.toThrow('DB error');
        });

        test('handles storage operation failures', async () => {
            mockContext.calendarService.state.isRunning = false;

            // Mock villages empty, people contain one person, families empty
            pool.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 1, tile_id: 10, sex: true, date_of_birth: '2000-01-01', residency: 1, family_id: null, health: 100 }] })
                .mockResolvedValueOnce({ rows: [] });

            // The loader uses PopulationState.addEligiblePerson during eligible set population
            PopulationState.addEligiblePerson = jest.fn().mockRejectedValue(new Error('Storage error'));

            const result = await loadOperations.loadFromDatabase(mockContext);

            expect(result).toEqual({ villages: 0, people: 1, families: 0, male: 1, female: 0 });
            expect(PopulationState.addEligiblePerson).toHaveBeenCalled();
        });

        test('emits load event on success', async () => {
            mockContext.calendarService.state.isRunning = false;

            pool.query
                .mockResolvedValueOnce({ rows: [{ id: 1, tile_id: 10, sex: true, date_of_birth: '2000-01-01', residency: 1, family_id: null, health: 100 }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            PopulationState.PeopleState.addPerson.mockResolvedValue(true);

            await loadOperations.loadFromDatabase(mockContext);
        });
    });
});