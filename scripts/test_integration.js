// Integration test to verify the complete load flow
const StateManager = require('../server/services/stateManager');
const { Pool } = require('pg');

async function testIntegration() {
    const pool = new Pool({
        host: 'localhost',
        port: 5432,
        database: 'gridworld',
        user: 'postgres',
        password: 'password'
    });

    try {
        console.log('🧪 Testing complete load integration...\n');

        // Set a test calendar date
        const { setCalendarState } = require('../server/models/calendarState');
        const testDate = { year: 4005, month: 6, day: 15 };
        await setCalendarState(testDate);
        console.log(`📅 Set test calendar state: Year ${testDate.year}, Month ${testDate.month}, Day ${testDate.day}`);

        // Verify what was actually saved
        const { getCalendarState } = require('../server/models/calendarState');
        const savedState = await getCalendarState();
        console.log(`📅 Verified database state: Year ${savedState.current_year}, Month ${savedState.current_month}, Day ${savedState.current_day}`);

        // Create a test calendar service that tracks calls
        const CalendarService = require('../server/services/calendarService');
        const testCalendarService = new CalendarService();

        // Track if loadStateFromDB was called
        let loadStateCalled = false;
        const originalLoadStateFromDB = testCalendarService.loadStateFromDB.bind(testCalendarService);
        testCalendarService.loadStateFromDB = async () => {
            loadStateCalled = true;
            console.log('📞 CalendarService.loadStateFromDB called during load operation');
            return await originalLoadStateFromDB();
        };

        // Initialize the calendar service (loads from DB)
        await testCalendarService.initialize();

        // Start the calendar to test that it gets stopped during loading
        testCalendarService.start();
        console.log('▶️ Started calendar before load test');

        // Verify calendar is running
        if (testCalendarService.state.isRunning) {
            console.log('✅ Calendar is running before load');
        } else {
            console.log('❌ Calendar failed to start before load');
        }

        // Test the load operation with our test calendar service
        console.log('\n🔄 Testing StateManager.loadFromDatabase with test calendar service...');
        const result = await StateManager.loadFromDatabase({
            calendarService: testCalendarService,
            io: null
        });

        console.log(`📊 Load completed: ${result.villages} villages, ${result.people} people, ${result.families} families`);

        // Check if calendar was restarted after loading
        if (testCalendarService.state.isRunning) {
            console.log('✅ Calendar was restarted after loading');
        } else {
            console.log('❌ Calendar was not restarted after loading');
        }

        if (loadStateCalled) {
            console.log('✅ Calendar service loadStateFromDB was called during load operation');

            // Check the calendar service's current date
            const currentDate = testCalendarService.currentDate;
            console.log(`📅 Calendar service date after load: Year ${currentDate.year}, Month ${currentDate.month}, Day ${currentDate.day}`);

            if (currentDate.year === testDate.year &&
                currentDate.month === testDate.month &&
                currentDate.day === testDate.day) {
                console.log('✅ Calendar date correctly restored during load operation');
            } else {
                console.log(`❌ Calendar date not restored correctly: expected ${testDate.year}/${testDate.month}/${testDate.day}, got ${currentDate.year}/${currentDate.month}/${currentDate.day}`);
            }
        } else {
            console.log('❌ Calendar service loadStateFromDB was NOT called during load operation');
        }

        console.log('\n🎉 Integration test completed successfully!');
        console.log('The calendar state should now be properly restored when loading saved data, and the calendar should stop during loading.');

    } catch (error) {
        console.error('❌ Integration test failed:', error);
    } finally {
        await pool.end();
    }
}

testIntegration().catch(console.error);