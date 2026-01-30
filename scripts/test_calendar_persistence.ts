// Test script to verify calendar state persistence behavior
const CalendarService = require('../server/services/calendarService');
const StateManager = require('../server/services/stateManager');
const { Pool } = require('pg');

async function testCalendarPersistence() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🧪 Testing calendar persistence behavior...\n');

        // Create a calendar service
        const calendarService = new CalendarService();
        await calendarService.initialize();

        // Set the calendar service in StateManager
        StateManager.setCalendarService(calendarService);

        // Set a specific date
        const testDate = { year: 4000, month: 1, day: 1 };
        calendarService.setDate(testDate.day, testDate.month, testDate.year);
        console.log(`📅 Set calendar to: Year ${testDate.year}, Month ${testDate.month}, Day ${testDate.day}`);

        // Start the calendar
        calendarService.start();
        console.log('▶️ Started calendar');

        // Wait a few seconds to let ticks happen (but they shouldn't save automatically)
        console.log('⏳ Waiting 3 seconds for ticks...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Check database state - it should still be the original date since ticks don't save
        const { getCalendarState } = require('../server/models/calendarState');
        const dbStateAfterTicks = await getCalendarState();
        console.log(`📅 Database state after ticks: Year ${dbStateAfterTicks.current_year}, Month ${dbStateAfterTicks.current_month}, Day ${dbStateAfterTicks.current_day}`);

        // The database should still have the original date (from setDate), not the advanced date
        const currentCalendarDate = calendarService.currentDate;
        console.log(`📅 Calendar current date: Year ${currentCalendarDate.year}, Month ${currentCalendarDate.month}, Day ${currentCalendarDate.day}`);

        // Verify that the calendar has advanced (should be past day 1)
        if (currentCalendarDate.day > testDate.day || currentCalendarDate.month > testDate.month || currentCalendarDate.year > testDate.year) {
            console.log('✅ Calendar has advanced during ticks');
        } else {
            console.log('❌ Calendar has not advanced during ticks');
        }

        // Now perform an explicit save
        console.log('\n💾 Performing explicit save...');
        const saveResult = await StateManager.saveToDatabase({
            calendarService: calendarService,
            io: null
        });
        console.log('💾 Save completed:', saveResult);

        // Check database state after save
        const dbStateAfterSave = await getCalendarState();
        console.log(`📅 Database state after save: Year ${dbStateAfterSave.current_year}, Month ${dbStateAfterSave.current_month}, Day ${dbStateAfterSave.current_day}`);

        // The database should now have the current calendar date
        if (dbStateAfterSave.current_year === currentCalendarDate.year &&
            dbStateAfterSave.current_month === currentCalendarDate.month &&
            dbStateAfterSave.current_day === currentCalendarDate.day) {
            console.log('✅ Calendar state correctly saved during explicit save operation');
        } else {
            console.log(`❌ Calendar state not saved correctly. Expected ${currentCalendarDate.year}/${currentCalendarDate.month}/${currentCalendarDate.day}, got ${dbStateAfterSave.current_year}/${dbStateAfterSave.current_month}/${dbStateAfterSave.current_day}`);
        }

        // Stop the calendar
        calendarService.stop();
        console.log('⏹️ Stopped calendar');

        console.log('\n🎉 Calendar persistence test completed!');

    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        await pool.end();
    }
}

testCalendarPersistence().catch(console.error);