// Family Manager - Matchmaking Module
import storage from '../../storage';
import serverConfig from '../../../config/server';
import * as deps from '../dependencyContainer';
import { Pool } from 'pg';
import { CalendarService } from './types';
import { getCurrentDate } from './helpers';
import { createFamily, CreateFamilyResult } from './familyCreation';
import { startPregnancy } from './pregnancy';

/** Chance to start immediate pregnancy after marriage */
const IMMEDIATE_PREGNANCY_CHANCE = 0.40;

/**
 * Forms new families from eligible bachelors - uses Redis for people data
 */
export async function formNewFamilies(
    pool: Pool | null,
    calendarService: CalendarService | null
): Promise<number> {
    try {
        const PopulationState = deps.getPopulationState();

        if (PopulationState.isRestarting) {
            return 0;
        }

        const currentDate = getCurrentDate(calendarService);
        const { year, month, day } = currentDate;

        // Get tiles with eligible people
        const maleTiles = await storage.smembers('tiles_with_eligible_males') || [];
        const femaleTiles = await storage.smembers('tiles_with_eligible_females') || [];
        const tileSet = new Set([...maleTiles, ...femaleTiles]);

        let newFamiliesCount = 0;

        for (const tileId of tileSet) {
            const tileFamilies = await processTileMatchmaking(
                pool,
                calendarService,
                PopulationState,
                tileId,
                year,
                month,
                day
            );
            newFamiliesCount += tileFamilies;
        }

        if (newFamiliesCount > 0 && serverConfig.verboseLogs) {
            console.log(`💒 Formed ${newFamiliesCount} new families (same-tile marriages only)`);
        }

        return newFamiliesCount;
    } catch (error) {
        console.error('Error forming new families:', error);
        return 0;
    }
}

/** Process matchmaking for a single tile */
async function processTileMatchmaking(
    pool: Pool | null,
    calendarService: CalendarService | null,
    PopulationState: any,
    tileId: string,
    year: number,
    month: number,
    day: number
): Promise<number> {
    try {
        const maleSetKey = `eligible:males:tile:${tileId}`;
        const femaleSetKey = `eligible:females:tile:${tileId}`;

        const maleCount = parseInt(await storage.scard(maleSetKey), 10) || 0;
        const femaleCount = parseInt(await storage.scard(femaleSetKey), 10) || 0;

        if (maleCount === 0 || femaleCount === 0) {
            return 0;
        }

        const pairs = Math.min(maleCount, femaleCount);
        if (serverConfig.verboseLogs) {
            console.log(`   Tile ${tileId}: Attempting up to ${pairs} pairings (${maleCount} males, ${femaleCount} females)`);
        }

        let newFamiliesCount = 0;
        let contentionCount = 0;
        const MAX_CONTENTION = 3; // Stop after 3 lock contentions to avoid hammering

        for (let i = 0; i < pairs; i++) {
            const result = await attemptOnePairing(
                pool,
                calendarService,
                PopulationState,
                tileId,
                maleSetKey,
                femaleSetKey,
                year,
                month,
                day
            );
            if (result === 'success') {
                newFamiliesCount++;
                contentionCount = 0; // Reset on success
            } else if (result === 'no_candidates') {
                break;
            } else if (result === 'contention') {
                contentionCount++;
                if (contentionCount >= MAX_CONTENTION) {
                    // Too much contention on this tile, try again next tick
                    break;
                }
            }
        }

        return newFamiliesCount;
    } catch (err) {
        console.warn('[processTileMatchmaking] Error:', tileId, (err as Error)?.message);
        return 0;
    }
}

/** Attempt a single pairing on a tile */
async function attemptOnePairing(
    pool: Pool | null,
    calendarService: CalendarService | null,
    PopulationState: any,
    tileId: string,
    maleSetKey: string,
    femaleSetKey: string,
    year: number,
    month: number,
    day: number
): Promise<'success' | 'failed' | 'no_candidates' | 'contention'> {
    try {
        await storage.incr('stats:matchmaking:attempts');
    } catch { /* ignore */ }

    // Pop candidates
    const maleMembers = await storage.smembers(maleSetKey);
    const maleId = maleMembers?.length > 0
        ? maleMembers[Math.floor(Math.random() * maleMembers.length)]
        : null;

    if (!maleId) {
        return 'no_candidates';
    }

    await storage.srem(maleSetKey, maleId);

    const femaleMembers = await storage.smembers(femaleSetKey);
    const femaleId = femaleMembers?.length > 0
        ? femaleMembers[Math.floor(Math.random() * femaleMembers.length)]
        : null;

    if (!femaleId) {
        await storage.sadd(maleSetKey, maleId);
        return 'no_candidates';
    }

    await storage.srem(femaleSetKey, femaleId);

    try {
        const result = await createFamily(pool, parseInt(maleId), parseInt(femaleId), parseInt(tileId));

        if (!result.family) {
            // Handle based on failure reason
            switch (result.failureReason) {
                case 'lock_contention':
                    // Don't return to sets - break the contention cycle
                    // They'll be re-added on next tick if still eligible
                    return 'contention';
                
                case 'already_in_family':
                    // Someone got married in a race - don't return
                    return 'failed';
                
                case 'person_not_found':
                    // Person died or was removed - don't return
                    return 'failed';
                
                case 'invalid_sex':
                    // Data corruption - don't return
                    console.warn(`[attemptOnePairing] Invalid sex for ${maleId} or ${femaleId}`);
                    return 'failed';
                
                case 'restarting':
                    // World restart - don't return, will be rebuilt
                    return 'failed';
                
                default:
                    // Unknown error - return to sets
                    await returnToEligibleSets(maleSetKey, maleId, femaleSetKey, femaleId);
                    return 'failed';
            }
        }

        // Add to fertile set
        try {
            await PopulationState.addFertileFamily(result.family.id, parseInt(tileId));
        } catch (e) {
            console.warn('[attemptOnePairing] Failed to add to fertile set:', (e as Error)?.message);
        }

        // Chance to start immediate pregnancy
        if (Math.random() < IMMEDIATE_PREGNANCY_CHANCE) {
            try {
                await startPregnancy(pool, calendarService, result.family.id);
            } catch { /* ignore */ }
        }

        return 'success';
    } catch (err) {
        try {
            await storage.incr('stats:matchmaking:failures');
        } catch { /* ignore */ }
        console.error(`Error creating family between ${maleId} and ${femaleId}:`, err);
        await returnToEligibleSets(maleSetKey, maleId, femaleSetKey, femaleId);
        return 'failed';
    }
}

/** Return candidates to eligible sets on failure */
async function returnToEligibleSets(
    maleSetKey: string,
    maleId: string,
    femaleSetKey: string,
    femaleId: string
): Promise<void> {
    try {
        await storage.sadd(maleSetKey, maleId);
    } catch (e) {
        console.warn('[returnToEligibleSets] Failed to return male:', (e as Error)?.message);
    }
    try {
        await storage.sadd(femaleSetKey, femaleId);
    } catch (e) {
        console.warn('[returnToEligibleSets] Failed to return female:', (e as Error)?.message);
    }
}
