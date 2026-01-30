// Test script to verify calendar state reloading during load operations
const { Pool } = require('pg');

async function testLoadCalendarState() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🧪 Testing calendar state reloading functionality...\n');

        // First, set a specific calendar date
        const { setCalendarState } = require('../server/models/calendarState');
        const testDate = { year: 4005, month: 6, day: 15 };
        await setCalendarState(testDate);
        console.log(`📅 Set calendar state to: Year ${testDate.year}, Month ${testDate.month}, Day ${testDate.day}`);

        // Test the calendar service loadStateFromDB method directly
        console.log('\n🔄 Testing CalendarService.loadStateFromDB directly...');

        // Create a minimal calendar service instance for testing
        const CalendarService = require('../server/services/calendarService');
        const calendarService = new CalendarService();

        // Initialize it (this will load state from DB)
        await calendarService.initialize();

        console.log(`📅 Calendar service current date after initialization: Year ${calendarService.currentDate.year}, Month ${calendarService.currentDate.month}, Day ${calendarService.currentDate.day}`);

        // Now test loadStateFromDB again
        await calendarService.loadStateFromDB();

        console.log(`📅 Calendar service current date after loadStateFromDB: Year ${calendarService.currentDate.year}, Month ${calendarService.currentDate.month}, Day ${calendarService.currentDate.day}`);

        // Check if the date is correct
        if (calendarService.currentDate.year === testDate.year &&
            calendarService.currentDate.month === testDate.month &&
            calendarService.currentDate.day === testDate.day) {
            console.log('✅ Calendar service correctly loaded the date from database');
        } else {
            console.log(`❌ Calendar service loaded wrong date: Year ${calendarService.currentDate.year}, Month ${calendarService.currentDate.month}, Day ${calendarService.currentDate.day}`);
        }

        // Test that events are emitted (we can't test socket emission without a server, but we can check the emit call)
        let eventEmitted = false;
        calendarService.on('dateSet', (state) => {
            eventEmitted = true;
            console.log(`📡 dateSet event emitted with state: Year ${state.currentDate.year}, Month ${state.currentDate.month}, Day ${state.currentDate.day}`);
        });

        await calendarService.loadStateFromDB();

        if (eventEmitted) {
            console.log('✅ Calendar service emitted dateSet event after loading');
        } else {
            console.log('❌ Calendar service did not emit dateSet event after loading');
        }

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await pool.end();
    }
}

testLoadCalendarState().catch(console.error);