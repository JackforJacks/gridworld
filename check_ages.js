const pool = require('./server/config/database.js');

async function checkCurrentAges() {
    try {
        // Check sample birth dates from database
        const sampleResult = await pool.query('SELECT date_of_birth FROM people LIMIT 10');
        console.log('Sample birth dates from database:');
        sampleResult.rows.forEach((row, i) => {
            console.log(`Person ${i + 1}: ${row.date_of_birth}`);
        });
        
        // Check the range of birth dates
        const rangeResult = await pool.query(`
            SELECT 
                MIN(date_of_birth) as earliest_birth,
                MAX(date_of_birth) as latest_birth,
                COUNT(*) as total_people
            FROM people
        `);
        
        console.log('\nBirth date range:');
        console.log('Earliest birth:', rangeResult.rows[0].earliest_birth);
        console.log('Latest birth:', rangeResult.rows[0].latest_birth);
        console.log('Total people:', rangeResult.rows[0].total_people);
        
        // Calculate ages based on current real date (2025-06-16)
        const currentDate = '2025-06-16';
        const ageResult = await pool.query(`
            SELECT 
                date_of_birth,
                EXTRACT(YEAR FROM AGE($1::date, date_of_birth)) as calculated_age
            FROM people 
            LIMIT 5
        `, [currentDate]);
        
        console.log('\nAge calculations with current date (2025-06-16):');
        ageResult.rows.forEach((row, i) => {
            console.log(`Person ${i + 1}: Birth ${row.date_of_birth}, Age ${row.calculated_age}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkCurrentAges();
