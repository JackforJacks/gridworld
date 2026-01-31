// Family Manager - Family Creation Module
import { ErrorSeverity, safeExecute } from '../../../utils/errorHandler';
import storage from '../../storage';
import * as deps from '../dependencyContainer';
import { Pool } from 'pg';
import { withLock, coupleLockConfig } from '../lockUtils';
import { FamilyRecord, PersonRecord } from './types';
import { isMale, isFemale } from './helpers';

/**
 * Creates a new family unit - storage-only, batched to Postgres on Save
 */
export async function createFamily(
    pool: Pool | null,
    husbandId: number,
    wifeId: number,
    tileId: number
): Promise<FamilyRecord | null> {
    const PopulationState = deps.getPopulationState();

    // Skip if restart is in progress
    if (PopulationState.isRestarting) {
        return null;
    }

    const lockConfig = coupleLockConfig(husbandId, wifeId);
    const result = await withLock(lockConfig, async () => {
        // Verify both people exist in Redis
        const husband = await PopulationState.getPerson(husbandId) as PersonRecord | null;
        const wife = await PopulationState.getPerson(wifeId) as PersonRecord | null;

        if (!husband || !wife) {
            return null;
        }

        // Ensure neither already belongs to a family
        if (husband.family_id || wife.family_id) {
            console.warn(`[createFamily] Husband ${husbandId} or wife ${wifeId} already in a family - skipping`);
            return null;
        }

        // Validate sex
        if (!isMale(husband.sex) || !isFemale(wife.sex)) {
            throw new Error('Husband must be male and wife must be female');
        }

        // Get a real Postgres ID for the new family
        const familyId = await PopulationState.getNextFamilyId();

        // Create family record
        const family: FamilyRecord = {
            id: familyId,
            husband_id: husbandId,
            wife_id: wifeId,
            tile_id: tileId,
            pregnancy: false,
            delivery_date: null,
            children_ids: []
        };

        await PopulationState.addFamily(family, true);

        // Update both people to link them to their new family
        await PopulationState.updatePerson(husbandId, { family_id: familyId });
        await PopulationState.updatePerson(wifeId, { family_id: familyId });

        // Remove both partners from eligible sets
        try {
            await PopulationState.removeEligiblePerson(husbandId, tileId, 'male');
        } catch (e) {
            console.warn('[createFamily] removeEligiblePerson failed for husband:', (e as Error)?.message);
        }
        try {
            await PopulationState.removeEligiblePerson(wifeId, tileId, 'female');
        } catch (e) {
            console.warn('[createFamily] removeEligiblePerson failed for wife:', (e as Error)?.message);
        }

        return family;
    });

    if (!result.acquired) {
        await safeExecute(
            () => storage.incr('stats:matchmaking:contention'),
            'FamilyManager:MatchmakingContention',
            null,
            ErrorSeverity.LOW
        );
        console.warn(`[createFamily] Could not acquire couple lock for ${husbandId} & ${wifeId} - skipping`);
        return null;
    }

    if (result.error) {
        console.error('Error creating family:', result.error);
        throw result.error;
    }

    return result.result ?? null;
}
