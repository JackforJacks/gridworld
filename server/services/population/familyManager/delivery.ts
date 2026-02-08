// Family Manager - Delivery Module
import { ErrorSeverity, safeExecute } from '../../../utils/errorHandler';
import storage from '../../storage';
import serverConfig from '../../../config/server';
import * as deps from '../dependencyContainer';
import { Pool } from 'pg';
import { withLock, familyLockConfig } from '../lockUtils';
import {
    scheduleRetry,
    clearRetryTracking,
    popDueRetries,
    getDeliveryRetryConfig,
    RetryConfig
} from '../retryUtils';
import {
    CalendarService,
    PopulationServiceInstance,
    FamilyRecord,
    DeliveryResult,
    FamilyStats
} from './types';
import { getCurrentDate, formatDate } from './helpers';

/**
 * Internal baby delivery logic (no lock) - called when already holding a lock
 */
async function deliverBabyInternal(
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    familyId: number,
    PopulationState: any
): Promise<DeliveryResult | null> {
    if (!storage.isAvailable()) {
        throw new Error('Storage not available - cannot deliver baby');
    }

    // Get family record from Redis
    const family = await PopulationState.getFamily(familyId) as FamilyRecord | null;
    if (!family) {
        throw new Error('Family not found');
    }

    const currentDate = getCurrentDate(calendarService);
    const birthDate = formatDate(currentDate.year, currentDate.month, currentDate.day);

    // Create baby
    const { getRandomSex } = deps.getCalculator();
    const babySex = getRandomSex();

    const babyId = await PopulationState.getNextId();

    const personObj = {
        id: babyId,
        tile_id: family.tile_id,
        residency: family.tile_id,
        sex: babySex,
        date_of_birth: birthDate,
        health: 100,
        family_id: familyId
    };

    await PopulationState.addPerson(personObj, true);

    // Update family with new child
    const updatedChildrenIds = [...(family.children_ids || []), babyId];
    await PopulationState.updateFamily(familyId, { children_ids: updatedChildrenIds });

    // Track birth
    if (populationServiceInstance?.trackBirths) {
        populationServiceInstance.trackBirths(1);
    }

    await safeExecute(
        () => storage.incr('stats:deliveries:count'),
        'FamilyManager:DeliveriesCount',
        null,
        ErrorSeverity.LOW
    );

    return {
        baby: { id: babyId, sex: babySex, birthDate },
        family: { ...family, children_ids: updatedChildrenIds }
    };
}

/**
 * Delivers a baby and adds to family - storage-only
 * This version acquires its own lock, for standalone use
 */
export async function deliverBaby(
    pool: Pool | null,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    familyId: number
): Promise<DeliveryResult | null> {
    const lockConfig = familyLockConfig(familyId, {
        ttlMs: serverConfig.deliveryLockTtlMs ?? 10000,
        acquireTimeoutMs: serverConfig.deliveryLockAcquireTimeoutMs ?? 0,
        retryDelayMs: serverConfig.deliveryLockRetryDelayMs ?? 0,
        contentionStatsKey: 'stats:deliveries:contention'
    });

    const PopulationState = deps.getPopulationState();

    const result = await withLock(lockConfig, async () => {
        return await deliverBabyInternal(calendarService, populationServiceInstance, familyId, PopulationState);
    });

    if (!result.acquired) {
        return null;
    }

    if (result.error) {
        console.error('Error delivering baby:', result.error);
        throw result.error;
    }

    return result.result ?? null;
}

/**
 * Gets all families on a specific tile - from Redis using HSCAN streaming
 */
export async function getFamiliesOnTile(pool: Pool | null, tileId: number): Promise<FamilyRecord[]> {
    try {
        const families: FamilyRecord[] = [];
        const familyStream = storage.hscanStream('family', { count: 500 });

        for await (const result of familyStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const f = JSON.parse(json) as FamilyRecord;
                    if (f.tile_id === tileId) {
                        families.push(f);
                    }
                } catch { /* ignore */ }
            }
        }
        return families;
    } catch (error) {
        console.error('Error getting families on tile:', error);
        return [];
    }
}

/**
 * Checks for families ready to deliver and processes births
 */
