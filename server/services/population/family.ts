// Population Family Operations - Enhanced with family table integration (Redis-first)
import { addPeopleToTile, removePeopleFromTile } from './manager';
import * as deps from './dependencyContainer';
import { FamilyData, CalendarDate } from '../../../types/global';
import storage from '../storage';
import PopulationState from '../populationState';
import FamilyState from '../populationState/FamilyState';

// Interface for calendar service dependency injection
interface CalendarService {
    getState(): { currentDate: CalendarDate } | null;
    getCurrentDate(): CalendarDate;
}

// Interface for population service dependency injection
interface PopulationServiceInstance {
    broadcastUpdate(eventType: string): Promise<void>;
    trackBirths?(count: number): void;
}

// Interface for family manager module
interface FamilyManagerModule {
    createFamily: (_pool: unknown, husbandId?: number, wifeId?: number, tileId?: number) => Promise<{ family: FamilyData | null } | null>;
    startPregnancy: (_pool: unknown, calendarService?: CalendarService | null, familyId?: number) => Promise<boolean>;
    deliverBaby: (_pool: unknown, calendarService?: CalendarService | null, familyId?: number, populationServiceInstance?: PopulationServiceInstance | null) => Promise<unknown>;
    processDeliveries: (_pool: unknown, calendarService?: CalendarService | null, populationServiceInstance?: PopulationServiceInstance | null, daysAdvanced?: number) => Promise<number>;
    getFamiliesOnTile: (_pool: unknown, tileId?: number) => Promise<FamilyData[]>;
}

// Interface for population state module
interface PopulationStateModule {
    addFertileFamily: (familyId: number, tileId: number) => Promise<boolean>;
}

/**
 * Enhanced Procreation function with family management - Redis-first implementation
 */
