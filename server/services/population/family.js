const { addPeopleToTile, removePeopleFromTile } = require('./manager.js');

async function Procreation(pool, calendarService, populationServiceInstance, tileId, population) {
    try {
        const result = await pool.query('SELECT COUNT(*) FROM people WHERE tile_id = $1', [tileId]);
        const currentCount = parseInt(result.rows[0].count, 10);

        let calendarDateToUse;
        if (calendarService && typeof calendarService.getState === 'function') {
            const calendarState = calendarService.getState();
            if (calendarState && calendarState.currentDate) {
                calendarDateToUse = calendarState.currentDate;
            } else {
                console.warn('[family.js.Procreation] CalendarService.getState() did not return a valid currentDate. Using an absolute fallback (Year 1, Month 1, Day 1).');
                calendarDateToUse = { year: 1, month: 1, day: 1 }; // Ultimate fallback
            }
        } else {
            console.warn('[family.js.Procreation] CalendarService not available or getState is not a function. Using an absolute fallback (Year 1, Month 1, Day 1).');
            calendarDateToUse = { year: 1, month: 1, day: 1 }; // Ultimate fallback
        }
        const { year: currentYear, month: currentMonth, day: currentDay } = calendarDateToUse;

        if (population > currentCount) {
            const birthCount = population - currentCount;
            // Assuming addPeopleToTile is available and correctly imported
            await addPeopleToTile(pool, tileId, birthCount, currentYear, currentMonth, currentDay, populationServiceInstance, true);
        } else if (population < currentCount) {
            const deathCount = currentCount - population;
            // Assuming removePeopleFromTile is available and correctly imported
            await removePeopleFromTile(pool, tileId, deathCount, populationServiceInstance, true);
        }
        // The broadcastUpdate should ideally be called from PopulationService after this function completes.
        // Or, populationServiceInstance must have a broadcastUpdate method.
        if (populationServiceInstance && typeof populationServiceInstance.broadcastUpdate === 'function') {
            await populationServiceInstance.broadcastUpdate('populationUpdate');
        } else {
            console.warn('[family.js.Procreation] populationServiceInstance.broadcastUpdate is not a function. Update not broadcasted.');
        }
    } catch (error) {
        console.error(`[family.js.Procreation] Error updating population for tile ${tileId}:`, error);
        throw error; // Re-throw the error to be handled by the caller
    }
}

module.exports = {
    Procreation
};
