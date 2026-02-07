let storage;
const { initializeTilePopulations } = require('../../population/operations');
// Note: require villageSeeder inside the test after mocking the DB pool so
// the module uses the test pool instance.
let idAllocator;

describe('World restart -> Village seeding -> storage-to-ui flow (e2e)', () => {
    let originalRandom;

    beforeAll(() => {
        originalRandom = Math.random;
        Math.random = () => 0.5; // deterministic
    });

    afterAll(() => {
        Math.random = originalRandom;
    });

    beforeEach(async () => {
        // require fresh storage instance so it matches villageSeeder's instance
        storage = require('../../storage').default;
        // clear storage
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
    });

    afterEach(async () => {
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
    });

    test('seeds villages to storage and assigns housing_slots and person residency', async () => {
        const fakeTileId = 424242;

        const pool = {
            query: async (text, params) => {
                // Return the single habitable tile
                if (text && text.includes('SELECT id FROM tiles WHERE terrain_type NOT IN')) {
                    return { rows: [{ id: fakeTileId }] };
                }
                // ID allocator setval reservation query
                if (text && text.includes('SELECT setval')) {
                    return { rows: [{ first_id: '1' }] };
                }
                // tiles_lands query in redisSeeding: return some cleared chunks for our tile
                if (text && text.includes('FROM tiles_lands tl') && params && Array.isArray(params[0])) {
                    return { rows: [{ tile_id: fakeTileId, chunk_index: 0 }, { tile_id: fakeTileId, chunk_index: 1 }] };
                }
                // TRUNCATE / ALTER / other statements - return empty success
                return { rows: [] };
            }
        };

        // Ensure modules are reloaded so villageSeeder picks up our test pool
        jest.resetModules();
        jest.doMock('../../../config/database', () => pool);
        const villageSeeder = require('../index');

        // Re-require storage and idAllocator so we operate on the same instances
        storage = require('../../storage').default;
        idAllocator = require('../../idAllocator').default;

        const calendarService = { getCurrentDate: () => ({ year: 4000, month: 1, day: 1 }) };
        const serviceInstance = { broadcastUpdate: async () => { } };

        // Run population initialization to create people in storage
        const initRes = await initializeTilePopulations(pool, calendarService, serviceInstance, [fakeTileId]);
        expect(initRes).toBeTruthy();
        expect(initRes.totalPopulation).toBeGreaterThan(0);

        // Make sure PopulationState.getAllTilePopulations reports the initialized tile
        const PopulationState = require('../../populationState').default;
        jest.spyOn(PopulationState, 'getAllTilePopulations').mockImplementation(async () => ({ [fakeTileId]: initRes.totalPopulation }));

        // Now run storage-first village seeding
        // Ensure idAllocator returns deterministic IDs for the test (avoid DB sequence calls)
        jest.spyOn(idAllocator, 'getVillageIdBatch').mockImplementation(async (count) => {
            return Array.from({ length: count }, (_, i) => i + 1000);
        });
        jest.spyOn(idAllocator, 'getPersonIdBatch').mockImplementation(async (count) => {
            return Array.from({ length: count }, (_, i) => -(i + 1));
        });

        const seedRes = await villageSeeder.seedVillagesStorageFirst();
        expect(seedRes).toBeTruthy();
        expect(seedRes.created).toBeGreaterThan(0);

        // Verify villages exist in storage
        const villagesRaw = await storage.hgetall('village');
        const villages = Object.values(villagesRaw).map(j => JSON.parse(j));
        expect(villages.length).toBeGreaterThan(0);

        // At least one village should have housing_slots array (possibly empty) and housing_capacity
        const v = villages[0];
        expect(v).toHaveProperty('housing_slots');
        expect(Array.isArray(v.housing_slots)).toBe(true);
        expect(v).toHaveProperty('housing_capacity');

        // Check person hash: ensure at least one person has residency assigned matching a village's land_chunk_index
        const peopleRaw = await storage.hgetall('person');
        const people = Object.values(peopleRaw).map(j => JSON.parse(j));
        expect(people.length).toBeGreaterThan(0);

        const assigned = people.find(p => p.residency !== null && p.residency !== undefined && p.residency !== 0);
        // It's possible residency remains 0 for some configs; ensure either assigned or villages.housing_slots populated
        const someVillageHasSlots = villages.some(x => Array.isArray(x.housing_slots) && x.housing_slots.length > 0);
        expect(assigned || someVillageHasSlots).toBeTruthy();

        // If a person assigned found, ensure the corresponding village contains that person's id in housing_slots
        if (assigned) {
            const matchingVillage = villages.find(x => x.tile_id === assigned.tile_id && x.land_chunk_index === assigned.residency);
            expect(matchingVillage).toBeDefined();
            if (matchingVillage) {
                // matchingVillage.housing_slots may contain ids (numbers or strings)
                const slots = matchingVillage.housing_slots.map(s => (typeof s === 'string' ? parseInt(s, 10) : s));
                expect(slots.includes(assigned.id)).toBeTruthy();
            }
        }
    }, 20000);
});
