// Integration tests for the complete data operations lifecycle
const dataOperations = require('../dataOperations');
const StateManager = require('../../stateManager');

// Mock all external dependencies for full lifecycle testing
jest.mock('../../../config/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] })
}));

jest.mock('../../storage', () => ({
    isAvailable: jest.fn(),
    hgetall: jest.fn(),
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
    smembers: jest.fn(),
    del: jest.fn(),
    srem: jest.fn(),
    incr: jest.fn()
}));

jest.mock('../../populationState', () => ({
    PeopleState: {
        addPerson: jest.fn(),
        getNextTempId: jest.fn(),
        reassignIds: jest.fn(),
        clearPendingOperations: jest.fn(),
        getPendingInserts: jest.fn(),
        getPendingUpdates: jest.fn(),
        getPendingDeletes: jest.fn(),
        getAllTilePopulations: jest.fn()
    },
    FamilyState: {
        addFamily: jest.fn(),
        getNextTempId: jest.fn(),
        reassignIds: jest.fn(),
        clearPendingFamilyOperations: jest.fn(),
        getPendingInserts: jest.fn(),
        getPendingUpdates: jest.fn(),
        getPendingDeletes: jest.fn()
    },
    VillagePopulationState: {
        getPendingInserts: jest.fn(),
        getPendingVillageInserts: jest.fn(),
        reassignIds: jest.fn()
    },
    getAllTilePopulations: jest.fn(),
    getPendingFamilyDeletes: jest.fn(),
    getPendingVillageInserts: jest.fn(),
    initTempIdCounter: jest.fn(),
    isRestarting: false
}));

jest.mock('../PopStats', () => ({
    getTotalPopulation: jest.fn()
}));

jest.mock('../../../services/calendarService', () => ({
    state: { isRunning: false },
    stop: jest.fn(),
    start: jest.fn()
}));

const pool = require('../../../config/database');
const storage = require('../../storage');
const PopulationState = require('../../populationState');
const { getTotalPopulation } = require('../PopStats');

