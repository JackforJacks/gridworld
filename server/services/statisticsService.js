// Statistics Service - In-memory vital statistics tracking
class StatisticsService {
    constructor(calendarService = null) {
        // In-memory storage for vital events
        this.vitalEvents = []; // Array of { year, month, births, deaths, population }
        this.calendarService = calendarService;
        this.isTracking = false;
    }

    /**
     * Initialize the statistics service
     */
    initialize(calendarService = null) {
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
        if (this.vitalEvents.length > 1200) { // 100 years * 12 months
            this.vitalEvents = this.vitalEvents.slice(-1200);
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
     * @param {number} years - Number of years to include
     * @returns {Object} Chart.js compatible data structure
     */
    getVitalRatesForChart(years = 100) {
        const currentDate = this.getCurrentCalendarDate();
        const cutoffYear = currentDate.year - years;

        // Filter events to the requested time period
        const relevantEvents = this.vitalEvents.filter(event => event.year >= cutoffYear);

        // Group by year and calculate annual rates
        const yearlyData = {};

        relevantEvents.forEach(event => {
            if (!yearlyData[event.year]) {
                yearlyData[event.year] = {
                    year: event.year,
                    totalBirths: 0,
                    totalDeaths: 0,
                    avgPopulation: 0,
                    monthCount: 0
                };
            }

            yearlyData[event.year].totalBirths += event.births;
            yearlyData[event.year].totalDeaths += event.deaths;
            yearlyData[event.year].avgPopulation += event.population;
            yearlyData[event.year].monthCount++;
        });

        // Calculate rates and prepare chart data
        const chartLabels = [];
        const birthRates = [];
        const deathRates = [];

        // Sort years and calculate rates
        const sortedYears = Object.keys(yearlyData).sort((a, b) => parseInt(a) - parseInt(b));

        sortedYears.forEach(year => {
            const data = yearlyData[year];
            const avgPop = data.avgPopulation / Math.max(data.monthCount, 1);

            // Calculate rates per 1000 people
            const birthRate = avgPop > 0 ? (data.totalBirths / avgPop) * 1000 : 0;
            const deathRate = avgPop > 0 ? (data.totalDeaths / avgPop) * 1000 : 0;

            chartLabels.push(year);
            birthRates.push(parseFloat(birthRate.toFixed(2)));
            deathRates.push(parseFloat(deathRate.toFixed(2)));
        });        // If no data, provide dummy data for the last 10 years of the requested range
        if (chartLabels.length === 0) {
            const currentDate = this.getCurrentCalendarDate();
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
     * @returns {Object} Summary stats
     */
    getSummaryStats() {
        const recentEvents = this.vitalEvents.slice(-12); // Last 12 months
        const totalBirths = recentEvents.reduce((sum, event) => sum + event.births, 0);
        const totalDeaths = recentEvents.reduce((sum, event) => sum + event.deaths, 0);
        const avgPopulation = recentEvents.length > 0
            ? recentEvents.reduce((sum, event) => sum + event.population, 0) / recentEvents.length
            : 0;

        return {
            totalEvents: this.vitalEvents.length,
            recentBirths: totalBirths,
            recentDeaths: totalDeaths,
            avgPopulation: Math.round(avgPopulation),
            dataRange: this.vitalEvents.length > 0
                ? `${Math.min(...this.vitalEvents.map(e => e.year))} - ${Math.max(...this.vitalEvents.map(e => e.year))}`
                : 'No data'
        };
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

module.exports = StatisticsService;
