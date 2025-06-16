const calendarService = require('./server/services/calendarService.js');

async function checkCalendarDate() {
    try {
        console.log('Calendar state:', calendarService.getState());
        console.log('Current date:', calendarService.getCurrentDate());
    } catch (error) {
        console.error('Error:', error);
    }
    process.exit(0);
}

checkCalendarDate();
