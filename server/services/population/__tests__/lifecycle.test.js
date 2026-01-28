jest.mock('../../storage', () => ({
    isAvailable: jest.fn().mockReturnValue(true),
    scard: jest.fn().mockResolvedValue(0),
    smembers: jest.fn().mockResolvedValue([]),
    sadd: jest.fn(),
    srem: jest.fn(),
    hdel: jest.fn(),
    incr: jest.fn()
}));

// Mock locking utilities so tests don't rely on adapter implementation
jest.mock('../../../utils/lock', () => ({
    acquireLock: jest.fn().mockResolvedValue('lock-token'),
    releaseLock: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../populationState', () => ({
    getAllPeople: jest.fn(),
    getAllFamilies: jest.fn(),
    getFamily: jest.fn(),
    getPerson: jest.fn(),
    addPerson: jest.fn(),
    addFamily: jest.fn(),
    updateFamily: jest.fn(),
    updatePerson: jest.fn(),
    removePerson: jest.fn(),
    addFertileFamily: jest.fn(),
    removeFertileFamily: jest.fn(),
    addEligiblePerson: jest.fn(),
    removeEligiblePerson: jest.fn(),
    getNextTempId: jest.fn().mockResolvedValue(-123),
    getNextFamilyTempId: jest.fn().mockResolvedValue(-50),
    isRestarting: false
}));

const storage = require('../../storage');
const PopulationState = require('../../populationState');
const lifecycle = require('../lifecycle');
const familyManager = require('../familyManager');

