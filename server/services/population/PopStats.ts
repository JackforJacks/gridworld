// Population Statistics and Reporting - Handles all population statistics and reporting functionality
// Storage removed - all data in Rust ECS
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
 * Uses Rust ECS as primary source
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
        // Use Rust ECS demographics
        const [year, month, day] = currentDateStr.split('-').map(Number);
        const rustStats = await PopulationState.getDemographicStats({ year, month, day });
        if (rustStats) {
            stats = rustStats;
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
            ...rates,
            ...inGameRatesYear,
            ...inGameRates12m
        };
    } catch (error: unknown) {
        console.error('Error getting population stats:', error);
        const rates = calculateRates(populationServiceInstance);
        return {
            totalPopulation: 0, male: 0, female: 0, minors: 0, working_age: 0, elderly: 0, bachelors: 0,
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
 * Uses Rust ECS as the primary source
 */
async function getAllPopulationData(pool, calendarService, populationServiceInstance) {
    const { formatPopulationData } = require('./dataOperations');

    // Get tile populations from Rust ECS
    let populations = {};
    try {
        populations = await PopulationState.getAllTilePopulations();
    } catch (e: unknown) {
        console.warn('[getAllPopulationData] getAllTilePopulations failed:', (e as Error).message);
    }

    const stats = await getPopulationStats(pool, calendarService, populationServiceInstance);
    // Family stats removed - use rustSimulation.getDemographics() for family data

    // Use stats.totalPopulation (from Rust) as the source of truth
    const formatted = formatPopulationData(populations);
    formatted.totalPopulation = stats.totalPopulation;

    return {
        ...formatted,
        ...stats
    };
}

/**
 * Gets population distribution by tiles - Redis-first implementation using HSCAN for memory efficiency
 */
async function getPopulationDistribution(_pool: unknown) {
    void _pool; // Unused - kept for API compatibility
    try {
        // Storage removed - all data in Rust ECS
        console.warn('[getPopulationDistribution] Storage removed - all data managed by Rust ECS');
        return { totalTiles: 0, distribution: [] };
    } catch (error: unknown) {
        console.error('Error getting population distribution:', error);
        return { totalTiles: 0, distribution: [] };
    }
}

// getFamilyStatistics removed - families now managed by Rust ECS (Partner component)
// Use rustSimulation.getDemographics() for aggregate family statistics (partnered, pregnant counts)

// ==================== UTILITY AND DEBUG FUNCTIONS ====================

/**
 * Prints a sample of people data for debugging
 * Storage removed - all data in Rust ECS
 */
async function printPeopleSample(_pool: unknown, limit = 10) {
    void _pool; // Unused - kept for API compatibility
    try {
        // Storage removed - all data managed by Rust ECS
        console.warn('[printPeopleSample] Storage removed - all data managed by Rust ECS');
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
    // getFamilyStatistics removed - use rustSimulation.getDemographics() for family data

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
