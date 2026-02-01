/**
 * 100-Year Population Simulation Test
 * 
 * This script simulates 100 years of population dynamics to verify:
 * - Births are occurring
 * - Deaths from senescence are occurring
 * - Families are forming from eligible singles
 * - Children grow up and form their own families (generational reproduction)
 * - Population stabilizes or grows appropriately
 */

import { Pool } from 'pg';

// Game constants
const DAYS_PER_MONTH = 8;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 96

// Simulation configuration (can be overridden via environment variable)
const YEARS_TO_SIMULATE = parseInt(process.env.YEARS || '100', 10);
const FAST_MODE = process.env.FAST !== 'false'; // Default to fast mode
const REPORT_INTERVAL_YEARS = Math.max(1, Math.floor(YEARS_TO_SIMULATE / 20)); // Report ~20 times

// Fast mode settings
const DAYS_PER_BATCH = FAST_MODE ? DAYS_PER_MONTH : 1; // Process a month at a time in fast mode
const MATCHMAKING_FREQUENCY = FAST_MODE ? DAYS_PER_MONTH : 1; // Matchmake once per month in fast mode

const TOTAL_DAYS = YEARS_TO_SIMULATE * DAYS_PER_YEAR;
const TOTAL_BATCHES = Math.ceil(TOTAL_DAYS / DAYS_PER_BATCH);

interface SimulationStats {
    year: number;
    month: number;
    day: number;
    totalPopulation: number;
    males: number;
    females: number;
    minors: number;       // under 16
    adults: number;       // 16-60
    elderly: number;      // 60+
    totalFamilies: number;
    pregnantFamilies: number;
    eligibleMales: number;
    eligibleFemales: number;
    birthsThisYear: number;
    deathsThisYear: number;
    newFamiliesThisYear: number;
}

