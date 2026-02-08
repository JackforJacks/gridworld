// Family Manager - Family Creation Module
import { ErrorSeverity, safeExecute } from '../../../utils/errorHandler';
import storage from '../../storage';
import * as deps from '../dependencyContainer';
import { withLock, coupleLockConfig } from '../lockUtils';
import { FamilyRecord, PersonRecord } from './types';
import { isMale, isFemale } from './helpers';

/** Result of family creation attempt */
export interface CreateFamilyResult {
    family: FamilyRecord | null;
    /** Why the creation failed (if family is null) */
    failureReason?: 'lock_contention' | 'person_not_found' | 'already_in_family' | 'invalid_sex' | 'error' | 'restarting';
}

/**
 * Creates a new family unit - storage-only, batched to Postgres on Save
 */
export async function createFamily(
    _pool: unknown,
    husbandId: number,
    wifeId: number,
    tileId: number
): Promise<CreateFamilyResult> {
    const PopulationState = deps.getPopulationState();

    // Skip if restart is in progress
    if (PopulationState.isRestarting) {
        return { family: null, failureReason: 'restarting' };
    }

    const lockConfig = coupleLockConfig(husbandId, wifeId);
    const result = await withLock(lockConfig, async () => {
        // Verify both people exist in Redis
        const husband = await PopulationState.getPerson(husbandId) as PersonRecord | null;
        const wife = await PopulationState.getPerson(wifeId) as PersonRecord | null;

        if (!husband || !wife) {
            return { family: null, failureReason: 'person_not_found' as const };
        }

        // Ensure neither already belongs to a family
        if (husband.family_id || wife.family_id) {
            return { family: null, failureReason: 'already_in_family' as const };
        }

        // Validate sex
        if (!isMale(husband.sex) || !isFemale(wife.sex)) {
            console.warn(`[createFamily] Sex validation failed - husband.sex=${husband.sex} (type: ${typeof husband.sex}), wife.sex=${wife.sex} (type: ${typeof wife.sex})`);
            return { family: null, failureReason: 'invalid_sex' as const };
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

        return { family, failureReason: undefined };
    });

    if (!result.acquired) {
        // Lock contention - don't log every occurrence, just track stats
        await safeExecute(
            () => storage.incr('stats:matchmaking:contention'),
            'FamilyManager:MatchmakingContention',
            null,
            ErrorSeverity.LOW
        );
        return { family: null, failureReason: 'lock_contention' };
    }

    if (result.error) {
        console.error('Error creating family:', result.error);
        return { family: null, failureReason: 'error' };
    }

    return result.result ?? { family: null, failureReason: 'error' };
}
