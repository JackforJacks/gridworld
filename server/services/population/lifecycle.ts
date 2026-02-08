// Population Lifecycle Management - Handles growth, aging, and life cycle events
import config from '../../config/server';
import storage from '../storage';
import * as deps from './dependencyContainer';
import { checkIsMale } from '../populationState/types';
import {
    DAYS_PER_YEAR,
    SENESCENCE_START_AGE,
    BASE_ANNUAL_DEATH_CHANCE,
    DEATH_CHANCE_INCREASE_PER_YEAR
} from '../../config/gameBalance';
import { CalendarDate, PersonData, FamilyData } from '../../../types/global';

// ===== Type Definitions =====

/** Calendar service interface */
interface CalendarService {
    getCurrentDate(): CalendarDate;
    getState(): { currentDate: CalendarDate } | null;
}

/** Population service instance interface */
interface PopulationServiceInstance {
    growthInterval: ReturnType<typeof setInterval> | null;
    io: { emit: (event: string, data: unknown) => void } | null;
    loadData(): Promise<{ [tileId: string]: number }>;
    updatePopulation(tileId: string, population: number): Promise<void>;
    broadcastUpdate(): Promise<void>;
    getAllPopulationData(): Promise<PopulationData>;
    trackDeaths?(count: number): void;
    trackBirths?(count: number): void;
}

/** Population data structure */
interface PopulationData {
    tilePopulations: { [tileId: string]: number };
    totalPopulation: number;
    totalTiles: number;
    lastUpdated: string;
}

/** Residency update structure */
interface ResidencyUpdate {
    personId: number;
    newResidency: number;
}

/** Family events result */
interface FamilyEventsResult {
    deliveries: number;
    newPregnancies: number;
}

/** PopulationState module interface */
interface PopulationStateModule {
    isRestarting: boolean;
    getAllPeople(): Promise<PersonData[]>;
    getAllFamilies(): Promise<FamilyData[]>;
    getFamily(familyId: number): Promise<FamilyData | null>;
    getPerson(personId: number): Promise<PersonData | null>;
    updatePerson(personId: number, updates: Partial<PersonData>): Promise<void>;
    updateFamily(familyId: number, updates: Partial<FamilyData>): Promise<void>;
    batchClearFamilyIds(personIds: number[]): Promise<void>;
    batchDeleteFamilies(familyIds: number[], markForDeletion: boolean): Promise<void>;
    batchRemovePersons(personIds: number[], markForDeletion: boolean): Promise<void>;
    batchUpdateResidency(updates: ResidencyUpdate[]): Promise<void>;
    removeFertileFamily(familyId: number): Promise<void>;
    addEligiblePerson(personId: number, isMale: boolean, tileId: number): Promise<boolean>;
}

/** Calculator module interface */
interface CalculatorModule {
    calculateAge(birthDate: string, currentYear: number, currentMonth: number, currentDay: number): number;
}

/** FamilyManager module interface */
interface FamilyManagerModule {
    processDeliveries(_pool: unknown, calendarService?: CalendarService, serviceInstance?: PopulationServiceInstance, daysAdvanced?: number): Promise<number>;
    startPregnancy(_pool: unknown, calendarService?: CalendarService, familyId?: number): Promise<boolean>;
}

/**
 * Starts population growth simulation
 * @param serviceInstance - The population service instance
 */
function startGrowth(serviceInstance: PopulationServiceInstance): void {
    stopGrowth(serviceInstance);
    serviceInstance.growthInterval = setInterval(async () => {
        try {
            await updatePopulations(serviceInstance);
        } catch (error: unknown) {
            console.error('❌ Error updating populations:', error);
        }
    }, config.populationGrowthInterval);
    // Population growth started. (log suppressed)
}

/**
 * Stops population growth simulation
 * @param serviceInstance - The population service instance
 */
function stopGrowth(serviceInstance: PopulationServiceInstance): void {
    if (serviceInstance.growthInterval) {
        clearInterval(serviceInstance.growthInterval);
        serviceInstance.growthInterval = null;
    }
}

/**
 * Updates all populations based on growth rate
 * @param serviceInstance - The population service instance
 */
