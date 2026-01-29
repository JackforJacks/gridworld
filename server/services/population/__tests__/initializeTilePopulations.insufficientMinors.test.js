const storage = require('../../storage');
const { initializeTilePopulations } = require('../operations');
const PopulationState = require('../../populationState');
const calculator = require('../calculator');

describe('initializeTilePopulations (insufficient minors)', () => {
    let originalRandom;

    beforeAll(() => {
        originalRandom = Math.random;
        Math.random = () => 0.5; // deterministic selection
        jest.spyOn(calculator, 'getRandomAge').mockImplementation(() => 30); // ensure no minors produced
        jest.spyOn(calculator, 'getRandomBirthDate').mockImplementation((year, month, day, age) => {
            const birthYear = year - age;
            const m = String(month).padStart(2, '0');
            const d = String(day).padStart(2, '0');
            return `${birthYear}-${m}-${d}`;
        });
    });

    afterAll(() => {
        Math.random = originalRandom;
        calculator.getRandomAge.mockRestore();
        calculator.getRandomBirthDate.mockRestore();
    });

    beforeEach(async () => {
        // Ensure storage is clean before each test
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
    });

    afterAll(async () => {
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
    });

    test('reduces childrenCounts when there are no minors and does not throw', async () => {
        const fakeTileId = 7777;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE is_habitable')) {
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

        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);

        expect(result).toBeTruthy();
        expect(result.totalTiles).toBeGreaterThan(0);
        expect(result.tilePopulations[fakeTileId]).toBeGreaterThan(0);

        // With Math.random=0.5 the target should be deterministic
        const expected = Math.floor(500 + 0.5 * 4501);
        expect(result.tilePopulations[fakeTileId]).toBe(expected);

        // Ensure no minors were assigned as children (minors should be zero by our age mock)
        const people = await PopulationState.getAllPeople();
        const families = await PopulationState.getAllFamilies();

        // Count minors (age < 16) using the same date interpretation as code
        const minors = people.filter(p => {
            if (!p.date_of_birth) return false;
            const datePart = p.date_of_birth.split('T')[0];
            const [y, m, d] = datePart.split('-').map(Number);
            let age = 4000 - y;
            if (1 < m || (1 === m && 1 < d)) age--; // adjust if birthday not yet reached
            return age < 16;
        });

        expect(minors.length).toBe(0);

        // Ensure no family has children (children_ids arrays present and empty)
        for (const f of families) {
            expect(Array.isArray(f.children_ids)).toBe(true);
            expect(f.children_ids.length).toBe(0);
        }
    });

    test('reduces childrenCounts to available minors when minors are fewer than requested', async () => {
        // Make first two random ages minors (<16), the rest adults
        let call = 0;
        calculator.getRandomAge.mockRestore();
        jest.spyOn(calculator, 'getRandomAge').mockImplementation(() => {
            call++;
            return call <= 2 ? 5 : 30;
        });

        const fakeTileId = 7778;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE is_habitable')) {
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

        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);
        expect(result).toBeTruthy();

        const people = await PopulationState.getAllPeople();
        const families = await PopulationState.getAllFamilies();

        // Count minors using same logic
        const minors = people.filter(p => {
            if (!p.date_of_birth) return false;
            const datePart = p.date_of_birth.split('T')[0];
            const [y, m, d] = datePart.split('-').map(Number);
            let age = 4000 - y;
            if (1 < m || (1 === m && 1 < d)) age--; // adjust
            return age < 16;
        });

        const minorsCount = minors.length;
        const childrenAssigned = families.reduce((sum, f) => sum + (Array.isArray(f.children_ids) ? f.children_ids.length : 0), 0);

        // All assigned children must be <= available minors and equal after reduction
        expect(childrenAssigned).toBeLessThanOrEqual(minorsCount);
        // And should attempt to assign as many as possible (either equal or less if some constraints)
        expect(childrenAssigned).toBe(minorsCount);
    });

    test('does not exceed tile target population (trims excess)', async () => {
        // Make random high to maximise population and potential extras
        Math.random = () => 0.99;
        calculator.getRandomAge.mockRestore();
        jest.spyOn(calculator, 'getRandomAge').mockImplementation(() => 25);

        const fakeTileId = 7779;
        const pool = {
            query: async (text) => {
                if (text && text.includes('SELECT id FROM tiles WHERE is_habitable')) {
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

        const expected = Math.floor(500 + 0.99 * 4501);
        const result = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);

        expect(result).toBeTruthy();
        // actual should not exceed intended target
        expect(result.tilePopulations[fakeTileId]).toBeLessThanOrEqual(expected);
    });
});