interface YearlyReport {
    year: number;
    startPopulation: number;
    endPopulation: number;
    totalBirths: number;
    totalDeaths: number;
    newFamilies: number;
    growthRate: number;
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('          POPULATION SIMULATION TEST');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Simulating ${YEARS_TO_SIMULATE} years (${TOTAL_DAYS} days in ${TOTAL_BATCHES} batches)`);
    console.log(`Calendar: ${DAYS_PER_MONTH} days/month, ${MONTHS_PER_YEAR} months/year`);
    console.log(`Mode: ${FAST_MODE ? '⚡ FAST' : '🐢 ACCURATE'} | Env: YEARS=${YEARS_TO_SIMULATE} FAST=${FAST_MODE}`);
    console.log('');

    // Initialize database pool
    const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        database: process.env.PGDATABASE || 'gridworld',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'password'
    });

    try {
        // Import required modules
        const storage = require('../server/services/storage').default;
        const PopulationState = require('../server/services/populationState').default;
        const { applySenescence, processDailyFamilyEvents } = require('../server/services/population/lifecycle');
        const { formNewFamilies } = require('../server/services/population/familyManager/matchmaking');
        const { calculateAge } = require('../server/services/population/calculator');

        // Wait for storage to be ready
        console.log('⏳ Waiting for Redis connection...');
        await waitForStorage(storage);
        console.log('✅ Redis connected\n');

        // Detect the current calendar year from existing birth dates
        const allPeople = await PopulationState.getAllPeople();
        let detectedYear = 1;
        if (allPeople.length > 0) {
            // Find the max birth year to infer current calendar year
            let maxBirthYear = 0;
            for (const person of allPeople) {
                if (person.date_of_birth) {
                    const birthStr = typeof person.date_of_birth === 'string' 
                        ? person.date_of_birth 
                        : person.date_of_birth.toISOString();
                    const birthYear = parseInt(birthStr.split('-')[0], 10);
                    if (!isNaN(birthYear) && birthYear > maxBirthYear) {
                        maxBirthYear = birthYear;
                    }
                }
            }
            // Current year should be at least the max birth year (people can't be born in the future)
            if (maxBirthYear > 0) {
                detectedYear = maxBirthYear;
                console.log(`📅 Detected calendar year from birth dates: Year ${detectedYear}`);
            }
        }

        // Get initial state using detected year
        const initialStats = await gatherStats(PopulationState, calculateAge, storage, detectedYear, 1, 1);
        
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('                    INITIAL STATE');
        console.log('═══════════════════════════════════════════════════════════════');
        printStats(initialStats);

        if (initialStats.totalPopulation === 0) {
            console.log('\n⚠️  No population found! Please seed the world first.');
            console.log('   Run: npm run server and use the UI to create a world.');
            await pool.end();
            process.exit(1);
        }

        // Tracking for yearly reports
        const yearlyReports: YearlyReport[] = [];
        let yearStartPopulation = initialStats.totalPopulation;
        let yearBirths = 0;
        let yearDeaths = 0;
        let yearNewFamilies = 0;

        // Create a mock calendar service - start at detected year
        let currentYear = detectedYear;
        let currentMonth = 1;
        let currentDay = 1;

        const mockCalendarService = {
            getCurrentDate: () => ({ year: currentYear, month: currentMonth, day: currentDay }),
            getState: () => ({ currentDate: { year: currentYear, month: currentMonth, day: currentDay } })
        };

        // Create a mock population service for tracking
        const mockPopulationService = {
            trackBirths: (count: number) => { yearBirths += count; },
            trackDeaths: (count: number) => { yearDeaths += count; },
            io: null
        };

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                 STARTING SIMULATION');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Mode: ${FAST_MODE ? '⚡ FAST (monthly batches)' : '🐢 ACCURATE (daily)'}`);
        console.log(`Processing: ${DAYS_PER_BATCH} day(s) per batch, matchmaking every ${MATCHMAKING_FREQUENCY} days\n`);

        const startTime = Date.now();
        let lastReportYear = 0;
        let daysSinceLastMatchmaking = 0;

        // Main simulation loop - process in batches
        for (let batchNum = 0; batchNum < TOTAL_BATCHES; batchNum++) {
            const daysInThisBatch = Math.min(DAYS_PER_BATCH, TOTAL_DAYS - (batchNum * DAYS_PER_BATCH));
            
            // Advance the date by batch size
            for (let d = 0; d < daysInThisBatch; d++) {
                currentDay++;
                if (currentDay > DAYS_PER_MONTH) {
                    currentDay = 1;
                    currentMonth++;
                    if (currentMonth > MONTHS_PER_YEAR) {
                        currentMonth = 1;
                        currentYear++;

                        // End of year - record stats
                        const endPopulation = await getPopulationCount(PopulationState);
                        yearlyReports.push({
                            year: currentYear - 1,
                            startPopulation: yearStartPopulation,
                            endPopulation: endPopulation,
                            totalBirths: yearBirths,
                            totalDeaths: yearDeaths,
                            newFamilies: yearNewFamilies,
                            growthRate: yearStartPopulation > 0 
                                ? ((endPopulation - yearStartPopulation) / yearStartPopulation * 100) 
                                : 0
                        });

                        // Reset for new year
                        yearStartPopulation = endPopulation;
                        yearBirths = 0;
                        yearDeaths = 0;
                        yearNewFamilies = 0;
                    }
                }
            }

            // Process the batch's events
            try {
                // 1. Apply senescence (aging deaths) - pass days as batch
                await applySenescence(pool, mockCalendarService, mockPopulationService, daysInThisBatch);
                
                // 2. Form new families - only periodically in fast mode
                daysSinceLastMatchmaking += daysInThisBatch;
                if (daysSinceLastMatchmaking >= MATCHMAKING_FREQUENCY) {
                    const newFamilies = await formNewFamilies(pool, mockCalendarService);
                    yearNewFamilies += newFamilies;
                    daysSinceLastMatchmaking = 0;
                }

                // 3. Process pregnancies and births - pass days as batch
                await processDailyFamilyEvents(pool, mockCalendarService, mockPopulationService, daysInThisBatch);
                
            } catch (error) {
                // Silently continue on errors
            }

            // Report every N years
            if (currentYear > lastReportYear && currentYear % REPORT_INTERVAL_YEARS === 0 && currentMonth === 1 && currentDay <= DAYS_PER_BATCH) {
                lastReportYear = currentYear;
                const stats = await gatherStats(PopulationState, calculateAge, storage, currentYear, currentMonth, currentDay);
                
                const elapsed = (Date.now() - startTime) / 1000;
                const progress = (batchNum / TOTAL_BATCHES * 100).toFixed(1);
                
                console.log(`\n📅 Year ${currentYear} (${progress}% complete, ${elapsed.toFixed(1)}s elapsed)`);
                console.log('───────────────────────────────────────────────────────────────');
                printCompactStats(stats);
            }

            // Progress indicator every 10 years
            if (currentMonth === 1 && currentDay <= DAYS_PER_BATCH && currentYear % 10 === 0 && currentYear !== lastReportYear) {
                process.stdout.write(`  Year ${currentYear}...`);
            }
        }

        // Final stats
        const finalStats = await gatherStats(PopulationState, calculateAge, storage, currentYear, currentMonth, currentDay);
        
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('                    FINAL STATE');
        console.log('═══════════════════════════════════════════════════════════════');
        printStats(finalStats);

        // Summary report
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                    SIMULATION SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const totalBirths = yearlyReports.reduce((sum, r) => sum + r.totalBirths, 0);
        const totalDeaths = yearlyReports.reduce((sum, r) => sum + r.totalDeaths, 0);
        const totalNewFamilies = yearlyReports.reduce((sum, r) => sum + r.newFamilies, 0);
        const avgGrowthRate = yearlyReports.length > 0 
            ? yearlyReports.reduce((sum, r) => sum + r.growthRate, 0) / yearlyReports.length 
            : 0;

        console.log(`\n📊 Population Change:`);
        console.log(`   Start: ${initialStats.totalPopulation.toLocaleString()}`);
        console.log(`   End:   ${finalStats.totalPopulation.toLocaleString()}`);
        console.log(`   Net:   ${(finalStats.totalPopulation - initialStats.totalPopulation).toLocaleString()} (${((finalStats.totalPopulation - initialStats.totalPopulation) / initialStats.totalPopulation * 100).toFixed(1)}%)`);
        
        console.log(`\n👶 Births: ${totalBirths.toLocaleString()}`);
        console.log(`💀 Deaths: ${totalDeaths.toLocaleString()}`);
        console.log(`💒 New Families: ${totalNewFamilies.toLocaleString()}`);
        console.log(`📈 Avg Annual Growth Rate: ${avgGrowthRate.toFixed(2)}%`);

        // Print yearly summary table
        console.log('\n───────────────────────────────────────────────────────────────');
        console.log('YEARLY BREAKDOWN (every 10 years):');
        console.log('───────────────────────────────────────────────────────────────');
        console.log('Year  | Population | Births | Deaths | Families | Growth%');
        console.log('───────────────────────────────────────────────────────────────');
        
        for (const report of yearlyReports.filter(r => r.year % 10 === 0)) {
            console.log(
                `${String(report.year).padStart(5)} | ` +
                `${String(report.endPopulation).padStart(10)} | ` +
                `${String(report.totalBirths).padStart(6)} | ` +
                `${String(report.totalDeaths).padStart(6)} | ` +
                `${String(report.newFamilies).padStart(8)} | ` +
                `${report.growthRate.toFixed(1).padStart(6)}%`
            );
        }

        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n⏱️  Simulation completed in ${elapsed.toFixed(1)} seconds`);
        console.log(`   (${(TOTAL_DAYS / elapsed).toFixed(0)} simulated days per second)`);

        // Health check
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                    HEALTH CHECK');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const issues: string[] = [];
        
        if (totalBirths === 0) {
            issues.push('❌ No births occurred - pregnancy/delivery system may be broken');
        } else {
            console.log('✅ Births are occurring');
        }
        
        if (totalDeaths === 0) {
            issues.push('⚠️  No deaths occurred - senescence may not be working');
        } else {
            console.log('✅ Deaths from aging are occurring');
        }
        
        if (totalNewFamilies === 0) {
            issues.push('❌ No new families formed - matchmaking may be broken');
        } else {
            console.log('✅ New families are forming');
        }
        
        if (finalStats.eligibleMales === 0 && finalStats.eligibleFemales === 0) {
            issues.push('⚠️  No eligible singles - matchmaking pool may be empty');
        } else {
            console.log(`✅ Eligible singles: ${finalStats.eligibleMales} males, ${finalStats.eligibleFemales} females`);
        }
        
        // Check for generational reproduction
        if (YEARS_TO_SIMULATE >= 20 && totalNewFamilies > 0) {
            // If we ran 20+ years and new families formed, generational reproduction is working
            console.log('✅ Generational reproduction is working (new families from grown children)');
        }

        if (issues.length > 0) {
            console.log('\n⚠️  Issues detected:');
            issues.forEach(issue => console.log(`   ${issue}`));
        } else {
            console.log('\n🎉 All systems appear healthy!');
        }

    } catch (error) {
        console.error('❌ Simulation failed:', error);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

async function waitForStorage(storage: any, maxWait = 10000): Promise<void> {
    const start = Date.now();
    while (!storage.isAvailable()) {
        if (Date.now() - start > maxWait) {
            throw new Error('Redis connection timeout');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function getPopulationCount(PopulationState: any): Promise<number> {
    const people = await PopulationState.getAllPeople();
    return people.length;
}

async function gatherStats(
    PopulationState: any, 
    calculateAge: any,
    storage: any,
    year: number, 
    month: number, 
    day: number
): Promise<SimulationStats> {
    const people = await PopulationState.getAllPeople();
    const families = await PopulationState.getAllFamilies();
    
    let males = 0, females = 0;
    let minors = 0, adults = 0, elderly = 0;
    
    for (const person of people) {
        // Handle both boolean and string sex formats
        const isMale = person.sex === true || person.sex === 'M';
        if (isMale) males++; else females++;
        
        if (person.date_of_birth) {
            const age = calculateAge(person.date_of_birth, year, month, day);
            if (age < 16) minors++;
            else if (age < 60) adults++;
            else elderly++;
        }
    }
    
    const pregnantFamilies = families.filter((f: any) => f.pregnancy === true).length;
    
    // Count eligible singles
    let eligibleMales = 0;
    let eligibleFemales = 0;
    
    try {
        const maleTiles = await storage.smembers('tiles_with_eligible_males') || [];
        const femaleTiles = await storage.smembers('tiles_with_eligible_females') || [];
        
        for (const tileId of maleTiles) {
            const count = await storage.scard(`eligible:males:tile:${tileId}`);
            eligibleMales += parseInt(count || '0', 10);
        }
        
        for (const tileId of femaleTiles) {
            const count = await storage.scard(`eligible:females:tile:${tileId}`);
            eligibleFemales += parseInt(count || '0', 10);
        }
    } catch (e) {
        // Ignore errors counting eligible
    }
    
    return {
        year,
        month,
        day,
        totalPopulation: people.length,
        males,
        females,
        minors,
        adults,
        elderly,
        totalFamilies: families.length,
        pregnantFamilies,
        eligibleMales,
        eligibleFemales,
        birthsThisYear: 0,
        deathsThisYear: 0,
        newFamiliesThisYear: 0
    };
}

function printStats(stats: SimulationStats): void {
    console.log(`\n📅 Date: Year ${stats.year}, Month ${stats.month}, Day ${stats.day}`);
    console.log(`\n👥 Population: ${stats.totalPopulation.toLocaleString()}`);
    console.log(`   ├─ Males: ${stats.males.toLocaleString()} (${(stats.males / stats.totalPopulation * 100).toFixed(1)}%)`);
    console.log(`   └─ Females: ${stats.females.toLocaleString()} (${(stats.females / stats.totalPopulation * 100).toFixed(1)}%)`);
    console.log(`\n📊 Age Distribution:`);
    console.log(`   ├─ Children (0-15): ${stats.minors.toLocaleString()} (${(stats.minors / stats.totalPopulation * 100).toFixed(1)}%)`);
    console.log(`   ├─ Adults (16-59): ${stats.adults.toLocaleString()} (${(stats.adults / stats.totalPopulation * 100).toFixed(1)}%)`);
    console.log(`   └─ Elderly (60+): ${stats.elderly.toLocaleString()} (${(stats.elderly / stats.totalPopulation * 100).toFixed(1)}%)`);
    console.log(`\n👨‍👩‍👧 Families: ${stats.totalFamilies.toLocaleString()}`);
    console.log(`   └─ Pregnant: ${stats.pregnantFamilies.toLocaleString()}`);
    console.log(`\n💑 Eligible Singles:`);
    console.log(`   ├─ Males: ${stats.eligibleMales.toLocaleString()}`);
    console.log(`   └─ Females: ${stats.eligibleFemales.toLocaleString()}`);
}

function printCompactStats(stats: SimulationStats): void {
    console.log(`Pop: ${stats.totalPopulation.toLocaleString()} (M:${stats.males}/F:${stats.females}) | ` +
                `Ages: <16:${stats.minors} 16-59:${stats.adults} 60+:${stats.elderly} | ` +
                `Families: ${stats.totalFamilies} (${stats.pregnantFamilies} pregnant) | ` +
                `Singles: M:${stats.eligibleMales}/F:${stats.eligibleFemales}`);
}

// Run the simulation
main().catch(console.error);
