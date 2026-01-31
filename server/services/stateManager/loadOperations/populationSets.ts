// Load Operations - Population Sets Module
// Optimized with batched updates using Redis pipeline
import storage from '../../storage';
import { CalendarService, CalendarDate, FamilyRow, PersonRow, PeopleMap } from './types';

/** Batch size for population set updates */
const BATCH_SIZE = 500;

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

        const currentDate = getCurrentDate(calendarService);
        const PopulationState = require('../../populationState').default;

        // Filter eligible families first
        const eligibleFamilies = families.filter(f => {
            const childrenCount = (f.children_ids || []).length;
            if (f.pregnancy || childrenCount >= 5) return false;
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
                        currentDate.year,
                        currentDate.month,
                        currentDate.day
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
 */
export async function populateEligibleSets(
    people: PersonRow[],
    calendarService?: CalendarService
): Promise<void> {
    try {
        const PopulationState = require('../../populationState').default;
        const currentDate = getCurrentDate(calendarService);

        // Process in batches with Promise.all for parallelism
        let processed = 0;
        for (let i = 0; i < people.length; i += BATCH_SIZE) {
            const batch = people.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async p => {
                try {
                    await PopulationState.addEligiblePerson(
                        p,
                        currentDate.year,
                        currentDate.month,
                        currentDate.day
                    );
                    processed++;
                } catch (e: unknown) {
                    // Ignore individual failures
                }
            }));
        }

        if (processed > 0) {
            console.log(`💑 Populated ${processed} eligible people for matchmaking`);
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to populate eligible sets on load:', errMsg);
    }
}
