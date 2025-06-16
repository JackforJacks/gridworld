const pool = require('./server/config/database.js');

async function checkEligibility() {
    try {
        // Get current date minus 18 years for eligibility
        const currentDate = new Date();
        const eighteenYearsAgo = new Date(currentDate.getFullYear() - 18, currentDate.getMonth(), currentDate.getDate());
        const cutoffDate = eighteenYearsAgo.toISOString().split('T')[0];
        
        console.log('Cutoff date for 18+ eligibility:', cutoffDate);
        
        // Check eligible adults
        const eligibleMalesResult = await pool.query('SELECT COUNT(*) FROM people WHERE sex = TRUE AND date_of_birth <= $1', [cutoffDate]);
        const eligibleFemalesResult = await pool.query('SELECT COUNT(*) FROM people WHERE sex = FALSE AND date_of_birth <= $1', [cutoffDate]);
        const totalPeopleResult = await pool.query('SELECT COUNT(*) FROM people');
        
        console.log('Total people:', totalPeopleResult.rows[0].count);
        console.log('Eligible males (18+):', eligibleMalesResult.rows[0].count);
        console.log('Eligible females (18+):', eligibleFemalesResult.rows[0].count);
        
        // Check age distribution
        const ageCheckResult = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE date_of_birth > $1) as minors,
                COUNT(*) FILTER (WHERE date_of_birth <= $1) as adults
            FROM people
        `, [cutoffDate]);
        
        console.log('Age distribution:', ageCheckResult.rows[0]);
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkEligibility();
