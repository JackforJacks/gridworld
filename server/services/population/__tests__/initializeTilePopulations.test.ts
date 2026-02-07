const storage = require('../../storage').default;
const { initializeTilePopulations } = require('../../population/operations');

describe('initializeTilePopulations (storage-first)', () => {
    let originalRandom;

    beforeAll(() => {
        // Make random deterministic for test: Math.random() -> 0.5
        originalRandom = Math.random;
        Math.random = () => 0.5;
    });

    afterAll(() => {
        Math.random = originalRandom;
    });

    beforeEach(async () => {
        // Ensure storage is clean before each test
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
    });

    afterAll(async () => {
        // Clean up storage and close any adapter clients to avoid open handles
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
        const adapter = storage.getAdapter && storage.getAdapter();
        if (adapter && adapter.client) {
            if (typeof adapter.client.quit === 'function') {
                try { await adapter.client.quit(); } catch (_: unknown) { /* ignore */ }
            }
            if (typeof adapter.client.disconnect === 'function') {
                try { adapter.client.disconnect(); } catch (_: unknown) { /* ignore */ }
            }
            if (typeof adapter.client.end === 'function') {
                try { adapter.client.end(); } catch (_: unknown) { /* ignore */ }
            }
        }
    });

    test('creates populations on selected tiles and indexes people into village sets', async () => {
        const fakeTileId = 9999;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE terrain_type NOT IN')) {
                    return { rows: [{ id: fakeTileId }] };
                }
                if (text && text.trim().toUpperCase().startsWith('TRUNCATE')) {
                    return {};
                }
                // default
                return { rows: [] };
            }
        };

        const calendarService = { getCurrentDate: () => ({ year: 4000, month: 1, day: 1 }) };
        const serviceInstance = { broadcastUpdate: async () => { } };

        const serverConfig = require('../../../config/server');

        // By default, save-on-init should be disabled for Redis-first workflows
        serverConfig.savePopulationOnInit = false;
        const saveSpy = jest.spyOn(require('../../population/dataOperations'), 'savePopulationData').mockResolvedValue({ success: true });

        const broadcastSpy = jest.spyOn(serviceInstance, 'broadcastUpdate').mockResolvedValue();

        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);

        expect(result).toBeTruthy();
        expect(result.totalPopulation).toBeGreaterThan(0);
        expect(Object.keys(result.tilePopulations).length).toBeGreaterThan(0);
        // Ensure our specific tile got populated
        expect(result.tilePopulations[fakeTileId]).toBeGreaterThan(0);

        expect(broadcastSpy).toHaveBeenCalledWith('populationUpdate');
        broadcastSpy.mockRestore();
        // Deterministic check: with Math.random=0.5 the target should be floor(500 + 0.5 * 4501) = 2750
        const expected = Math.floor(500 + 0.5 * 4501);
        expect(result.tilePopulations[fakeTileId]).toBe(expected);
        expect(result.totalPopulation).toBe(expected);

        // Save should NOT have been called by default
        expect(saveSpy).not.toHaveBeenCalled();
        saveSpy.mockRestore();

        // Now enable save-on-init and confirm it is invoked
        serverConfig.savePopulationOnInit = true;
        // Clear storage so initializeTilePopulations runs the full generation path (no existing population)
        const keysToClear = await storage.keys('*');
        if (keysToClear && keysToClear.length > 0) await storage.del(...keysToClear);

        const saveSpy2 = jest.spyOn(require('../../population/dataOperations'), 'savePopulationData').mockResolvedValue({ success: true });
        const result2 = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);
        expect(saveSpy2).toHaveBeenCalled();
        saveSpy2.mockRestore();

        // Reset config to default (disabled)
        serverConfig.savePopulationOnInit = false;
    });

    test('waits for all selected tiles to appear in storage before returning (handles delayed writes)', async () => {
        const fakeTileId = 12345;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE terrain_type NOT IN')) {
                    return { rows: [{ id: fakeTileId }] };
                }
                if (text && text.trim().toUpperCase().startsWith('TRUNCATE')) {
                    return {};
                }
                return { rows: [] };
            }
        };
        const calendarService = { getCurrentDate: () => ({ year: 4000, month: 1, day: 1 }) };
        const serviceInstance = { broadcastUpdate: async () => { } };

        // Spy on PopulationState.getAllTilePopulations to simulate delayed visibility
        const PopulationState = require('../../populationState');
        let callCount = 0;
        const expectedCount = Math.floor(500 + 0.5 * 4501);
        const originalGetAll = PopulationState.getAllTilePopulations;
        jest.spyOn(PopulationState, 'getAllTilePopulations').mockImplementation(async () => {
            callCount++;
            // First couple calls return empty (simulate write still in progress), then return full map
            if (callCount < 3) return {};
            return { [fakeTileId]: expectedCount };
        });

        // Ensure save-on-init disabled
        const serverConfig = require('../../../config/server');
        serverConfig.savePopulationOnInit = false;

        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);
        expect(result.tilePopulations[fakeTileId]).toBe(expectedCount);

        // Restore original implementation
        PopulationState.getAllTilePopulations.mockRestore();
        if (originalGetAll) PopulationState.getAllTilePopulations = originalGetAll;
    });
});
