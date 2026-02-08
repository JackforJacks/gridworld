// Load Operations - Population Sets Module
// Optimized with batched updates using Redis pipeline
import storage from '../../storage';
import { CalendarService, CalendarDate, PersonRow, PeopleMap } from './types';
// FamilyRow removed - families now managed by Rust ECS (Partner component)

/** Batch size for population set updates */
const BATCH_SIZE = 500;

/** Check if sex value represents male (handles various data formats from Postgres/Redis) */
function checkIsMale(sex: boolean | string | number | null | undefined): boolean {
    return sex === true || sex === 'true' || sex === 1 || sex === 't' || sex === 'M';
}

/**
 * Get current date from calendar service
 */
function getCurrentDate(calendarService?: CalendarService): CalendarDate {
    if (calendarService && typeof calendarService.getState === 'function') {
        const cs = calendarService.getState();
        if (cs && cs.currentDate) {
            return cs.currentDate;
        }
    }
    return { year: 1, month: 1, day: 1 };
}

// populateFertileFamilies removed - fertility/pregnancy now managed by Rust ECS (Pregnancy component)
// Use rustSimulation.getDemographics() for aggregate pregnancy statistics

/**
 * Populate eligible matchmaking sets based on loaded people
 * Optimized with batched processing
 *
 * Only adds people who are:
 * - NOT married (checked via family_id field - TODO: migrate to Rust partnership query)
 * - In eligible age range (males 16-45, females 16-33)
 * - Have a valid tile_id
 */
export async function populateEligibleSets(
    people: PersonRow[],
    calendarService?: CalendarService
): Promise<void> {
    try {
        const PopulationState = require('../../populationState').default;
        const { calculateAge } = require('../../../utils/ageCalculation');
        const currentDate = getCurrentDate(calendarService);

        // Filter eligible people first
        const eligiblePeople = people.filter(p => {
            // Must have valid tile_id
            if (p.tile_id === null) return false;

            // Must not be married (checked via family_id field)
            // TODO: This relies on family_id being set; eventually migrate to query Rust partnership status
            if (p.family_id !== null) return false;

            // Must have valid birth date
            if (!p.date_of_birth) return false;

            // Calculate age and check eligibility range
            const age = calculateAge(p.date_of_birth, currentDate.year, currentDate.month, currentDate.day);
            const isMale = checkIsMale(p.sex);
            const maxAge = isMale ? 45 : 33;

            return age >= 16 && age <= maxAge;
        });

        // Process in batches with Promise.all for parallelism
        let processed = 0;
        for (let i = 0; i < eligiblePeople.length; i += BATCH_SIZE) {
            const batch = eligiblePeople.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async p => {
                try {
                    await PopulationState.addEligiblePerson(
                        p.id,
                        checkIsMale(p.sex),
                        p.tile_id
                    );
                    processed++;
                } catch (e: unknown) {
                    // Ignore individual failures
                }
            }));
        }

        if (processed > 0) {
            console.log(`💑 Populated ${processed} eligible people for matchmaking (filtered from ${people.length} total)`);
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to populate eligible sets on load:', errMsg);
    }
}