async function Procreation(
    _pool: unknown,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    tileId: number,
    population: number
): Promise<void> {
    void _pool; // Unused - kept for API compatibility
    try {
        // Get current population from Redis
        let currentCount = 0;
        if (storage.isAvailable()) {
            const tilePopulations = await PopulationState.getAllTilePopulations();
            currentCount = tilePopulations[tileId] || 0;
        }

        let calendarDateToUse;
        if (calendarService && typeof calendarService.getState === 'function') {
            const calendarState = calendarService.getState();
            if (calendarState && calendarState.currentDate) {
                calendarDateToUse = calendarState.currentDate;
            } else {
                console.warn('[family.Procreation] CalendarService.getState() did not return a valid currentDate. Using an absolute fallback (Year 1, Month 1, Day 1).');
                calendarDateToUse = { year: 1, month: 1, day: 1 };
            }
        } else {
            console.warn('[family.Procreation] CalendarService not available or getState is not a function. Using an absolute fallback (Year 1, Month 1, Day 1).');
            calendarDateToUse = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = calendarDateToUse;

        if (population > currentCount) {
            // Try to handle births through existing families first
            const familyManager = deps.getFamilyManager() as unknown as FamilyManagerModule;
            await familyManager.processDeliveries(null, calendarService, populationServiceInstance);

            // Check if we still need more people after deliveries (from Redis)
            let updatedCount = 0;
            if (storage.isAvailable()) {
                const updatedPopulations = await PopulationState.getAllTilePopulations();
                updatedCount = updatedPopulations[tileId] || 0;
            }
            const remainingNeeded = population - updatedCount;

            if (remainingNeeded > 0) {
                await addPeopleToTile(null, tileId, remainingNeeded, currentYear, currentMonth, currentDay, populationServiceInstance, true);

                // Potentially create new families from new adults
                await createRandomFamilies(null, tileId, calendarService);
            }
        } else if (population < currentCount) {
            const deathCount = currentCount - population;
            await removePeopleFromTile(null, tileId, deathCount, populationServiceInstance, true);
        }

        if (populationServiceInstance && typeof populationServiceInstance.broadcastUpdate === 'function') {
            await populationServiceInstance.broadcastUpdate('populationUpdate');
        } else {
            console.warn('[family.Procreation] populationServiceInstance.broadcastUpdate is not a function. Update not broadcasted.');
        }
    } catch (error: unknown) {
        console.error(`[family.Procreation] Error updating population for tile ${tileId}:`, error);
        throw error;
    }
}

/**
 * Creates random families from available adults on a tile - Redis-first implementation
 */
async function createRandomFamilies(
    _pool: unknown,
    tileId: number,
    calendarService: CalendarService | null = null
): Promise<void> {
    void _pool; // Unused - kept for API compatibility
    try {
        if (!storage.isAvailable()) {
            console.warn('[family.createRandomFamilies] Storage not available');
            return;
        }

        // Get eligible people from Redis eligible sets
        const eligibleMaleIds = await PopulationState.getEligiblePeople(true, tileId);
        const eligibleFemaleIds = await PopulationState.getEligiblePeople(false, tileId);

        // Shuffle to get random pairing
        const shuffledMales = [...eligibleMaleIds].sort(() => Math.random() - 0.5);
        const shuffledFemales = [...eligibleFemaleIds].sort(() => Math.random() - 0.5);

        const maxPairs = Math.min(shuffledMales.length, shuffledFemales.length);

        console.log(`[family] Found ${shuffledMales.length} eligible males and ${shuffledFemales.length} eligible females on tile ${tileId}`);

        // Create families with random pairing
        for (let i = 0; i < maxPairs && i < 5; i++) { // Limit to 5 new families per tile per update
            try {
                const husbandId = parseInt(shuffledMales[i], 10);
                const wifeId = parseInt(shuffledFemales[i], 10);

                const familyManager = deps.getFamilyManager() as unknown as FamilyManagerModule;
                const createResult = await familyManager.createFamily(null, husbandId, wifeId, tileId);
                const newFamily = createResult?.family ?? null;

                // Register the family as fertile candidate if applicable
                try {
                    if (newFamily) {
                        const PopulationStateModule = deps.getPopulationState() as unknown as PopulationStateModule | null;
                        if (PopulationStateModule) {
                            await PopulationStateModule.addFertileFamily(newFamily.id, tileId);
                        }
                    }
                } catch (_: unknown) { /* ignore */ }

                // 30% chance of immediate pregnancy for new families
                if (newFamily && Math.random() < 0.3) {
                    try {
                        const fmStartPregnancy = deps.getFamilyManager() as unknown as FamilyManagerModule;
                        await fmStartPregnancy.startPregnancy(null, calendarService, newFamily.id);
                    } catch (err: unknown) {
                        const errMessage = err instanceof Error ? err.message : String(err);
                        console.warn(`[family.createRandomFamilies] startPregnancy failed for family ${newFamily.id}: ${errMessage}`);
                    }
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.warn(`Failed to create family: ${errorMessage}`);
            }
        }
    } catch (error: unknown) {
        console.error('Error creating random families:', error);
    }
}

// Re-export family management functions (lazy-loaded to avoid circular deps)
const createFamilyFn = (): FamilyManagerModule['createFamily'] => (deps.getFamilyManager() as unknown as FamilyManagerModule).createFamily;
const startPregnancyFn = (): FamilyManagerModule['startPregnancy'] => (deps.getFamilyManager() as unknown as FamilyManagerModule).startPregnancy;
const deliverBabyFn = (): FamilyManagerModule['deliverBaby'] => (deps.getFamilyManager() as unknown as FamilyManagerModule).deliverBaby;
const processDeliveriesFn = (): FamilyManagerModule['processDeliveries'] => (deps.getFamilyManager() as unknown as FamilyManagerModule).processDeliveries;
const getFamiliesOnTileFn = (): FamilyManagerModule['getFamiliesOnTile'] => (deps.getFamilyManager() as unknown as FamilyManagerModule).getFamiliesOnTile;

export {
    Procreation,
    createRandomFamilies,
    createFamilyFn as createFamily,
    startPregnancyFn as startPregnancy,
    deliverBabyFn as deliverBaby,
    processDeliveriesFn as processDeliveries,
    getFamiliesOnTileFn as getFamiliesOnTile
};
