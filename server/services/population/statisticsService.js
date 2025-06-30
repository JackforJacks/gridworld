// In-Memory Statistics Service for Population Vital Rates
class StatisticsService {
    constructor() {
        this.events = []; // Array to store all birth/death events
        this.yearlyStats = new Map(); // Map to store aggregated yearly statistics
    }

    /**
     * Records a birth event
     * @param {Object} date - Calendar date object {year, month, day}
     */
    recordBirth(date) {
        const event = {
            type: 'birth',
            date: date,
            timestamp: Date.now()
        };
        this.events.push(event);
        this.updateYearlyStats(date.year, 'births', 1);
    }

    /**
     * Records a death event
     * @param {Object} date - Calendar date object {year, month, day}
     */
    recordDeath(date) {
        const event = {
            type: 'death',
            date: date,
            timestamp: Date.now()
        };
        this.events.push(event);
        this.updateYearlyStats(date.year, 'deaths', 1);
    }

    /**
     * Updates yearly statistics
     * @param {number} year - The year
     * @param {string} type - 'births' or 'deaths'
     * @param {number} count - Number to add
     */
    updateYearlyStats(year, type, count) {
        if (!this.yearlyStats.has(year)) {
            this.yearlyStats.set(year, { births: 0, deaths: 0, population: 0 });
        }
        const stats = this.yearlyStats.get(year);
        stats[type] += count;
    }

    /**
     * Updates population count for a year
     * @param {number} year - The year
     * @param {number} population - Current population
     */
    updatePopulation(year, population) {
        if (!this.yearlyStats.has(year)) {
            this.yearlyStats.set(year, { births: 0, deaths: 0, population: 0 });
        }
        this.yearlyStats.get(year).population = population;
    }

    /**
     * Gets vital rates formatted for chart display
     * @param {number} years - Number of years to retrieve (default: 100)
     * @returns {Object} Chart-ready data with labels and datasets
     */
    getVitalRatesForChart(years = 100) {
        const currentYear = this.getCurrentYear();
        const startYear = Math.max(1, currentYear - years + 1);

        const labels = [];
        const birthRates = [];
        const deathRates = [];

        for (let year = startYear; year <= currentYear; year++) {
            const stats = this.yearlyStats.get(year) || { births: 0, deaths: 0, population: 1000 };
            const population = Math.max(stats.population, 1); // Avoid division by zero

            labels.push(year.toString());
            birthRates.push(Number(((stats.births / population) * 1000).toFixed(2)));
            deathRates.push(Number(((stats.deaths / population) * 1000).toFixed(2)));
        }

        return {
            labels: labels,
            datasets: [
                {
                    label: 'Birth Rate (per 1000)',
                    data: birthRates,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: false,
                    tension: 0.1
                },
                {
                    label: 'Death Rate (per 1000)',
                    data: deathRates,
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    fill: false,
                    tension: 0.1
                }
            ]
        };
    }

    /**
     * Gets summary statistics
     * @returns {Object} Summary stats including totals and recent rates
     */
    getSummaryStats() {
        const currentYear = this.getCurrentYear();
        const currentStats = this.yearlyStats.get(currentYear) || { births: 0, deaths: 0, population: 1000 };
        const lastYearStats = this.yearlyStats.get(currentYear - 1) || { births: 0, deaths: 0, population: 1000 };

        const totalBirths = Array.from(this.yearlyStats.values()).reduce((sum, stats) => sum + stats.births, 0);
        const totalDeaths = Array.from(this.yearlyStats.values()).reduce((sum, stats) => sum + stats.deaths, 0);

        return {
            totalEvents: this.events.length,
            totalBirths: totalBirths,
            totalDeaths: totalDeaths,
            currentYearBirths: currentStats.births,
            currentYearDeaths: currentStats.deaths,
            currentYearBirthRate: Number(((currentStats.births / Math.max(currentStats.population, 1)) * 1000).toFixed(2)),
            currentYearDeathRate: Number(((currentStats.deaths / Math.max(currentStats.population, 1)) * 1000).toFixed(2)),
            lastYearBirthRate: Number(((lastYearStats.births / Math.max(lastYearStats.population, 1)) * 1000).toFixed(2)),
            lastYearDeathRate: Number(((lastYearStats.deaths / Math.max(lastYearStats.population, 1)) * 1000).toFixed(2)),
            yearsTracked: this.yearlyStats.size
        };
    }

    /**
     * Gets the current year (mock implementation)
     * @returns {number} Current year
     */
    getCurrentYear() {
        // This would normally get the year from the calendar service
        // For now, return a default year that can be incremented
        return Math.max(1, Array.from(this.yearlyStats.keys()).sort((a, b) => b - a)[0] || 1);
    }

    /**
     * Clears all statistics (for testing/reset purposes)
     */
    reset() {
        this.events = [];
        this.yearlyStats.clear();
    }

    /**
     * Gets raw events for debugging
     * @param {number} limit - Maximum number of events to return
     * @returns {Array} Array of events
     */
    getEvents(limit = 100) {
        return this.events.slice(-limit);
    }
}

module.exports = StatisticsService;
