// Population Statistics and Reporting - Handles all population statistics and reporting functionality

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
        } catch (e) {
            // Try alternative method
            try {
                currentCalendarDate = calendarService.getCurrentDate();
            } catch (e2) {
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
        console.warn('[getCalendarCutoffs] Using system date as fallback.');
    }

    const minorsYear = year - 16;
    const elderlyYear = year - 60;
    const bachelorMaleYear = year - 45;
    const bachelorFemaleYear = year - 30;

    return {
        minorsCutoff: `${minorsYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        elderlyCutoff: `${elderlyYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        bachelorMaleCutoff: `${bachelorMaleYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        bachelorFemaleCutoff: `${bachelorFemaleYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    };
}

// ==================== CORE STATISTICS FUNCTIONS ====================

/**
 * Gets comprehensive population statistics with demographics and rates
 */
async function getPopulationStats(pool, calendarService, populationServiceInstance) {
    try {
        const { minorsCutoff, elderlyCutoff, bachelorMaleCutoff, bachelorFemaleCutoff } = getCalendarCutoffs(calendarService);

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_population,
                COUNT(*) FILTER (WHERE sex = true) AS male,
                COUNT(*) FILTER (WHERE sex = false) AS female,
                COUNT(*) FILTER (WHERE date_of_birth > $1) AS minors,
                COUNT(*) FILTER (WHERE date_of_birth <= $1 AND date_of_birth > $2) AS working_age,
                COUNT(*) FILTER (WHERE date_of_birth <= $2) AS elderly,
                COUNT(*) FILTER (
                    WHERE family_id IS NULL AND (
                        (sex = true AND date_of_birth <= $1 AND date_of_birth > $3) OR
                        (sex = false AND date_of_birth <= $1 AND date_of_birth > $4)
                    )
                ) AS bachelors
            FROM people;`, [minorsCutoff, elderlyCutoff, bachelorMaleCutoff, bachelorFemaleCutoff]);

        const stats = result.rows[0] || {};
        const rates = calculateRates(populationServiceInstance);
        // In-game rates
        let inGameRatesYear = { birthRateYear: 0, deathRateYear: 0, birthCountYear: 0, deathCountYear: 0 };
        let inGameRates12m = { birthRate12m: 0, deathRate12m: 0, birthCount12m: 0, deathCount12m: 0 };
        if (populationServiceInstance && populationServiceInstance.calendarService) {
            inGameRatesYear = calculateRatesInGame(populationServiceInstance, populationServiceInstance.calendarService, 'year');
            inGameRates12m = calculateRatesInGame(populationServiceInstance, populationServiceInstance.calendarService, '12months');
        }
        return {
            totalPopulation: parseInt(stats.total_population, 10) || 0,
            male: parseInt(stats.male, 10) || 0,
            female: parseInt(stats.female, 10) || 0,
            minors: parseInt(stats.minors, 10) || 0,
            working_age: parseInt(stats.working_age, 10) || 0,
            elderly: parseInt(stats.elderly, 10) || 0,
            bachelors: parseInt(stats.bachelors, 10) || 0,
            ...rates,
            ...inGameRatesYear,
            ...inGameRates12m
        };
    } catch (error) {
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
 */
async function getAllPopulationData(pool, calendarService, populationServiceInstance) {
    const { loadPopulationData, formatPopulationData } = require('./dataOperations.js');

    const populations = await loadPopulationData(pool);
    const stats = await getPopulationStats(pool, calendarService, populationServiceInstance);
    const familyStats = await getFamilyStatistics(pool);

    // Use stats.totalPopulation (from SQL) as the only source of truth
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
    } catch (error) {
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
    try {
        // Use the correct 'families' table, not legacy 'family'
        // Count children by joining people table
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_families,
                0 as pregnant_families, -- Not tracked in 'families' table
                COALESCE(AVG(child_count),0) as avg_children_per_family,
                COUNT(*) FILTER (WHERE child_count > 0) as families_with_children
            FROM (
                SELECT f.id, COUNT(p.id) as child_count
                FROM families f
                LEFT JOIN people p ON p.family_id = f.id AND EXTRACT(YEAR FROM AGE(p.date_of_birth)) < 16
                GROUP BY f.id
            ) sub;
        `);

        const stats = result.rows[0] || {};
        return {
            totalFamilies: parseInt(stats.total_families, 10) || 0,
            pregnantFamilies: parseInt(stats.pregnant_families, 10) || 0,
            avgChildrenPerFamily: parseFloat(stats.avg_children_per_family) || 0,
            familiesWithChildren: parseInt(stats.families_with_children, 10) || 0
        };
    } catch (error) {
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
    } catch (err) {
        console.error('Error printing people sample:', err);
    }
}

/**
 * Gets total population from populations object
 */
function getTotalPopulation(populations) {
    if (!populations || typeof populations !== 'object') return 0;
    return Object.values(populations).reduce((sum, pop) => sum + (typeof pop === 'number' ? pop : 0), 0);
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
    if (!context) return { birthRate: 0, deathRate: 0, birthCount: 0, deathCount: 0, timeElapsed: 0 };
    const now = Date.now();
    const timeElapsed = now - context.lastRateReset;
    const minutesElapsed = timeElapsed / 60000;
    if (minutesElapsed < 0.1) {
        return {
            birthRate: 0,
            deathRate: 0,
            birthCount: context.birthCount,
            deathCount: context.deathCount,
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

module.exports = {
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
    fetchPopulationStats: getPopulationStats
};
