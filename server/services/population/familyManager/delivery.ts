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
    PersonRecord,
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

    // Get father's residency
    let babyResidency = 0;
    if (family.husband_id) {
        const father = await PopulationState.getPerson(family.husband_id) as PersonRecord | null;
        if (father) {
            babyResidency = father.residency || 0;
        }
    }

    const babyId = await PopulationState.getNextId();

    const personObj = {
        id: babyId,
        tile_id: family.tile_id,
        residency: babyResidency,
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
 * Gets all families on a specific tile - from Redis
 */
export async function getFamiliesOnTile(pool: Pool | null, tileId: number): Promise<FamilyRecord[]> {
    try {
        const PopulationState = deps.getPopulationState();
        const allFamilies = await PopulationState.getAllFamilies() as FamilyRecord[];
        return allFamilies.filter(f => f.tile_id === tileId);
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

/** Get families ready for delivery */
async function getReadyFamilies(
    PopulationState: any,
    currentDateValue: number,
    retryCandidateIds: number[]
): Promise<FamilyRecord[]> {
    let readyFamilies: FamilyRecord[] = [];

    // Always scan all families to find those ready for delivery
    // The pregnant families with past delivery dates need to be processed
    const allFamilies = await PopulationState.getAllFamilies() as FamilyRecord[];
    readyFamilies = allFamilies.filter(f => {
        if (!f.pregnancy || !f.delivery_date) return false;
        const deliveryValue = new Date(f.delivery_date.split('T')[0]).getTime();
        return deliveryValue <= currentDateValue;
    });

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
            return false;
        }

        // Clear pregnancy status before delivery
        await PopulationState.updateFamily(family.id, { pregnancy: false, delivery_date: null });

        // Call internal version without nested lock
        const res = await deliverBabyInternal(calendarService, populationServiceInstance, family.id, PopulationState);

        // Re-add to fertile set if still eligible
        if (res?.family) {
            try {
                await PopulationState.addFertileFamily(res.family.id, res.family.tile_id);
            } catch (e) {
                console.warn('[processOneDelivery] Failed to re-add to fertile set:', (e as Error)?.message);
            }
        }

        // Clear retry tracking on success
        await clearRetryTracking(family.id, retryConfig);

        return true;
    });

    if (!result.acquired) {
        // Lock contention - schedule retry
        const retryResult = await scheduleRetry(family.id, retryConfig);
        // Only log final failures, not intermediate retries
        if (retryResult.maxAttemptsReached) {
            console.warn(`[processDeliveries] Family ${family.id} reached max retry attempts - skipping`);
        }
        // Don't log intermediate retries - they're expected with concurrent operations
        return false;
    }

    if (result.error) {
        // Suppress "Family not found" errors
        if (!result.error.message?.includes('Family not found')) {
            console.error(`Error delivering baby for family ${family.id}:`, result.error);
        }
        return false;
    }

    return result.result ?? false;
}

/**
 * Gets family statistics - from Redis
 */
export async function getFamilyStats(pool: Pool | null): Promise<FamilyStats> {
    try {
        const PopulationState = deps.getPopulationState();
        const allFamilies = await PopulationState.getAllFamilies() as FamilyRecord[];

        const totalFamilies = allFamilies.length;
        const pregnantFamilies = allFamilies.filter(f => f.pregnancy).length;
        const totalChildren = allFamilies.reduce((sum, f) => sum + (f.children_ids?.length || 0), 0);
        const avgChildrenPerFamily = totalFamilies > 0 ? totalChildren / totalFamilies : 0;

        return { totalFamilies, pregnantFamilies, avgChildrenPerFamily };
    } catch (error) {
        console.error('Error getting family stats:', error);
        return { totalFamilies: 0, pregnantFamilies: 0, avgChildrenPerFamily: 0 };
    }
}
