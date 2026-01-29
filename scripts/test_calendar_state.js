// Test script to check calendar state in database and test loading
const { Pool } = require('pg');

async function testCalendarState() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🧪 Testing calendar state functionality...\n');

        // Check current calendar state in database
        const calendarQuery = 'SELECT * FROM calendar_state LIMIT 1';
        const calendarResult = await pool.query(calendarQuery);

        if (calendarResult.rows.length > 0) {
            const state = calendarResult.rows[0];
            console.log('📅 Current calendar state in database:');
            console.log(`   Year: ${state.current_year}`);
            console.log(`   Month: ${state.current_month}`);
            console.log(`   Day: ${state.current_day}`);
            console.log(`   Last updated: ${state.last_updated}`);
        } else {
            console.log('📅 No calendar state found in database');
        }

        // Test calendar service loading
        console.log('\n🔄 Testing calendar service state loading...');
        const { getCalendarState } = require('../server/models/calendarState');

        const dbState = await getCalendarState();
        if (dbState) {
            console.log('✅ Calendar state loaded from database:');
            console.log(`   Year: ${dbState.current_year}, Month: ${dbState.current_month}, Day: ${dbState.current_day}`);
        } else {
            console.log('❌ No calendar state could be loaded from database');
        }

        // Test setting calendar state
        console.log('\n💾 Testing calendar state saving...');
        const { setCalendarState } = require('../server/models/calendarState');

        const testDate = { year: 4005, month: 6, day: 15 };
        const savedState = await setCalendarState(testDate);
        console.log('✅ Calendar state saved:');
        console.log(`   Year: ${savedState.current_year}, Month: ${savedState.current_month}, Day: ${savedState.current_day}`);

        // Verify it was saved
        const verifyState = await getCalendarState();
        if (verifyState.current_year === testDate.year &&
            verifyState.current_month === testDate.month &&
            verifyState.current_day === testDate.day) {
            console.log('✅ Calendar state verification passed');
        } else {
            console.log('❌ Calendar state verification failed');
        }

        // Reset to a reasonable date for testing
        await setCalendarState({ year: 4003, month: 3, day: 4 });
        console.log('🔄 Reset calendar state to Year 4003, Month 3, Day 4 for testing');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await pool.end();
    }
}

testCalendarState().catch(console.error);