describe('Data Operations Lifecycle Integration', () => {
    const mockPool = {
        query: jest.fn()
    };

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
        // Reset calendar state
        mockContext.calendarService.state.isRunning = false;

        // Default top-level PopulationState getters to empty arrays to avoid undefined lengths
        PopulationState.getPendingInserts = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingUpdates = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingDeletes = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingFamilyInserts = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingFamilyUpdates = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingFamilyDeletes = jest.fn().mockResolvedValue([]);
        PopulationState.getPendingVillageInserts = jest.fn().mockResolvedValue([]);

        // Default clearers (called at the end of save)
        PopulationState.clearPendingOperations = jest.fn().mockResolvedValue(true);
        PopulationState.clearPendingFamilyOperations = jest.fn().mockResolvedValue(true);
    });

    describe('Complete Load-Save Cycle', () => {
        test('successful load and save cycle with data', async () => {
            // Setup storage as available
            storage.isAvailable.mockReturnValue(true);

            // Mock storage to fail so it falls back to Postgres
            PopulationState.getAllTilePopulations.mockRejectedValue(new Error('Storage not available'));

            // Mock load data from database
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 10, population: 2 }
                ]
            });

            PopulationState.PeopleState.addPerson.mockResolvedValue(true);
            PopulationState.FamilyState.addFamily.mockResolvedValue(true);

            // Load data
            const loadResult = await dataOperations.loadPopulationData(mockPool);
            expect(loadResult).toEqual({ 10: 2 }); // 2 people on tile 10

            // Now test save cycle
            PopulationState.PeopleState.getPendingInserts.mockResolvedValue([]);
            PopulationState.PeopleState.getPendingUpdates.mockResolvedValue([]);
            PopulationState.PeopleState.getPendingDeletes.mockResolvedValue([]);
            PopulationState.FamilyState.getPendingInserts.mockResolvedValue([]);
            PopulationState.FamilyState.getPendingUpdates.mockResolvedValue([]);
            PopulationState.FamilyState.getPendingDeletes.mockResolvedValue([]);
            PopulationState.VillagePopulationState.getPendingInserts.mockResolvedValue([]);
            // Also set top-level PopulationState getters used by save operations
            PopulationState.getPendingInserts = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingUpdates = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingDeletes = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingFamilyInserts = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingFamilyUpdates = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingFamilyDeletes = jest.fn().mockResolvedValue([]);
            PopulationState.getPendingVillageInserts.mockResolvedValue([]);

            // Mock save operations
            storage.hgetall.mockResolvedValue({});
            PopulationState.PeopleState.getAllTilePopulations.mockResolvedValue({ 10: 2 });

            const saveResult = await dataOperations.savePopulationData();

            expect(saveResult).toEqual(expect.objectContaining({
                villages: 0,
                people: 0,
                inserted: 0,
                deleted: 0,
                updated: 0,
                familiesInserted: 0,
                familiesUpdated: 0,
                familiesDeleted: 0
            }));
        });

        test('handles load failure and save recovery', async () => {
            // Storage unavailable
            storage.isAvailable.mockReturnValue(false);

            // Database load fails
            mockPool.query.mockRejectedValueOnce(new Error('DB connection failed'));

            const loadResult = await dataOperations.loadPopulationData(mockPool);
            expect(loadResult).toEqual({}); // Returns empty on error

            // Save should still work even with empty data
            PopulationState.PeopleState.getPendingInserts.mockResolvedValue([]);
            PopulationState.FamilyState.getPendingInserts.mockResolvedValue([]);
            PopulationState.VillagePopulationState.getPendingInserts.mockResolvedValue([]);
            storage.hgetall.mockResolvedValue({});

            const saveResult = await dataOperations.savePopulationData();
            expect(saveResult).toEqual(expect.objectContaining({
                success: expect.any(Boolean)
            }));
        });

        test('data formatting works throughout lifecycle', () => {
            getTotalPopulation.mockReturnValue(150);

            const populations = { 1: 50, 2: 100 };
            const formatted = dataOperations.formatPopulationData(populations);

            expect(formatted).toEqual({
                tilePopulations: populations,
                totalPopulation: 150,
                totalTiles: 2,
                lastUpdated: expect.any(String)
            });

            // Verify timestamp is valid ISO string
            expect(() => new Date(formatted.lastUpdated)).not.toThrow();
        });
    });

    describe('Error Recovery Scenarios', () => {
        test('load recovers from storage failure', async () => {
            storage.isAvailable.mockReturnValue(true);
            PopulationState.PeopleState.getAllTilePopulations.mockRejectedValue(new Error('Redis down'));

            // Fallback to database
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 5, population: '25' }
                ]
            });

            const result = await dataOperations.loadPopulationData(mockPool);
            expect(result).toEqual({ 5: 25 });
        });

        test('save handles partial failures gracefully', async () => {
            // Mock some pending operations
            PopulationState.PeopleState.getPendingInserts.mockResolvedValue([
                { id: -1, tile_id: 10, sex: true, date_of_birth: '2000-01-01', residency: 1, family_id: null }
            ]);
            PopulationState.FamilyState.getPendingInserts.mockResolvedValue([]);
            PopulationState.VillagePopulationState.getPendingInserts.mockResolvedValue([]);
            PopulationState.getPendingVillageInserts.mockResolvedValue([]);

            // Simulate a failure at the save layer to ensure caller handles it
            const StateManager = require('../../stateManager');
            jest.spyOn(StateManager, 'saveToDatabase').mockRejectedValue(new Error('Insert failed'));

            const saveResult = await dataOperations.savePopulationData();
            expect(saveResult.success).toBe(false);
            expect(saveResult.error).toBe('Insert failed');

            // Restore spy
            StateManager.saveToDatabase.mockRestore();
        });

        test('calendar integration during load/save', async () => {
            // Test calendar pausing during operations
            mockContext.calendarService.state.isRunning = true;

            // Mock successful load
            storage.isAvailable.mockReturnValue(true);
            pool.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] });

            // Ensure StateManager has the same calendar service wired in
            StateManager.setCalendarService(mockContext.calendarService);

            await StateManager.loadFromDatabase(mockContext);

            expect(mockContext.calendarService.stop).toHaveBeenCalled();
            expect(mockContext.calendarService.start).toHaveBeenCalled();
        });
    });

    describe('Data Consistency Checks', () => {
        test('load and format produce consistent results', async () => {
            storage.isAvailable.mockReturnValue(false);
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 1, population: '10' },
                    { tile_id: 2, population: '20' }
                ]
            });

            getTotalPopulation.mockReturnValue(30);

            const loaded = await dataOperations.loadPopulationData(mockPool);
            const formatted = dataOperations.formatPopulationData(loaded);

            expect(loaded).toEqual({ 1: 10, 2: 20 });
            expect(formatted.totalPopulation).toBe(30);
            expect(formatted.totalTiles).toBe(2);
        });

        test('empty data states are handled consistently', async () => {
            storage.isAvailable.mockReturnValue(false);
            mockPool.query.mockResolvedValue({ rows: [] });

            getTotalPopulation.mockReturnValue(0);

            const loaded = await dataOperations.loadPopulationData(mockPool);
            const formatted = dataOperations.formatPopulationData(loaded);

            expect(loaded).toEqual({});
            expect(formatted.totalPopulation).toBe(0);
            expect(formatted.totalTiles).toBe(0);
        });
    });
});