const { calculateRates } = require('./calculator.js');

async function fetchPopulationStats(pool, calendarService, populationServiceInstance) {
    try {
        let currentDate = new Date(); // Fallback if calendarService is not available
        let calendarCutoffMinors = null;
        let calendarCutoffElderly = null;

        const currentCalendarDate = calendarService ? calendarService.getState().currentDate : null;

        if (currentCalendarDate) {
            const { year, month, day } = currentCalendarDate;
            const minorsYear = year - 16;
            calendarCutoffMinors = `${minorsYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const elderlyYear = year - 60;
            calendarCutoffElderly = `${elderlyYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            currentDate = new Date(year, month - 1, day); // JS month is 0-indexed
        } else {
            // Fallback to system date if calendarService is not available or doesn't provide a date
            console.warn('[fetchPopulationStats] CalendarService not available or did not provide currentDate. Using system date for cutoffs.');
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth() + 1; // JS month is 0-indexed
            const day = currentDate.getDate();

            const minorsYear = year - 16;
            calendarCutoffMinors = `${minorsYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const elderlyYear = year - 60;
            calendarCutoffElderly = `${elderlyYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }

        const result = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE sex = true) AS male,
                COUNT(*) FILTER (WHERE sex = false) AS female,
                COUNT(*) FILTER (WHERE date_of_birth > $1) AS minors,
                COUNT(*) FILTER (WHERE date_of_birth <= $1 AND date_of_birth > $2) AS working_age,
                COUNT(*) FILTER (WHERE date_of_birth <= $2) AS elderly
            FROM people;`, [calendarCutoffMinors, calendarCutoffElderly]);

        const rates = calculateRates(populationServiceInstance); // Pass the instance for context
        const stats = { ...(result.rows[0] || {}), ...rates }; // Ensure result.rows[0] is not undefined
        return stats;
    } catch (error) {
        console.error('Error getting population stats in fetchPopulationStats:', error);
        const rates = calculateRates(populationServiceInstance); // Still provide rates in case of error
        return { male: '0', female: '0', minors: '0', working_age: '0', elderly: '0', ...rates };
    }
}

module.exports = { fetchPopulationStats };
