// Population Family Operations - Enhanced with family table integration
import { addPeopleToTile, removePeopleFromTile } from './manager';
import * as deps from './dependencyContainer';
import { Pool } from 'pg';
import { FamilyData, CalendarDate } from '../../../types/global';

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
    createFamily: (pool: Pool | null, husbandId: number, wifeId: number, tileId: number) => Promise<FamilyData | null>;
    startPregnancy: (pool: Pool | null, calendarService: CalendarService | null, familyId: number) => Promise<boolean>;
    deliverBaby: (pool: Pool | null, calendarService: CalendarService | null, familyId: number, populationServiceInstance: PopulationServiceInstance | null) => Promise<unknown>;
    processDeliveries: (pool: Pool | null, calendarService: CalendarService | null, populationServiceInstance: PopulationServiceInstance | null, daysAdvanced?: number) => Promise<number>;
    getFamiliesOnTile: (pool: Pool | null, tileId: number) => Promise<FamilyData[]>;
}

// Interface for population state module
interface PopulationStateModule {
    addFertileFamily: (familyId: number, tileId: number) => Promise<boolean>;
}

/**
 * Enhanced Procreation function with family management
 */
async function Procreation(
    pool: Pool,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    tileId: number,
    population: number
): Promise<void> {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
        const currentCount = parseInt(result.rows[0].count, 10);

        let calendarDateToUse;
        if (calendarService && typeof calendarService.getState === 'function') {
            const calendarState = calendarService.getState();
            if (calendarState && calendarState.currentDate) {
                calendarDateToUse = calendarState.currentDate;
            } else {
                console.warn('[family.js.Procreation] CalendarService.getState() did not return a valid currentDate. Using an absolute fallback (Year 1, Month 1, Day 1).');
                calendarDateToUse = { year: 1, month: 1, day: 1 };
            }
        } else {
            console.warn('[family.js.Procreation] CalendarService not available or getState is not a function. Using an absolute fallback (Year 1, Month 1, Day 1).');
            calendarDateToUse = { year: 1, month: 1, day: 1 };
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = calendarDateToUse;

        if (population > currentCount) {
            const birthCount = population - currentCount;

            // Try to handle births through existing families first
            const familyManager = deps.getFamilyManager() as unknown as FamilyManagerModule;
            await familyManager.processDeliveries(pool, calendarService, populationServiceInstance);

            // Check if we still need more people after deliveries
            const updatedResult = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
            const updatedCount = parseInt(updatedResult.rows[0].count, 10);
            const remainingNeeded = population - updatedCount;

            if (remainingNeeded > 0) {
                await addPeopleToTile(pool, tileId, remainingNeeded, currentYear, currentMonth, currentDay, populationServiceInstance, true);

                // Potentially create new families from new adults
                await createRandomFamilies(pool, tileId);
            }
        } else if (population < currentCount) {
            const deathCount = currentCount - population;
            await removePeopleFromTile(pool, tileId, deathCount, populationServiceInstance, true);
        }

        if (populationServiceInstance && typeof populationServiceInstance.broadcastUpdate === 'function') {
            await populationServiceInstance.broadcastUpdate('populationUpdate');
        } else {
            console.warn('[family.js.Procreation] populationServiceInstance.broadcastUpdate is not a function. Update not broadcasted.');
        }
    } catch (error: unknown) {
        console.error(`[family.js.Procreation] Error updating population for tile ${tileId}:`, error);
        throw error;
    }
}

/**
 * Creates random families from available adults on a tile
 */
async function createRandomFamilies(
    pool: Pool,
    tileId: number,
    calendarService: CalendarService | null = null
): Promise<void> {
    try {
        // Get current simulation date
        let cutoffDate;
        if (calendarService) {
            const currentDate = calendarService.getCurrentDate();
            const cutoffYear = currentDate.year - 18;
            cutoffDate = `${cutoffYear}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`;
        } else {
            // Fallback to real date (shouldn't be used in simulation)
            const currentDate = new Date();
            const eighteenYearsAgo = new Date(currentDate.getFullYear() - 18, currentDate.getMonth(), currentDate.getDate());
            cutoffDate = eighteenYearsAgo.toISOString().split('T')[0];
        }

        console.log(`[family.js] Looking for adults born before ${cutoffDate} on tile ${tileId}`);

        const eligibleMales = await pool.query(`
            SELECT p.id FROM people p
            LEFT JOIN family f1 ON p.id = f1.husband_id
            LEFT JOIN family f2 ON p.id = f2.wife_id
            WHERE p.tile_id = $1 AND p.sex = TRUE AND p.date_of_birth <= $2
            AND f1.husband_id IS NULL AND f2.wife_id IS NULL
            ORDER BY RANDOM()
        `, [tileId, cutoffDate]);

        const eligibleFemales = await pool.query(`
            SELECT p.id FROM people p
            LEFT JOIN family f1 ON p.id = f1.husband_id
            LEFT JOIN family f2 ON p.id = f2.wife_id
            WHERE p.tile_id = $1 AND p.sex = FALSE AND p.date_of_birth <= $2
            AND f1.husband_id IS NULL AND f2.wife_id IS NULL
            ORDER BY RANDOM()
        `, [tileId, cutoffDate]);

        const males = eligibleMales.rows;
        const females = eligibleFemales.rows;
        const maxPairs = Math.min(males.length, females.length);

        // Create families with random pairing
        for (let i = 0; i < maxPairs && i < 5; i++) { // Limit to 5 new families per tile per update
            try {
                const familyManager = deps.getFamilyManager() as unknown as FamilyManagerModule;
                const newFamily = await familyManager.createFamily(pool, males[i].id, females[i].id, tileId);

                // Register the family as fertile candidate if applicable
                try {
                    if (newFamily) {
                        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;
                        if (PopulationState) {
                            await PopulationState.addFertileFamily(newFamily.id, tileId);
                        }
                    }
                } catch (_: unknown) { /* ignore */ }

                // 30% chance of immediate pregnancy for new families
                if (Math.random() < 0.3) {
                    const familyResult = await pool.query(
                        'SELECT id FROM family WHERE husband_id = $1 AND wife_id = $2',
                        [males[i].id, females[i].id]
                    );
                    if (familyResult.rows.length > 0) {
                        try {
                            const fmStartPregnancy = deps.getFamilyManager() as unknown as FamilyManagerModule;
                            await fmStartPregnancy.startPregnancy(pool, null, familyResult.rows[0].id);
                        } catch (err: unknown) {
                            const errMessage = err instanceof Error ? err.message : String(err);
                            console.warn(`[family.createRandomFamilies] startPregnancy failed for family ${familyResult.rows[0].id}: ${errMessage}`);
                        }
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
