// Load Operations - Population Sets Module
// Optimized with batched updates using Redis pipeline
import storage from '../../storage';
import { CalendarService, CalendarDate, FamilyRow, PersonRow, PeopleMap } from './types';

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

/**
 * Populate fertile family candidates from loaded families
 * Optimized with batched processing
 */
export async function populateFertileFamilies(
    families: FamilyRow[],
    people: PersonRow[],
    calendarService?: CalendarService
): Promise<void> {
    try {
        // Build people lookup map
        const peopleMap: PeopleMap = {};
        for (const p of people) {
            peopleMap[p.id] = p;
        }

        const PopulationState = require('../../populationState').default;

        // Filter eligible families first
        const eligibleFamilies = families.filter(f => {
            if (f.pregnancy) return false;
            if (f.wife_id === null) return false;
            const wife = peopleMap[f.wife_id];
            return wife && wife.date_of_birth;
        });

        // Process in batches
        for (let i = 0; i < eligibleFamilies.length; i += BATCH_SIZE) {
            const batch = eligibleFamilies.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async f => {
                try {
                    await PopulationState.addFertileFamily(
                        f.id,
                        f.tile_id
                    );
                } catch (e: unknown) {
                    // Ignore individual failures
                }
            }));
        }

        if (eligibleFamilies.length > 0) {
            console.log(`🌱 Populated ${eligibleFamilies.length} fertile families`);
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to populate fertile family sets on load:', errMsg);
    }
}

/**
 * Populate eligible matchmaking sets based on loaded people
 * Optimized with batched processing
 * 
 * Only adds people who are:
 * - NOT married (not husband/wife in any family)
 * - In eligible age range (males 16-45, females 16-33)
 * - Have a valid tile_id
 */
export async function populateEligibleSets(
    people: PersonRow[],
    calendarService?: CalendarService,
    families?: FamilyRow[]
): Promise<void> {
    try {
        const PopulationState = require('../../populationState').default;
        const { calculateAge } = require('../../../utils/ageCalculation');
        const currentDate = getCurrentDate(calendarService);

        // Build set of married person IDs (husband_id and wife_id from all families)
        const marriedPersonIds = new Set<number>();
        if (families) {
            for (const f of families) {
                if (f.husband_id !== null) marriedPersonIds.add(f.husband_id);
                if (f.wife_id !== null) marriedPersonIds.add(f.wife_id);
            }
        }

        // Filter eligible people first
        const eligiblePeople = people.filter(p => {
            // Must have valid tile_id
            if (p.tile_id === null) return false;
            
            // Must not be married
            if (marriedPersonIds.has(p.id)) return false;
            
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
