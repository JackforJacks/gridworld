const storage = require('../../storage');
const { loadPopulationData } = require('../dataOperations');

jest.setTimeout(10000);

describe('loadPopulationData storage readiness', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('waits for storage ready and returns storage populations when they appear', async () => {
        // Simulate storage initially unavailable, then ready
        const isAvailableSpy = jest.spyOn(storage, 'isAvailable')
            .mockImplementationOnce(() => false)
            .mockImplementation(() => true);

        // Simulate PopulationState.getAllTilePopulations returning empty first, then populated
        const PopulationState = require('../../populationState');
        const getAllSpy = jest.spyOn(PopulationState, 'getAllTilePopulations')
            .mockImplementationOnce(async () => ({}))
            .mockImplementationOnce(async () => ({ '42': 123 }));

        const fakePool = { query: jest.fn().mockResolvedValue({ rows: [] }) };

        // Trigger load - storage emits ready shortly after
        const loadPromise = loadPopulationData(fakePool);
        setTimeout(() => storage.emit('ready'), 50);

        const populations = await loadPromise;
        expect(populations).toHaveProperty('42');
        expect(populations['42']).toBe(123);

        isAvailableSpy.mockRestore();
        getAllSpy.mockRestore();
    });

    test('polls storage when available but empty and falls back to Postgres when still empty', async () => {
        const isAvailableSpy = jest.spyOn(storage, 'isAvailable').mockImplementation(() => true);

        const PopulationState = require('../../populationState');
        const getAllSpy = jest.spyOn(PopulationState, 'getAllTilePopulations').mockImplementation(async () => ({}));

        const fakePool = { query: jest.fn().mockResolvedValue({ rows: [{ tile_id: 7, population: '55' }] }) };

        const populations = await loadPopulationData(fakePool);
        expect(populations).toHaveProperty('7');
        expect(populations['7']).toBe(55);

        isAvailableSpy.mockRestore();
        getAllSpy.mockRestore();
    });
});