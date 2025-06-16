const pool = require('./server/config/database.js');

async function fixPopulation() {
    try {
        // Get calendar service to check current date
        const calendarService = require('./server/services/calendarService.js');
        const currentDate = calendarService.getCurrentDate();
        console.log('Current calendar date:', currentDate);
        
        // Check current population age distribution
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                AVG(EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM date_of_birth::date)) as avg_age
            FROM people
            LIMIT 5
        `);
        console.log('Current population:', result.rows[0]);
        
        // Sample some birth dates
        const sampleResult = await pool.query('SELECT date_of_birth FROM people LIMIT 10');
        console.log('Sample birth dates:', sampleResult.rows);
        
        await pool.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

fixPopulation();
