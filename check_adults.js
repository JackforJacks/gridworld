const pool = require('./server/config/database.js');

async function checkAdults() {
    try {
        // Get current calendar date from the API
        const response = await fetch('http://localhost:3000/api/calendar/state');
        const calendarData = await response.json();
        
        console.log('Calendar state:', calendarData.data);
        
        const currentDate = calendarData.data.currentDate;
        const cutoffYear = currentDate.year - 18;
        const cutoffDate = `${cutoffYear}-${String(currentDate.month).padStart(2, '0')}-${String(currentDate.day).padStart(2, '0')}`;
        
        console.log('Cutoff date for adults (18+):', cutoffDate);
        
        // Check adults
        const result = await pool.query('SELECT COUNT(*) FROM people WHERE date_of_birth <= $1', [cutoffDate]);
        console.log('Adults (18+):', result.rows[0].count);
        
        // Check some sample birth dates
        const sampleResult = await pool.query('SELECT date_of_birth FROM people ORDER BY date_of_birth DESC LIMIT 5');
        console.log('Recent birth dates:', sampleResult.rows.map(r => r.date_of_birth));
        
        const oldestResult = await pool.query('SELECT date_of_birth FROM people ORDER BY date_of_birth ASC LIMIT 5');
        console.log('Oldest birth dates:', oldestResult.rows.map(r => r.date_of_birth));
        
        await pool.end();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkAdults();
