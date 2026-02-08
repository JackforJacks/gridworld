// Family Manager - Pregnancy Module
import { ErrorSeverity, safeExecute } from '../../../utils/errorHandler';
import storage from '../../storage';
import * as deps from '../dependencyContainer';
import { withLock, familyLockConfig } from '../lockUtils';
import { CalendarService, FamilyRecord, PersonRecord } from './types';
import { getCurrentDate, parseBirthDate, calculateAgeFromDates, formatDate } from './helpers';

/** Maximum age for pregnancy */
const MAX_PREGNANCY_AGE = 33;

/**
 * Starts pregnancy for a family - storage-only
 */
export async function startPregnancy(
    _pool: unknown,
    calendarService: CalendarService | null,
    familyId: number
): Promise<FamilyRecord | null> {
    const PopulationState = deps.getPopulationState();

    // Record attempt
    await safeExecute(
        () => storage.incr('stats:pregnancy:attempts'),
        'FamilyManager:PregnancyAttempts',
        null,
        ErrorSeverity.LOW
    );

    // Skip if restart is in progress
    if (PopulationState.isRestarting) {
        return null;
    }

    const lockConfig = familyLockConfig(familyId, {
        contentionStatsKey: 'stats:pregnancy:contention'
    });

    const result = await withLock(lockConfig, async () => {
        const currentDate = getCurrentDate(calendarService);

        // Get family from Redis
        const family = await PopulationState.getFamily(familyId) as FamilyRecord | null;
        if (!family) {
            return null;
        }

        // Check if already pregnant
        if (family.pregnancy) {
            // Expected race condition - family was sampled before becoming pregnant
            // Just return null silently, no need to warn
            return null;
        }

        // Get wife from Redis
        const wife = await PopulationState.getPerson(family.wife_id) as PersonRecord | null;
        if (!wife || !wife.date_of_birth) {
            return null;
        }

        // Calculate wife's age
        const birthDateParts = parseBirthDate(wife.date_of_birth);
        const wifeAge = calculateAgeFromDates(birthDateParts, currentDate);

        // Check if wife is too old for pregnancy - remove from fertile set silently
        if (wifeAge > MAX_PREGNANCY_AGE) {
            // Remove aged-out family from fertile set to prevent repeated attempts
            await safeExecute(
                () => PopulationState.removeFertileFamily(familyId),
                'FamilyManager:RemoveAgedOutFamily',
                null,
                ErrorSeverity.LOW
            );
            return null;
        }

        // Calculate delivery date (~9 months later)
        let deliveryMonth = currentDate.month + 9;
        let deliveryYear = currentDate.year;
        if (deliveryMonth > 12) {
            deliveryMonth -= 12;
            deliveryYear++;
        }
        const deliveryDate = formatDate(deliveryYear, deliveryMonth, currentDate.day);

        // Update family in Redis
        await PopulationState.updateFamily(familyId, {
            pregnancy: true,
            delivery_date: deliveryDate
        });

        // Remove from fertile set
        await safeExecute(
            () => PopulationState.removeFertileFamily(familyId),
            'FamilyManager:RemoveFertileFamily',
            null,
            ErrorSeverity.MEDIUM
        );

        return { ...family, pregnancy: true, delivery_date: deliveryDate };
    });

    if (!result.acquired) {
        // Lock contention is expected with concurrent operations - don't log
        return null;
    }

    if (result.error) {
        // Only log unexpected errors, not expected conditions
        console.error(`Error starting pregnancy for family ${familyId}:`, result.error.message);
        throw result.error;
    }

    return result.result ?? null;
}
