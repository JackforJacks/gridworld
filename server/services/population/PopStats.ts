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
    // AND people have residency assigned (> 0). If all people have residency=0, skip rebuild
    // since village sets can't be created until ensureVillagesForPopulatedTiles runs.
    if (Object.keys(populations).length === 0) {
        try {
            // Use HLEN to check count without loading all data
            const personCount = await storage.hlen('person');
            
            if (personCount > 0) {
                // Sample a few records using HSCAN to check for valid residency
                // This avoids loading all people into memory
                let hasValidResidency = false;
                const sampleStream = storage.hscanStream('person', { count: 100 });
                
                sampleLoop:
                for await (const result of sampleStream) {
                    const entries = result as string[];
                    for (let i = 0; i < entries.length; i += 2) {
                        const json = entries[i + 1];
                        if (!json) continue;
                        try {
                            const person = JSON.parse(json);
                            if (person.residency !== null && person.residency !== undefined && person.residency !== 0) {
                                hasValidResidency = true;
                                break sampleLoop;
                            }
                        } catch { /* ignore parse errors */ }
                    }
                    // Only check first batch to avoid memory issues
                    break;
                }
                
                if (hasValidResidency) {
                    console.warn('[getAllPopulationData] Detected persons with residency but no per-tile data; attempting rebuild of village membership sets...');
                    try {
                        const rebuildRes = await PopulationState.rebuildVillageMemberships();
                        if (rebuildRes && 'success' in rebuildRes && rebuildRes.success) {
                            const repaired = await PopulationState.getAllTilePopulations();
                            if (repaired && Object.keys(repaired).length > 0) {
                                populations = repaired;
                            }
                        }
                    } catch (e: unknown) {
                        console.warn('[getAllPopulationData] rebuildVillageMemberships failed:', e instanceof Error ? e.message : String(e));
                    }
                }
                // If no valid residency, silently skip - residency assignment hasn't happened yet
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
 * Gets population distribution by tiles - Redis-first implementation using HSCAN for memory efficiency
 */
async function getPopulationDistribution(_pool: unknown) {
    void _pool; // Unused - kept for API compatibility
    try {
        if (!storage.isAvailable()) {
            console.warn('[getPopulationDistribution] Storage not available');
            return { totalTiles: 0, distribution: [] };
        }

        // Aggregate by tile using HSCAN streaming to avoid loading all people into memory
        const tileStats: Record<number, { population: number; male: number; female: number }> = {};
        
        const personStream = storage.hscanStream('person', { count: 500 });
        
        for await (const result of personStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                
                try {
                    const person = JSON.parse(json);
                    const tileId = person.tile_id;
                    if (tileId === null || tileId === undefined) continue;
                    
                    if (!tileStats[tileId]) {
                        tileStats[tileId] = { population: 0, male: 0, female: 0 };
                    }
                    tileStats[tileId].population++;
                    if (person.sex === true) {
                        tileStats[tileId].male++;
                    } else {
                        tileStats[tileId].female++;
                    }
                } catch { /* ignore parse errors */ }
            }
        }

        // Convert to array sorted by population descending
        const distribution = Object.entries(tileStats)
            .map(([tileId, stats]) => ({
                tileId: parseInt(tileId, 10),
                population: stats.population,
                male: stats.male,
                female: stats.female
            }))
            .sort((a, b) => b.population - a.population);

        return {
            totalTiles: distribution.length,
            distribution
        };
    } catch (error: unknown) {
        console.error('Error getting population distribution:', error);
        return { totalTiles: 0, distribution: [] };
    }
}

/**
 * Gets family statistics using HSCAN streaming (memory-efficient)
 * @param {Pool} pool - Database pool instance
 * @returns {Object} Family statistics
 */
async function getFamilyStatistics(pool) {
    // Redis-first implementation with HSCAN streaming
    try {
        let totalFamilies = 0;
        let pregnantFamilies = 0;
        let familiesWithChildren = 0;
        let totalChildren = 0;

        const familyStream = storage.hscanStream('family', { count: 500 });
        for await (const result of familyStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const fam = JSON.parse(json);
                    totalFamilies++;
                    if (fam.pregnancy) pregnantFamilies++;
                    const numChildren = Array.isArray(fam.children_ids) ? fam.children_ids.length : 0;
                    if (numChildren > 0) familiesWithChildren++;
                    totalChildren += numChildren;
                } catch { /* skip invalid */ }
            }
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
 * Prints a sample of people data for debugging - uses HSCAN streaming
 */
async function printPeopleSample(_pool: unknown, limit = 10) {
    void _pool; // Unused - kept for API compatibility
    try {
        if (!storage.isAvailable()) {
            console.warn('[printPeopleSample] Storage not available');
            return;
        }
        
        const sample: Array<{ id: unknown; sex: unknown; date_of_birth: unknown }> = [];
        const peopleStream = storage.hscanStream('person', { count: 100 });
        
        outerLoop:
        for await (const result of peopleStream) {
            const entries = result as string[];
            for (let i = 0; i < entries.length; i += 2) {
                const json = entries[i + 1];
                if (!json) continue;
                try {
                    const person = JSON.parse(json);
                    sample.push({
                        id: person.id,
                        sex: person.sex,
                        date_of_birth: person.date_of_birth
                    });
                    if (sample.length >= limit) break outerLoop;
                } catch { /* skip */ }
            }
        }
        
        console.log('Sample people from Redis:');
        sample.forEach(person => console.log(person));
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
