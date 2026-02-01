// Population Statistics and Reporting - Handles all population statistics and reporting functionality
import storage from '../storage';
import PopulationState from '../populationState';

// ==================== UTILITY FUNCTIONS ====================

/**
 * Gets calendar cutoff dates for age-based demographics
 */
function getCalendarCutoffs(calendarService) {
    let currentCalendarDate = null;
    let year, month, day;

    if (calendarService) {
        try {
            const state = calendarService.getState();
            currentCalendarDate = state?.currentDate;
        } catch (e: unknown) {
            // Try alternative method
            try {
                currentCalendarDate = calendarService.getCurrentDate();
            } catch (e2: unknown) {
                console.warn('[getCalendarCutoffs] CalendarService methods failed, using fallback date.');
            }
        }
    }

    if (currentCalendarDate) {
        ({ year, month, day } = currentCalendarDate);
    } else {
        const fallbackDate = new Date();
        year = fallbackDate.getFullYear();
        month = fallbackDate.getMonth() + 1;
        day = fallbackDate.getDate();
    }

    const minorsYear = year - 16;
    const elderlyYear = year - 60;
    const bachelorMaleYear = year - 45;
    const bachelorFemaleYear = year - 30;

    return {
        currentDateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        minorsCutoff: `${minorsYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        elderlyCutoff: `${elderlyYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        bachelorMaleCutoff: `${bachelorMaleYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        bachelorFemaleCutoff: `${bachelorFemaleYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    };
}

// ==================== CORE STATISTICS FUNCTIONS ====================

/**
 * Gets comprehensive population statistics with demographics and rates
 * Now reads from storage as the primary source, falls back to Postgres if storage is unavailable
 */
async function getPopulationStats(pool, calendarService, populationServiceInstance) {
    try {
        const cutoffs = getCalendarCutoffs(calendarService);
        const { currentDateStr } = cutoffs;

        let stats = {
            totalPopulation: 0,
            male: 0,
            female: 0,
            minors: 0,
            working_age: 0,
            elderly: 0,
            bachelors: 0
        };
        let villagesCount = 0;

        // Only use storage (Redis) for all stats
        if (storage.isAvailable()) {
            // Parse currentDateStr to object for getDemographicStats
            const [year, month, day] = currentDateStr.split('-').map(Number);
            const storageStats = await PopulationState.getDemographicStats({ year, month, day });
            if (storageStats) {
                stats = storageStats;
            }
            // Get villages count from storage ('village' hash)
            try {
                const villageData = await storage.hgetall('village');
                villagesCount = villageData ? Object.keys(villageData).length : 0;
            } catch (e: unknown) {
                villagesCount = 0;
            }
        }

        const rates = calculateRates(populationServiceInstance);
        // In-game rates
        let inGameRatesYear = { birthRateYear: 0, deathRateYear: 0, birthCountYear: 0, deathCountYear: 0 };
        let inGameRates12m = { birthRate12m: 0, deathRate12m: 0, birthCount12m: 0, deathCount12m: 0 };
        if (populationServiceInstance && populationServiceInstance.calendarService) {
            const yearRates = calculateRatesInGame(populationServiceInstance, populationServiceInstance.calendarService, 'year');
            inGameRatesYear = {
                birthRateYear: yearRates.birthRate,
                deathRateYear: yearRates.deathRate,
                birthCountYear: yearRates.birthCount,
                deathCountYear: yearRates.deathCount
            };
            const rates12m = calculateRatesInGame(populationServiceInstance, populationServiceInstance.calendarService, '12months');
            inGameRates12m = {
                birthRate12m: rates12m.birthRate,
                deathRate12m: rates12m.deathRate,
                birthCount12m: rates12m.birthCount,
                deathCount12m: rates12m.deathCount
            };
        }

        return {
            totalPopulation: stats.totalPopulation,
            male: stats.male,
            female: stats.female,
            minors: stats.minors,
            working_age: stats.working_age,
            elderly: stats.elderly,
            bachelors: stats.bachelors,
            villagesCount: villagesCount,
            ...rates,
            ...inGameRatesYear,
            ...inGameRates12m
        };
    } catch (error: unknown) {
        console.error('Error getting population stats:', error);
        const rates = calculateRates(populationServiceInstance);
        return {
            totalPopulation: 0, male: 0, female: 0, minors: 0, working_age: 0, elderly: 0, bachelors: 0,
            villagesCount: 0,
            ...rates
        };
    }
}

/**
 * Gets demographic breakdown (alias for getPopulationStats for backwards compatibility)
 */
async function getDemographicStats(pool, calendarService) {
    const stats = await getPopulationStats(pool, calendarService, null);
    return {
        totalPopulation: stats.totalPopulation,
        male: stats.male,
        female: stats.female,
        minors: stats.minors,
        working_age: stats.working_age,
        elderly: stats.elderly,
        bachelors: stats.bachelors
    };
}

/**
 * Gets all population data including statistics (consolidated data function)
 * Uses storage as the only source of truth
 */
async function getAllPopulationData(pool, calendarService, populationServiceInstance) {
    const { loadPopulationData, formatPopulationData } = require('./dataOperations');
    // PopulationState is imported at the top of the file

    // Get tile populations from storage (only source of truth)
    let populations = {};
    if (storage.isAvailable()) {
        try {
            // Poll a few times to capture batched/streamed writes that may be in progress
            let best = {};
            const MAX_POLLS = 10;
            const POLL_MS = 100;
            for (let i = 0; i < MAX_POLLS; i++) {
                const current = await PopulationState.getAllTilePopulations();
                const currentCount = current ? Object.keys(current).length : 0;
                const bestCount = best ? Object.keys(best).length : 0;
                if (current && currentCount > bestCount) {
                    best = current;
                }
                // If we've captured at least 5 tiles, likely complete (init selects <=5 tiles)
                if (Object.keys(best).length >= 5) break;
                await new Promise(resolve => setTimeout(resolve, POLL_MS));
            }
            populations = best;
        } catch (e: unknown) {
            console.warn('[getAllPopulationData] storage.getAllTilePopulations failed:', (e as Error).message);
        }
    }

    // If storage didn't have data after polling, attempt a repair if person hash exists
    if (Object.keys(populations).length === 0) {
        try {
            // If person hash has entries, rebuild village membership sets then re-read
            const counts = await storage.hgetall('counts:global');
            const personHash = await storage.hgetall('person');
            const personCount = personHash ? Object.keys(personHash).length : 0;
            if (personCount > 0 || (counts && counts.total && parseInt(counts.total, 10) > 0)) {
                console.warn('[getAllPopulationData] Detected persons but no per-tile data; attempting rebuild of village membership sets...');
                try {
                    const rebuildRes = await PopulationState.rebuildVillageMemberships();
                    if (rebuildRes && rebuildRes.success) {
                        const repaired = await PopulationState.getAllTilePopulations();
                        if (repaired && Object.keys(repaired).length > 0) {
                            populations = repaired;
                        }
                    }
                } catch (e: unknown) {
                    console.warn('[getAllPopulationData] rebuildVillageMemberships failed:', e instanceof Error ? e.message : String(e));
                }
            }
        } catch (e: unknown) {
            // ignore - no fallback
        }
    }

    // If still empty, use loadPopulationData which also reads from Redis only
    if (Object.keys(populations).length === 0) {
        populations = await loadPopulationData(pool);
    }

    const stats = await getPopulationStats(pool, calendarService, populationServiceInstance);
    const familyStats = await getFamilyStatistics(pool);

    // Use stats.totalPopulation (from Redis) as the only source of truth
    const formatted = formatPopulationData(populations);
    formatted.totalPopulation = stats.totalPopulation;

    return {
        ...formatted,
        ...stats,
        ...familyStats
    };
}

/**
 * Gets population distribution by tiles
 */
async function getPopulationDistribution(pool) {
    try {
        const result = await pool.query(`
            SELECT 
                tile_id,
                COUNT(*) as population,
                COUNT(*) FILTER (WHERE sex = true) AS male,
                COUNT(*) FILTER (WHERE sex = false) AS female
            FROM people 
            GROUP BY tile_id
            ORDER BY population DESC;`);

        return {
            totalTiles: result.rows.length,
            distribution: result.rows.map(row => ({
                tileId: row.tile_id,
                population: parseInt(row.population, 10),
                male: parseInt(row.male, 10),
                female: parseInt(row.female, 10)
            }))
        };
    } catch (error: unknown) {
        console.error('Error getting population distribution:', error);
        return { totalTiles: 0, distribution: [] };
    }
}

/**
 * Gets family statistics
 * @param {Pool} pool - Database pool instance
 * @returns {Object} Family statistics
 */
async function getFamilyStatistics(pool) {
    // Redis-first implementation
    try {
        const FamilyState = require('../populationState/FamilyState').default;
        const families = await FamilyState.getAllFamilies();
        let totalFamilies = 0;
        let pregnantFamilies = 0;
        let familiesWithChildren = 0;
        let totalChildren = 0;

        for (const fam of families) {
            totalFamilies++;
            if (fam.pregnancy) pregnantFamilies++;
            const numChildren = Array.isArray(fam.children_ids) ? fam.children_ids.length : 0;
            if (numChildren > 0) familiesWithChildren++;
            totalChildren += numChildren;
        }
        const avgChildrenPerFamily = totalFamilies > 0 ? totalChildren / totalFamilies : 0;
        return {
            totalFamilies,
            pregnantFamilies,
            avgChildrenPerFamily,
            familiesWithChildren
        };
    } catch (error: unknown) {
        console.error('Error getting family statistics:', error);
        return {
            totalFamilies: 0,
            pregnantFamilies: 0,
            avgChildrenPerFamily: 0,
            familiesWithChildren: 0
        };
    }
}

// ==================== UTILITY AND DEBUG FUNCTIONS ====================

/**
 * Prints a sample of people data for debugging
 */
async function printPeopleSample(pool, limit = 10) {
    try {
        const result = await pool.query('SELECT id, sex, date_of_birth FROM people LIMIT $1', [limit]);
        console.log('Sample people table rows:');
        result.rows.forEach(row => console.log(row));
    } catch (err: unknown) {
        console.error('Error printing people sample:', err);
    }
}

/**
 * Gets total population from populations object
 */
function getTotalPopulation(populations: Record<string, number> | null) {
    if (!populations || typeof populations !== 'object') return 0;
    return Object.values(populations).reduce((sum: number, pop) => sum + (typeof pop === 'number' ? pop : 0), 0);
}

// ==================== RATE TRACKING FUNCTIONS ====================

/**
 * Tracks births in population service context
 */
function trackBirths(context, count) {
    context.birthCount += count;
}

/**
 * Tracks deaths in population service context
 */
function trackDeaths(context, count) {
    context.deathCount += count;
}

/**
 * Calculates birth and death rates based on in-game event log
 * @param {Object} context - PopulationService instance
 * @param {Object} calendarService - Calendar service instance
 * @param {string} mode - 'year' or '12months'
 */
function calculateRatesInGame(context, calendarService, mode = 'year') {
    if (!context || !context.eventLog || !calendarService) return { birthRate: 0, deathRate: 0, birthCount: 0, deathCount: 0, timeElapsed: 0 };
    const now = calendarService.getCurrentDate();
    let startYear, startMonth;
    if (mode === 'year') {
        startYear = now.year;
        startMonth = 1;
    } else {
        // last 12 months
        startYear = now.year;
        startMonth = now.month - 11;
        if (startMonth <= 0) {
            startYear -= 1;
            startMonth += 12;
        }
    }
    // Filter events in the period
    const isInPeriod = (date) => {
        if (date.year > startYear) return true;
        if (date.year < startYear) return false;
        return date.month >= startMonth;
    };
    const births = context.eventLog.filter(e => e.type === 'birth' && isInPeriod(e.date));
    const deaths = context.eventLog.filter(e => e.type === 'death' && isInPeriod(e.date));
    // Calculate in-game minutes elapsed
    let monthsElapsed = (now.year - startYear) * 12 + (now.month - startMonth) + 1;
    let daysElapsed = (monthsElapsed - 1) * 8 + now.day; // 8 days per month
    let minutesElapsed = daysElapsed * 24 * 60; // 24 hours per day
    if (minutesElapsed <= 0) minutesElapsed = 1;
    return {
        birthRate: Math.round((births.length / minutesElapsed) * 10000) / 10000 * 60, // per minute
        deathRate: Math.round((deaths.length / minutesElapsed) * 10000) / 10000 * 60,
        birthCount: births.length,
        deathCount: deaths.length,
        timeElapsed: minutesElapsed
    };
}

/**
 * Legacy real-time rate calculation (used for backward compatibility)
 */
function calculateRates(context) {
    if (!context) return { birthRate: 0, deathRate: 0, birthCount: 0, deathCount: 0, totalBirthCount: 0, totalDeathCount: 0, timeElapsed: 0 };
    const now = Date.now();
    const timeElapsed = now - context.lastRateReset;
    const minutesElapsed = timeElapsed / 60000;
    if (minutesElapsed < 0.1) {
        return {
            birthRate: 0,
            deathRate: 0,
            birthCount: context.birthCount,
            deathCount: context.deathCount,
            totalBirthCount: context.totalBirthCount || 0,
            totalDeathCount: context.totalDeathCount || 0,
            timeElapsed: timeElapsed
        };
    }
    const birthRate = minutesElapsed > 0 ? (context.birthCount / minutesElapsed) : 0;
    const deathRate = minutesElapsed > 0 ? (context.deathCount / minutesElapsed) : 0;
    return {
        birthRate: Math.round(birthRate * 100) / 100,
        deathRate: Math.round(deathRate * 100) / 100,
        birthCount: context.birthCount,
        deathCount: context.deathCount,
        totalBirthCount: context.totalBirthCount || 0,
        totalDeathCount: context.totalDeathCount || 0,
        timeElapsed: timeElapsed
    };
}

/**
 * Rate tracking management functions
 */
function resetRateCounters(context) {
    context.birthCount = 0;
    context.deathCount = 0;
    context.lastRateReset = Date.now();
}

function startRateTracking(context) {
    if (context.rateInterval) {
        clearInterval(context.rateInterval);
    }
    const interval = context.rateTrackingInterval || 60000;
    context.rateInterval = setInterval(() => {
        resetRateCounters(context);
    }, interval);
}

function stopRateTracking(context) {
    if (context.rateInterval) {
        clearInterval(context.rateInterval);
        context.rateInterval = null;
    }
}

// ==================== MODULE EXPORTS ====================

export {
    // Main statistics functions
    getPopulationStats,
    getAllPopulationData,
    getDemographicStats,
    getPopulationDistribution,
    getFamilyStatistics,

    // Utility functions
    printPeopleSample,
    getTotalPopulation,

    // Rate tracking functions
    trackBirths,
    trackDeaths,
    calculateRatesInGame,
    resetRateCounters,
    startRateTracking,
    stopRateTracking,

    // Legacy compatibility (deprecated - use getPopulationStats)
    getPopulationStats as fetchPopulationStats
};
