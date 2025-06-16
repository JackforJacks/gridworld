const pool = require('./server/config/database.js');

async function quickCheck() {
    try {
        // Check current calendar date from calendar service
        const calendarService = require('./server/services/calendarService.js');
        const calendarState = calendarService.getState();
        console.log('Current calendar state:', calendarState);
        
        // Check a few birth dates from database
        const sampleResult = await pool.query('SELECT date_of_birth FROM people LIMIT 5');
        console.log('Sample birth dates:', sampleResult.rows);
        
        // Quick age calculation test
        const currentDate = calendarState.currentDate;
        if (currentDate) {
            const { year, month, day } = currentDate;
            console.log(`Current date: Year ${year}, Month ${month}, Day ${day}`);
            
            // Test age calculation with sample birth date
            const { calculateAge } = require('./server/services/population/calculator.js');
            const testBirthDate = '3980-05-03'; // 20-year-old
            const testAge = calculateAge(testBirthDate, year, month, day);
            console.log(`Test: Birth date ${testBirthDate} -> Age ${testAge} years`);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

quickCheck();