export async function processDeliveries(
    pool: Pool | null,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    daysAdvanced: number = 1
): Promise<number> {
    try {
        const PopulationState = deps.getPopulationState();

        if (PopulationState.isRestarting) {
            return 0;
        }

        const currentDate = getCurrentDate(calendarService);
        const currentDateStr = formatDate(currentDate.year, currentDate.month, currentDate.day);
        const currentDateValue = new Date(currentDateStr).getTime();

        const retryConfig = getDeliveryRetryConfig();

        // Get retry candidates
        const retryCandidateIds = await popDueRetries(retryConfig.retryQueueKey);

        // Get families ready for delivery
        const readyFamilies = await getReadyFamilies(
            PopulationState,
            currentDateValue,
            retryCandidateIds
        );

        let babiesDelivered = 0;

        for (const family of readyFamilies) {
            const delivered = await processOneDelivery(
                pool,
                calendarService,
                populationServiceInstance,
                family,
                PopulationState,
                retryConfig
            );
            if (delivered) {
                babiesDelivered++;
            }
        }

        return babiesDelivered;
    } catch (error) {
        console.error('Error processing deliveries:', error);
        return 0;
    }
}

/** Get families ready for delivery using HSCAN streaming for memory efficiency */
async function getReadyFamilies(
    PopulationState: any,
    currentDateValue: number,
    retryCandidateIds: number[]
): Promise<FamilyRecord[]> {
    const readyFamilies: FamilyRecord[] = [];

    // Use HSCAN streaming to avoid loading all families into memory
    const familyStream = storage.hscanStream('family', { count: 500 });

    for await (const result of familyStream) {
        const entries = result as string[];
        for (let i = 0; i < entries.length; i += 2) {
            const json = entries[i + 1];
            if (!json) continue;

            try {
                const f = JSON.parse(json) as FamilyRecord;
                if (!f.pregnancy || !f.delivery_date) continue;
                const deliveryValue = new Date(f.delivery_date.split('T')[0]).getTime();
                if (deliveryValue <= currentDateValue) {
                    readyFamilies.push(f);
                }
            } catch { /* ignore parse errors */ }
        }
    }

    // Add retry candidates
    for (const id of retryCandidateIds) {
        try {
            const f = await PopulationState.getFamily(id) as FamilyRecord | null;
            if (f && !readyFamilies.find(r => r.id === f.id)) {
                readyFamilies.push(f);
            }
        } catch {
            console.warn('[getReadyFamilies] Failed to get family for retry:', id);
        }
    }

    return readyFamilies;
}

/** Maternal mortality rate (1% chance during delivery) */
const MATERNAL_MORTALITY_RATE = 0.01;