async function updatePopulations(serviceInstance: PopulationServiceInstance): Promise<void> {
    const populations = await serviceInstance.loadData();
    const habitableTileIds = Object.keys(populations);

    if (habitableTileIds.length === 0) return;

    const growthRate = config.defaultGrowthRate;
    let totalGrowth = 0;

    for (const tileId of habitableTileIds) {
        const growth = calculateGrowthForTile(tileId, growthRate);
        const currentPopulation = populations[tileId];
        const newPopulation = currentPopulation + growth;
        totalGrowth += growth;

        if (growth !== 0) {
            await serviceInstance.updatePopulation(tileId, newPopulation);
        }
    }

    if (totalGrowth > 0) {
        await serviceInstance.broadcastUpdate();
    }
}

/**
 * Calculates growth for a specific tile
 * @param tileId - The tile ID
 * @param baseGrowthRate - Base growth rate
 * @returns Growth amount
 */
function calculateGrowthForTile(tileId: string | number, baseGrowthRate: number): number {
    // Basic growth rate implementation
    // This could be enhanced with more complex factors like:
    // - Resource availability
    // - Population density
    // - Environmental factors
    return baseGrowthRate;
}

/**
 * Updates growth rate configuration
 * @param serviceInstance - The population service instance
 * @param rate - New growth rate
 * @returns Updated population data
 */
async function updateGrowthRate(serviceInstance: PopulationServiceInstance, rate: number): Promise<PopulationData> {
    if (typeof rate !== 'number' || rate < 0) {
        throw new Error('Growth rate must be a non-negative number');
    }

    const responseData = await serviceInstance.getAllPopulationData();
    if (serviceInstance.io) {
        serviceInstance.io.emit('populationUpdate', responseData);
    }
    return responseData;
}

/**
 * Applies senescence (aging deaths) to the population - storage-only (Postgres deletes happen on Save)
 * @param pool - Database pool instance (used for family queries only)
 * @param calendarService - Calendar service instance
 * @param populationServiceInstance - Population service instance
 * @param daysAdvanced - Number of days that passed in this tick (default 1)
 * @returns Number of deaths
 */
