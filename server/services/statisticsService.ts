// Statistics Service - Vital statistics tracking (now using Rust calculations)
import { VITAL_EVENTS_MAX_RECORDS } from '../config/gameBalance';
import rustSimulation from './rustSimulation';

interface VitalEvent {
    year: number;
    month: number;
    births: number;
    deaths: number;
    population: number;
    lastUpdated?: Date;
}

interface CalendarDate {
    year: number;
    month: number;
}

/**
 * Statistics Service (Phase 3 - Rust integration)
 *
 * This service now uses Rust event log for accurate vital statistics calculations.
 * The in-memory vitalEvents array is deprecated but kept for backward compatibility.
 *
 * Source of truth: Rust EventLog (persisted in bincode saves)
 * Calculations: Rust VitalStatistics (birth/death/marriage rates per 1000 per year)
 * Node.js role: Format data for client, WebSocket broadcasting, maintain recording API
 */
class StatisticsService {
    vitalEvents: VitalEvent[]; // DEPRECATED - kept for backward compatibility only
    calendarService: any;
    isTracking: boolean;

    constructor(calendarService: any = null) {
        // In-memory storage (DEPRECATED - Rust event log is source of truth)
        this.vitalEvents = [];
        this.calendarService = calendarService;
        this.isTracking = false;
    }

    /**
     * Initialize the statistics service
     */
    initialize(calendarService: any = null) {
        if (calendarService) {
            this.calendarService = calendarService;
        }
        this.isTracking = true;
    }

    /**
     * Get current calendar date or fallback to real date
     */
    getCurrentCalendarDate() {
        if (this.calendarService) {
            const state = this.calendarService.getState();
            return {
                year: state.currentDate.year,
                month: state.currentDate.month
            };
        }
        // Fallback to real date if no calendar service
        return {
            year: new Date().getFullYear(),
            month: new Date().getMonth() + 1
        };
    }

    /**
     * Record vital statistics for a specific time period
     * @param {Object} data - { year, month, births, deaths, population }
     */
    recordVitalStats(data) {
        if (!this.isTracking) return;

        const { year, month, births, deaths, population } = data;

        // Find existing record or create new one
        const existingIndex = this.vitalEvents.findIndex(
            event => event.year === year && event.month === month
        );

        if (existingIndex >= 0) {
            // Update existing record
            this.vitalEvents[existingIndex] = {
                year,
                month,
                births: births || 0,
                deaths: deaths || 0,
                population: population || 0,
                lastUpdated: new Date()
            };
        } else {
            // Add new record
            this.vitalEvents.push({
                year,
                month,
                births: births || 0,
                deaths: deaths || 0,
                population: population || 0,
                lastUpdated: new Date()
            });
        }

        // Keep only recent data (limit to prevent memory issues)
        if (this.vitalEvents.length > VITAL_EVENTS_MAX_RECORDS) {
            this.vitalEvents = this.vitalEvents.slice(-VITAL_EVENTS_MAX_RECORDS);
        }
    }    /**
     * Record a birth event
     * @param {number} population 
     */
    recordBirth(population) {
        const date = this.getCurrentCalendarDate();
        this.updateVitalEvent(date.year, date.month, { births: 1 }, population);
    }

    /**
     * Record a death event
     * @param {number} population 
     */
    recordDeath(population) {
        const date = this.getCurrentCalendarDate();
        this.updateVitalEvent(date.year, date.month, { deaths: 1 }, population);
    }

    /**
     * Update a vital event (births or deaths)
     * @param {number} year 
     * @param {number} month 
     * @param {Object} increment - { births?: number, deaths?: number }
     * @param {number} population 
     */
    updateVitalEvent(year, month, increment, population) {
        if (!this.isTracking) return;

        const existingIndex = this.vitalEvents.findIndex(
            event => event.year === year && event.month === month
        );

        if (existingIndex >= 0) {
            // Update existing record
            const event = this.vitalEvents[existingIndex];
            event.births += increment.births || 0;
            event.deaths += increment.deaths || 0;
            event.population = population || event.population;
            event.lastUpdated = new Date();
        } else {
            // Create new record
            this.vitalEvents.push({
                year,
                month,
                births: increment.births || 0,
                deaths: increment.deaths || 0,
                population: population || 0,
                lastUpdated: new Date()
            });
        }
    }    /**
     * Get vital rates chart data for the last N years
     * Now uses Rust event log for accurate historical statistics
     * @param {number} years - Number of years to include
     * @returns {Object} Chart.js compatible data structure
     */
    getVitalRatesForChart(years = 100) {
        const currentDate = this.getCurrentCalendarDate();
        const startYear = currentDate.year - years + 1;

        // Prepare chart data arrays
        const chartLabels: string[] = [];
        const birthRates: number[] = [];
        const deathRates: number[] = [];

        try {
            // Get statistics from Rust for each year in the range
            for (let year = startYear; year <= currentDate.year; year++) {
                const stats = rustSimulation.calculateVitalStatistics(year, year);

                chartLabels.push(year.toString());
                birthRates.push(parseFloat(stats.birthRate.toFixed(2)));
                deathRates.push(parseFloat(stats.deathRate.toFixed(2)));
            }

            // If no data (early in simulation), provide zeros for last 10 years
            if (chartLabels.length === 0) {
                for (let i = 9; i >= 0; i--) {
                    chartLabels.push((currentDate.year - i).toString());
                    birthRates.push(0);
                    deathRates.push(0);
                }
            }
        } catch (error) {
            console.error('Error fetching Rust statistics for chart:', error);
            // Fallback: provide zeros for last 10 years
            for (let i = 9; i >= 0; i--) {
                chartLabels.push((currentDate.year - i).toString());
                birthRates.push(0);
                deathRates.push(0);
            }
        }

        return {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Birth Rate (per 1000)',
                    data: birthRates,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    tension: 0.1
                },
                {
                    label: 'Death Rate (per 1000)',
                    data: deathRates,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    tension: 0.1
                }
            ]
        };
    }

    /**
     * Get summary statistics
     * Now uses Rust event log for accurate statistics
     * @returns {Object} Summary stats
     */
    getSummaryStats() {
        try {
            // Get current year statistics from Rust
            const currentYearStats = rustSimulation.calculateCurrentYearStatistics();
            const eventCount = rustSimulation.getEventCount();
            const currentDate = this.getCurrentCalendarDate();

            return {
                totalEvents: eventCount,
                recentBirths: currentYearStats.totalBirths,
                recentDeaths: currentYearStats.totalDeaths,
                avgPopulation: currentYearStats.population,
                birthRate: parseFloat(currentYearStats.birthRate.toFixed(2)),
                deathRate: parseFloat(currentYearStats.deathRate.toFixed(2)),
                naturalIncreaseRate: parseFloat(currentYearStats.naturalIncreaseRate.toFixed(2)),
                dataRange: eventCount > 0
                    ? `Year ${currentDate.year} (${eventCount} events total)`
                    : 'No data'
            };
        } catch (error) {
            console.error('Error fetching Rust summary statistics:', error);
            return {
                totalEvents: 0,
                recentBirths: 0,
                recentDeaths: 0,
                avgPopulation: 0,
                birthRate: 0,
                deathRate: 0,
                naturalIncreaseRate: 0,
                dataRange: 'No data'
            };
        }
    }

    /**
     * Reset all statistics
     */
    reset() {
        this.vitalEvents = [];
        console.log('📈 Statistics service reset');
    }

    /**
     * Stop tracking statistics
     */
    shutdown() {
        this.isTracking = false;
        console.log('📈 Statistics service stopped');
    }
}

export default StatisticsService;