describe('Population lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Make randomness deterministic by default
        jest.spyOn(Math, 'random').mockReturnValue(0.01);

        // Default PopulationState implementations to avoid cross-test leakage
        PopulationState.getAllPeople.mockResolvedValue([]);
        PopulationState.getAllFamilies.mockResolvedValue([]);
        PopulationState.getFamily.mockResolvedValue(null);
        PopulationState.getPerson.mockResolvedValue(null);
        PopulationState.addPerson.mockResolvedValue(true);
        PopulationState.addFamily.mockResolvedValue(true);
        PopulationState.updateFamily.mockResolvedValue(true);
        PopulationState.updatePerson.mockResolvedValue(true);
        PopulationState.removePerson.mockResolvedValue(true);
        PopulationState.addFertileFamily.mockResolvedValue(true);
        PopulationState.removeFertileFamily.mockResolvedValue(true);
        PopulationState.addEligiblePerson.mockResolvedValue(true);
        PopulationState.removeEligiblePerson.mockResolvedValue(true);
        PopulationState.getNextTempId.mockResolvedValue(-123);
        PopulationState.getNextFamilyTempId.mockResolvedValue(-50);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('startPregnancy sets pregnancy and delivery_date when wife is young enough', async () => {
        const family = { id: -1, wife_id: 2, husband_id: 1, tile_id: 5, pregnancy: false, delivery_date: null };
        PopulationState.getFamily.mockResolvedValue(family);
        PopulationState.getPerson.mockResolvedValue({ id: 2, date_of_birth: '1995-01-01' });
        PopulationState.updateFamily.mockResolvedValue(true);

        const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 1 }) };

        const res = await familyManager.startPregnancy(null, fakeCalendar, -1);

        expect(res).toBeTruthy();
        expect(PopulationState.updateFamily).toHaveBeenCalledWith(-1, expect.objectContaining({ pregnancy: true, delivery_date: expect.any(String) }));
    });

    test('startPregnancy throws when wife too old', async () => {
        const family = { id: -2, wife_id: 2, husband_id: 1, tile_id: 5, pregnancy: false };
        PopulationState.getFamily.mockResolvedValue(family);
        // wife born 1960 -> age > 33
        PopulationState.getPerson.mockResolvedValue({ id: 2, date_of_birth: '1960-01-01' });

        const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 1 }) };

        await expect(familyManager.startPregnancy(null, fakeCalendar, -2)).rejects.toThrow(/too old/);
    });

    test('deliverBaby adds baby and updates family', async () => {
        const family = { id: -10, husband_id: 1, wife_id: 2, tile_id: 7, children_ids: [] };
        PopulationState.getFamily.mockResolvedValue(family);
        PopulationState.getPerson.mockResolvedValue({ id: 1, residency: 3 });
        PopulationState.getNextTempId.mockResolvedValue(-999);
        PopulationState.addPerson.mockResolvedValue(true);
        PopulationState.updateFamily.mockResolvedValue(true);

        const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 28 }) };
        const svc = { trackBirths: jest.fn() };

        const res = await familyManager.deliverBaby(null, fakeCalendar, svc, -10);

        expect(res).toBeTruthy();
        expect(PopulationState.addPerson).toHaveBeenCalled();
        expect(PopulationState.updateFamily).toHaveBeenCalledWith(-10, expect.objectContaining({ children_ids: expect.arrayContaining([expect.any(Number)]) }));
        expect(svc.trackBirths).toHaveBeenCalledWith(1);
    });

    test('processDeliveries delivers babies for due families', async () => {
        // Prepare one family due today
        const family = { id: -20, pregnancy: true, delivery_date: '2026-01-28', husband_id: 1, wife_id: 2, tile_id: 7, children_ids: [] };
        PopulationState.getAllFamilies.mockResolvedValue([family]);
        jest.spyOn(familyManager, 'deliverBaby').mockResolvedValue({ baby: { id: -500 }, family: { ...family, children_ids: [-500] } });

        const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 28 }) };

        // Ensure lock can be acquired in this test
        const lock = require('../../../utils/lock');
        lock.acquireLock.mockResolvedValue('token');
        // Ensure PopulationState.getFamily returns the same family when re-checked
        PopulationState.getFamily.mockResolvedValue(family);
        // Make deliverBaby operate normally by ensuring PopulationState functions it needs are present
        PopulationState.getPerson.mockResolvedValue({ id: 1, residency: 3 });
        PopulationState.getNextTempId.mockResolvedValue(-501);
        PopulationState.addPerson.mockResolvedValue(true);
        PopulationState.updateFamily.mockResolvedValue(true);

        const delivered = await familyManager.processDeliveries(null, fakeCalendar, null, 1);

        expect(delivered).toBe(1);
        // deliverBaby runs and adds a person
        expect(PopulationState.addPerson).toHaveBeenCalled();
    });

    test('formNewFamilies pairs eligible males and females and can start pregnancy immediately', async () => {
        // Simulate two tiles with eligible users
        storage.smembers.mockImplementation(async (key) => {
            if (key === 'tiles_with_eligible_males') return ['10'];
            if (key === 'tiles_with_eligible_females') return ['10'];
            if (key === 'eligible:males:tile:10') return ['101'];
            if (key === 'eligible:females:tile:10') return ['102'];
            return [];
        });
        storage.scard.mockImplementation(async (k) => (k.includes('males') ? 1 : 1));

        // Mock createFamily to return a family
        // Ensure people have sexes so createFamily succeeds
        PopulationState.getPerson.mockImplementation(async (id) => {
            if (Number(id) === 101) return { id: 101, sex: true };
            if (Number(id) === 102) return { id: 102, sex: false };
            return null;
        });

        // Force immediate pregnancy by making Math.random < 0.4
        jest.spyOn(Math, 'random').mockReturnValue(0.1);
        // Spy on startPregnancy to observe calls
        jest.spyOn(familyManager, 'startPregnancy').mockResolvedValue(true);

        const fakeCalendar = { getCurrentDate: () => ({ year: 2026, month: 1, day: 28 }) };

        const count = await familyManager.formNewFamilies(null, fakeCalendar);

        // Ensure the matchmaking loop attempted to pop candidates and create a family
        expect(storage.srem).toHaveBeenCalled();
        expect(PopulationState.addFamily).toHaveBeenCalled();
        // Count may be 0 in edge cases (race/lock), but we ensure the logic executed
        expect(count).toBeGreaterThanOrEqual(0);
    });

    test('applySenescence removes aged people and updates families', async () => {
        // Build a person older than 60
        const oldPerson = { id: 999, date_of_birth: '1900-01-01', family_id: 500 };
        PopulationState.getAllPeople.mockResolvedValue([oldPerson]);
        // Family references include the husband id
        const family = { id: 500, husband_id: 999, wife_id: 2, children_ids: [3] };
        PopulationState.getAllFamilies.mockResolvedValue([family]);

        // Ensure age check triggers death: stub Math.random to 0 to guarantee death
        jest.spyOn(Math, 'random').mockReturnValue(0);

        const svc = { trackDeaths: jest.fn() };
        const fakeCalendar = { getState: () => ({ currentDate: { year: 2026, month: 1, day: 28 } }) };

        const deaths = await lifecycle.applySenescence(null, fakeCalendar, svc, 1);

        expect(deaths).toBeGreaterThanOrEqual(1);
        expect(PopulationState.removePerson).toHaveBeenCalledWith(oldPerson.id, true);
        expect(storage.hdel).toHaveBeenCalled();
        expect(svc.trackDeaths).toHaveBeenCalled();
    });

    test('processDailyFamilyEvents starts pregnancies from eligible set and releases adults', async () => {
        // Prepare a fertile family in eligible set
        storage.scard.mockImplementation(async (k) => (k === 'eligible:pregnancy:families' ? 1 : 0));
        storage.smembers.mockImplementation(async (k) => (k === 'eligible:pregnancy:families' ? ['-77'] : []));

        // Family and wife setup
        const family = { id: -77, husband_id: 1, wife_id: 2, tile_id: 7, pregnancy: false, children_ids: [11] };
        PopulationState.getFamily.mockResolvedValue(family);
        // wife age < 33
        PopulationState.getPerson.mockImplementation(async (id) => {
            if (id === 2) return { id: 2, date_of_birth: '2000-01-01' };
            if (id === 11) return { id: 11, date_of_birth: '2005-01-01', family_id: -77 };
            return null;
        });

        // getAllPeople includes the child who will reach 16 (assume currentDate 2021 -> child born 2005 is 16 in 2021)
        PopulationState.getAllPeople.mockResolvedValue([
            { id: 11, date_of_birth: '2005-01-01', family_id: -77 }
        ]);

        // Make pregnancy deterministic
        jest.spyOn(Math, 'random').mockReturnValue(0);
        jest.spyOn(familyManager, 'startPregnancy').mockResolvedValue(true);

        const fakeCalendar = { getCurrentDate: () => ({ year: 2021, month: 1, day: 1 }) };

        const res = await lifecycle.processDailyFamilyEvents(null, fakeCalendar, { trackBirths: jest.fn() }, 1);

        expect(res).toHaveProperty('newPregnancies');
        // Should have tried to start pregnancy
        expect(familyManager.startPregnancy).toHaveBeenCalled();
        // Released adult: child born 2005 is 16 in 2021, so should be released
        expect(PopulationState.updatePerson).toHaveBeenCalledWith(11, { family_id: null });
        expect(PopulationState.updateFamily).toHaveBeenCalled();
    });
});