async function applySenescence(
    _pool: unknown,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    daysAdvanced: number = 1
): Promise<number> {
    try {
        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;

        if (!PopulationState || !storage.isAvailable()) {
            console.warn('⚠️ Storage not available - cannot process senescence');
            return 0;
        }

        let currentYear = 4000, currentMonth = 1, currentDay = 1;
        try {
            if (calendarService && typeof calendarService.getState === 'function') {
                const state = calendarService.getState();
                if (state && state.currentDate) {
                    currentYear = state.currentDate.year;
                    currentMonth = state.currentDate.month;
                    currentDay = state.currentDate.day;
                }
            }
        } catch (e: unknown) {
            console.warn('Using fallback calendar date for senescence due to error:', e);
        }

        const calculator = deps.getCalculator() as CalculatorModule | null;
        if (!calculator) {
            console.warn('⚠️ Calculator not available - cannot process senescence');
            return 0;
        }

        const deaths: number[] = [];
        const deathFamilyIds: number[] = []; // Family IDs of deceased persons

        // Use HSCAN streaming to avoid loading all people into memory
        const personStream = storage.hscanStream('person', { count: 500 });

        for await (const result of personStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;

                let person: PersonData | null = null;
                try { person = JSON.parse(json) as PersonData; } catch { continue; }
                if (!person || !person.date_of_birth) continue;

                const age = calculator.calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
                if (age >= SENESCENCE_START_AGE) {
                    // Annual death probability: starts at base rate, increases per year after senescence
                    const annualDeathChance = BASE_ANNUAL_DEATH_CHANCE + (age - SENESCENCE_START_AGE) * DEATH_CHANCE_INCREASE_PER_YEAR;
                    // Daily probability
                    const dailyDeathChance = annualDeathChance / DAYS_PER_YEAR;
                    // Probability of dying at least once in N days: 1 - (1 - p)^N
                    const multiDayDeathChance = 1 - Math.pow(1 - dailyDeathChance, daysAdvanced);
                    if (Math.random() < multiDayDeathChance) {
                        deaths.push(person.id);
                        // Track family_id for efficient lookup later
                        if (person.family_id) {
                            deathFamilyIds.push(person.family_id);
                        }
                    }
                }
            }
        }

        if (deaths.length > 0) {
            // Handle family cleanup - only fetch families of deceased persons
            const deathIds = new Set<number>(deaths);
            const uniqueFamilyIds = [...new Set(deathFamilyIds)];

            // Collect all person IDs that need family_id cleared and families to delete
            const personIdsToClear: number[] = [];
            const familyIdsToDelete: number[] = [];
            // Track surviving spouses to re-add to eligible pool
            const survivingSpouses: { personId: number; isMale: boolean; tileId: number }[] = [];

            // Batch fetch only the families we need (not ALL families)
            if (uniqueFamilyIds.length > 0) {
                const pipeline = storage.pipeline();
                for (const fid of uniqueFamilyIds) {
                    pipeline.hget('family', fid.toString());
                }
                const familyResults = await pipeline.exec() as [Error | null, string | null][];

                for (let i = 0; i < familyResults.length; i++) {
                    const [err, familyJson] = familyResults[i];
                    if (err || !familyJson) continue;

                    let family: FamilyData | null = null;
                    try { family = JSON.parse(familyJson) as FamilyData; } catch { continue; }
                    if (!family) continue;

                    // Check if husband or wife died
                    const husbandDied = family.husband_id !== null && deathIds.has(family.husband_id);
                    const wifeDied = family.wife_id !== null && deathIds.has(family.wife_id);

                    if (husbandDied || wifeDied) {
                        // Track surviving spouse for re-adding to eligible pool
                        if (husbandDied && !wifeDied && family.wife_id !== null) {
                            survivingSpouses.push({ personId: family.wife_id, isMale: false, tileId: family.tile_id });
                        }
                        if (wifeDied && !husbandDied && family.husband_id !== null) {
                            survivingSpouses.push({ personId: family.husband_id, isMale: true, tileId: family.tile_id });
                        }

                        // Collect all family members for batch update
                        if (family.husband_id !== null) personIdsToClear.push(family.husband_id);
                        if (family.wife_id !== null) personIdsToClear.push(family.wife_id);
                        for (const childId of (family.children_ids || [])) {
                            personIdsToClear.push(childId);
                        }
                        familyIdsToDelete.push(family.id);
                    }
                }
            }

            // Batch clear family_id for all affected persons
            if (personIdsToClear.length > 0) {
                await PopulationState.batchClearFamilyIds(personIdsToClear);
            }

            // Batch delete families (tracks positive IDs for Postgres deletion)
            if (familyIdsToDelete.length > 0) {
                await PopulationState.batchDeleteFamilies(familyIdsToDelete, true);
            }

            // Batch remove deceased persons from Redis
            await PopulationState.batchRemovePersons(deaths, true);

            // Re-add surviving spouses to eligible pool if they meet age criteria
            for (const spouse of survivingSpouses) {
                try {
                    const person = await PopulationState.getPerson(spouse.personId);
                    if (!person || !person.date_of_birth) continue;

                    const age = calculator.calculateAge(person.date_of_birth, currentYear, currentMonth, currentDay);
                    // Check age eligibility: males 16-45, females 16-33
                    const maxAge = spouse.isMale ? 45 : 33;
                    if (age >= 16 && age <= maxAge) {
                        await PopulationState.addEligiblePerson(spouse.personId, spouse.isMale, spouse.tileId);
                    }
                } catch (e) {
                    console.warn('[lifecycle] Failed to re-add widower to eligible pool:', spouse.personId);
                }
            }

            if (populationServiceInstance && typeof populationServiceInstance.trackDeaths === 'function') {
                populationServiceInstance.trackDeaths(deaths.length);
            }
            return deaths.length;
        }
        return 0;
    } catch (error: unknown) {
        console.error('Error applying senescence:', error);
        return 0;
    }
}

/**
 * Processes family events (pregnancies, births) for the tick
 * @param pool - Database pool instance
 * @param calendarService - Calendar service instance
 * @param serviceInstance - Population service instance
 * @param daysAdvanced - Number of days that passed in this tick (default 1)
 * @returns Family events summary
 */
