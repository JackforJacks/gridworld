const storage = require('../../storage');
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
                try { await adapter.client.quit(); } catch (_) { /* ignore */ }
            }
            if (typeof adapter.client.disconnect === 'function') {
                try { adapter.client.disconnect(); } catch (_) { /* ignore */ }
            }
            if (typeof adapter.client.end === 'function') {
                try { adapter.client.end(); } catch (_) { /* ignore */ }
            }
        }
    });

    test('creates populations on selected tiles and indexes people into village sets', async () => {
        const fakeTileId = 9999;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE is_habitable')) {
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

        const saveSpy = jest.spyOn(require('../../population/dataOperations'), 'savePopulationData').mockResolvedValue({ success: true });

        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);

        expect(result).toBeTruthy();
        expect(result.totalPopulation).toBeGreaterThan(0);
        expect(Object.keys(result.tilePopulations).length).toBeGreaterThan(0);
        // Ensure our specific tile got populated
        expect(result.tilePopulations[fakeTileId]).toBeGreaterThan(0);

        // Deterministic check: with Math.random=0.5 the target should be floor(500 + 0.5 * 4501) = 2750
        const expected = Math.floor(500 + 0.5 * 4501);
        expect(result.tilePopulations[fakeTileId]).toBe(expected);
        expect(result.totalPopulation).toBe(expected);

        expect(saveSpy).toHaveBeenCalled();
        saveSpy.mockRestore();
    });
});