/** Process a single delivery with retry logic */
async function processOneDelivery(
    pool: Pool | null,
    calendarService: CalendarService | null,
    populationServiceInstance: PopulationServiceInstance | null,
    family: FamilyRecord,
    PopulationState: any,
    retryConfig: RetryConfig
): Promise<boolean> {
    const lockConfig = familyLockConfig(family.id, {
        contentionStatsKey: 'stats:deliveries:contention'
    });

    const result = await withLock(lockConfig, async () => {
        // Re-verify family still exists
        const currentFamily = await PopulationState.getFamily(family.id) as FamilyRecord | null;
        if (!currentFamily || !currentFamily.pregnancy || !currentFamily.delivery_date) {
            return { delivered: false, maternalMortality: false };
        }

        // Clear pregnancy status before delivery
        await PopulationState.updateFamily(family.id, { pregnancy: false, delivery_date: null });

        // Call internal version without nested lock
        const res = await deliverBabyInternal(calendarService, populationServiceInstance, family.id, PopulationState);

        if (!res) {
            return { delivered: false, maternalMortality: false };
        }

        // Check for maternal mortality (1% chance)
        if (Math.random() < MATERNAL_MORTALITY_RATE) {
            // Maternal mortality - both mother and baby die
            const babyId = res.baby.id;
            const motherId = currentFamily.wife_id;

            // Remove baby from population
            await PopulationState.removePerson(babyId, true);

            // Remove mother from population
            if (motherId !== null) {
                await PopulationState.removePerson(motherId, true);
            }

            // Clean up family - clear family_id for all members and delete family
            const personIdsToClear: number[] = [];
            if (currentFamily.husband_id !== null) personIdsToClear.push(currentFamily.husband_id);
            if (currentFamily.wife_id !== null) personIdsToClear.push(currentFamily.wife_id);
            for (const childId of (currentFamily.children_ids || [])) {
                personIdsToClear.push(childId);
            }

            if (personIdsToClear.length > 0) {
                await PopulationState.batchClearFamilyIds(personIdsToClear);
            }

            // Delete the family
            await PopulationState.batchDeleteFamilies([family.id], true);

            // Re-add surviving husband to eligible pool if he meets age criteria
            if (currentFamily.husband_id !== null) {
                try {
                    const husband = await PopulationState.getPerson(currentFamily.husband_id);
                    if (husband && husband.date_of_birth) {
                        const currentDate = getCurrentDate(calendarService);
                        const { calculateAge } = deps.getCalculator();
                        const age = calculateAge(husband.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
                        // Males eligible 16-45
                        if (age >= 16 && age <= 45) {
                            await PopulationState.addEligiblePerson(currentFamily.husband_id, true, currentFamily.tile_id);
                        }
                    }
                } catch (e) {
                    console.warn('[processOneDelivery] Failed to re-add widower to eligible pool:', (e as Error)?.message);
                }
            }

            // Track maternal mortality deaths (mother + baby = 2 deaths, but 1 birth was already tracked)
            // We need to track 2 deaths and decrement births by 1
            if (populationServiceInstance?.trackDeaths) {
                populationServiceInstance.trackDeaths(2);
            }
            // Note: The birth was already tracked in deliverBabyInternal, so net is -1 population

            // Track maternal mortality stat
            await safeExecute(
                () => storage.incr('stats:maternal_mortality:count'),
                'FamilyManager:MaternalMortalityCount',
                null,
                ErrorSeverity.LOW
            );

            // Clear retry tracking
            await clearRetryTracking(family.id, retryConfig);

            return { delivered: true, maternalMortality: true };
        }

        // Normal delivery - re-add to fertile set if still eligible
        try {
            await PopulationState.addFertileFamily(res.family.id, res.family.tile_id);
        } catch (e) {
            console.warn('[processOneDelivery] Failed to re-add to fertile set:', (e as Error)?.message);
        }

        // Clear retry tracking on success
        await clearRetryTracking(family.id, retryConfig);

        return { delivered: true, maternalMortality: false };
    });

    if (!result.acquired) {
        // Lock contention - schedule retry
        const retryResult = await scheduleRetry(family.id, retryConfig);
        if (retryResult.maxAttemptsReached) {
            // Clear retry tracking to prevent repeated attempts
            await clearRetryTracking(family.id, retryConfig);
            // Force clear pregnancy to prevent this family from being retried forever
            try {
                await PopulationState.updateFamily(family.id, { pregnancy: false, delivery_date: null });
            } catch {
                // Silently ignore - family may have been deleted
            }
        }
        return false;
    }

    if (result.error) {
        // Suppress "Family not found" errors
        if (!result.error.message?.includes('Family not found')) {
            console.error(`Error delivering baby for family ${family.id}:`, result.error);
        }
        return false;
    }

    return result.result?.delivered ?? false;
}

/**
 * Gets family statistics - from Redis using HSCAN streaming
 */
export async function getFamilyStats(pool: Pool | null): Promise<FamilyStats> {
    try {
        let totalFamilies = 0;
        let pregnantFamilies = 0;
        let totalChildren = 0;

        const familyStream = storage.hscanStream('family', { count: 500 });
        for await (const result of familyStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const f = JSON.parse(json) as FamilyRecord;
                    totalFamilies++;
                    if (f.pregnancy) pregnantFamilies++;
                    totalChildren += f.children_ids?.length || 0;
                } catch { /* ignore */ }
            }
        }

        const avgChildrenPerFamily = totalFamilies > 0 ? totalChildren / totalFamilies : 0;

        return { totalFamilies, pregnantFamilies, avgChildrenPerFamily };
    } catch (error) {
        console.error('Error getting family stats:', error);
        return { totalFamilies: 0, pregnantFamilies: 0, avgChildrenPerFamily: 0 };
    }
}