async function processDailyFamilyEvents(
    _pool: unknown,
    calendarService: CalendarService | null,
    serviceInstance: PopulationServiceInstance | null,
    daysAdvanced: number = 1
): Promise<FamilyEventsResult> {
    try {
        const familyManager = deps.getFamilyManager() as FamilyManagerModule | null;
        const PopulationState = deps.getPopulationState() as unknown as PopulationStateModule | null;
        const calculator = deps.getCalculator() as CalculatorModule | null;

        if (!familyManager || !PopulationState || !calculator) {
            return { deliveries: 0, newPregnancies: 0 };
        }

        // Skip if restart is in progress
        if (PopulationState.isRestarting) {
            return { deliveries: 0, newPregnancies: 0 };
        }

        // Process deliveries for families ready to give birth (pass daysAdvanced for delivery timing)
        const deliveries = await familyManager.processDeliveries(undefined, calendarService as CalendarService, serviceInstance as PopulationServiceInstance, daysAdvanced);

        // Get current calendar date for age calculations
        let currentDate: CalendarDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Use storage-based fertile family set for faster pregnancy processing
        const candidateCount = parseInt(await storage.scard('eligible:pregnancy:families'), 10) || 0;
        const sampleCount = Math.min(candidateCount, 60); // sample up to 60 and process up to 30
        const sampled: string[] = sampleCount > 0 ? (await storage.smembers('eligible:pregnancy:families')).sort(() => 0.5 - Math.random()).slice(0, sampleCount) : [];

        let newPregnancies = 0;
        for (const fid of sampled) {
            const familyId = parseInt(fid, 10);
            try {
                const family = await PopulationState.getFamily(familyId);
                if (!family) continue;
                // Ensure family is still eligible
                if (family.pregnancy) continue;

                const wife = family.wife_id !== null ? await PopulationState.getPerson(family.wife_id) : null;
                if (!wife || !wife.date_of_birth) continue;
                const wifeAge = calculator.calculateAge(wife.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
                if (wifeAge > 33) {
                    // Remove from fertile set if aged out
                    try { await PopulationState.removeFertileFamily(familyId); } catch (e: unknown) { console.warn('[lifecycle] Failed to remove aged-out family from fertile set:', familyId, (e as Error)?.message ?? e); }
                    continue;
                }

                // 25% daily chance of pregnancy, adjusted for multiple days
                // Probability of pregnancy in N days: 1 - (1 - 0.25)^N
                const dailyPregnancyChance = 0.25;
                const multiDayPregnancyChance = 1 - Math.pow(1 - dailyPregnancyChance, daysAdvanced);
                if (Math.random() < multiDayPregnancyChance) {
                    try {
                        const started = await familyManager.startPregnancy(undefined, calendarService as CalendarService, familyId);
                        if (started) newPregnancies++;
                    } catch (error: unknown) {
                        // Silently ignore expected errors (wife too old, lock contention)
                        // The family will be removed from the set or retried automatically
                    }
                }
            } catch (err: unknown) {
                // Silently ignore processing errors - they'll be retried next tick
            }
        }

        // Release children who reach adulthood (age >= 16) from their family - use HSCAN streaming
        let releasedAdults = 0;
        const personStream = storage.hscanStream('person', { count: 500 });

        for await (const result of personStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;

                let person: PersonData | null = null;
                try { person = JSON.parse(json) as PersonData; } catch { continue; }
                if (!person || !person.family_id || !person.date_of_birth) continue;

                const age = calculator.calculateAge(person.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
                if (age >= 16) {
                    // Check if this person is a child (not the husband or wife) - use Redis
                    const family = await PopulationState.getFamily(person.family_id);
                    if (family) {
                        if (person.id !== family.husband_id && person.id !== family.wife_id) {
                            await PopulationState.updatePerson(person.id, { family_id: null });
                            // Also remove from children_ids
                            const newChildrenIds = (family.children_ids || []).filter(cid => cid !== person.id);
                            await PopulationState.updateFamily(family.id, { children_ids: newChildrenIds });

                            // Add newly released adult to eligible matchmaking sets
                            try {
                                // Use shared helper that handles all formats
                                const isMale = checkIsMale(person.sex);
                                const maxAge = isMale ? 45 : 33;
                                if (person.tile_id !== null && age >= 16 && age <= maxAge) {
                                    await PopulationState.addEligiblePerson(person.id, isMale, person.tile_id);
                                }
                            } catch (e: unknown) {
                                const eMessage = e instanceof Error ? e.message : String(e);
                                console.warn('[lifecycle] addEligiblePerson failed for released adult:', eMessage);
                            }

                            releasedAdults++;
                        }
                    }
                }
            }
        }

        if (deliveries > 0 || newPregnancies > 0) {
            // Quiet: daily family events occurred (log suppressed)
        }

        return {
            deliveries,
            newPregnancies
        };
    } catch (error: unknown) {
        console.error('Error processing daily family events:', error);
        return { deliveries: 0, newPregnancies: 0 };
    }
}

export {
    startGrowth,
    stopGrowth,
    updatePopulations,
    calculateGrowthForTile,
    updateGrowthRate,
    applySenescence,
    processDailyFamilyEvents
};

export type { PopulationData };
