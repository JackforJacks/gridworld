// Unit tests for Population Data Operations lifecycle
const dataOperations = require('../dataOperations');
const { getTotalPopulation } = require('../PopStats');

// Mock dependencies
jest.mock('../PopStats', () => ({
    getTotalPopulation: jest.fn()
}));

jest.mock('../../storage', () => ({
    isAvailable: jest.fn(),
    hgetall: jest.fn(),
    pipeline: jest.fn()
}));

jest.mock('../../populationState', () => ({
    getAllTilePopulations: jest.fn()
}));

jest.mock('../../stateManager', () => ({
    saveToDatabase: jest.fn()
}));

const storage = require('../../storage');
const PopulationState = require('../../populationState');
const StateManager = require('../../stateManager');

describe('dataOperations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('loadPopulationData', () => {
        const mockPool = {
            query: jest.fn()
        };

        test('loads from storage when available and has data', async () => {
            storage.isAvailable.mockReturnValue(true);
            PopulationState.getAllTilePopulations.mockResolvedValue({
                1: 10,
                2: 20
            });

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(storage.isAvailable).toHaveBeenCalled();
            expect(PopulationState.getAllTilePopulations).toHaveBeenCalled();
            expect(mockPool.query).not.toHaveBeenCalled();
            expect(result).toEqual({ 1: 10, 2: 20 });
        });

        test('falls back to Postgres when storage fails', async () => {
            storage.isAvailable.mockReturnValue(true);
            PopulationState.getAllTilePopulations.mockRejectedValue(new Error('Storage error'));
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 1, population: '15' },
                    { tile_id: 2, population: '25' }
                ]
            });

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(storage.isAvailable).toHaveBeenCalled();
            expect(PopulationState.getAllTilePopulations).toHaveBeenCalled();
            expect(mockPool.query).toHaveBeenCalledWith('SELECT tile_id, COUNT(*) as population FROM people GROUP BY tile_id');
            expect(result).toEqual({ 1: 15, 2: 25 });
        });

        test('falls back to Postgres when storage has no data', async () => {
            storage.isAvailable.mockReturnValue(true);
            PopulationState.getAllTilePopulations.mockResolvedValue({});
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 1, population: '10' }
                ]
            });

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(PopulationState.getAllTilePopulations).toHaveBeenCalled();
            expect(mockPool.query).toHaveBeenCalled();
            expect(result).toEqual({ 1: 10 });
        });

        test('uses Postgres directly when storage unavailable', async () => {
            storage.isAvailable.mockReturnValue(false);
            mockPool.query.mockResolvedValue({
                rows: [
                    { tile_id: 3, population: '5' }
                ]
            });

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(storage.isAvailable).toHaveBeenCalled();
            expect(PopulationState.getAllTilePopulations).not.toHaveBeenCalled();
            expect(mockPool.query).toHaveBeenCalled();
            expect(result).toEqual({ 3: 5 });
        });

        test('returns empty object on database error', async () => {
            storage.isAvailable.mockReturnValue(false);
            mockPool.query.mockRejectedValue(new Error('DB error'));

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(result).toEqual({});
        });

        test('handles empty result set', async () => {
            storage.isAvailable.mockReturnValue(false);
            mockPool.query.mockResolvedValue({ rows: [] });

            const result = await dataOperations.loadPopulationData(mockPool);

            expect(result).toEqual({});
        });
    });

    describe('savePopulationData', () => {
        test('successfully saves data and returns result', async () => {
            const expectedResult = {
                villages: 5,
                people: 100,
                inserted: 50,
                deleted: 10,
                updated: 40,
                familiesInserted: 20,
                familiesUpdated: 5,
                familiesDeleted: 2
            };
            StateManager.saveToDatabase.mockResolvedValue(expectedResult);

            const result = await dataOperations.savePopulationData();

            expect(StateManager.saveToDatabase).toHaveBeenCalled();
            expect(result).toEqual(expectedResult);
        });

        test('returns error object on save failure', async () => {
            const error = new Error('Save failed');
            StateManager.saveToDatabase.mockRejectedValue(error);

            const result = await dataOperations.savePopulationData();

            expect(StateManager.saveToDatabase).toHaveBeenCalled();
            expect(result).toEqual({
                success: false,
                error: error.message
            });
        });
    });

    describe('formatPopulationData', () => {
        beforeEach(() => {
            getTotalPopulation.mockReturnValue(150);
        });

        test('formats population data with provided data', () => {
            const populations = { 1: 50, 2: 100 };
            const result = dataOperations.formatPopulationData(populations);

            expect(getTotalPopulation).toHaveBeenCalledWith(populations);
            expect(result).toEqual({
                tilePopulations: populations,
                totalPopulation: 150,
                totalTiles: 2,
                lastUpdated: expect.any(String)
            });
        });

        test('formats population data with null input', () => {
            const result = dataOperations.formatPopulationData(null);

            expect(getTotalPopulation).toHaveBeenCalledWith({});
            expect(result).toEqual({
                tilePopulations: {},
                totalPopulation: 150,
                totalTiles: 0,
                lastUpdated: expect.any(String)
            });
        });

        test('includes valid ISO timestamp', () => {
            const result = dataOperations.formatPopulationData({});
            const timestamp = new Date(result.lastUpdated);

            expect(timestamp).toBeInstanceOf(Date);
            expect(timestamp.toISOString()).toBe(result.lastUpdated);
        });
    });
});