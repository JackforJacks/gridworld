import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const calendarConfig = {
    daysPerMonth: parseInt(process.env.CALENDAR_DAYS_PER_MONTH || '8', 10),
    monthsPerYear: parseInt(process.env.CALENDAR_MONTHS_PER_YEAR || '12', 10),
    startYear: parseInt(process.env.CALENDAR_START_YEAR || '1', 10),
    startMonth: parseInt(process.env.CALENDAR_START_MONTH || '1', 10),
    startDay: parseInt(process.env.CALENDAR_START_DAY || '1', 10),
    autoStart: process.env.CALENDAR_AUTO_START !== 'false',
    defaultSpeed: (process.env.CALENDAR_DEFAULT_SPEED || '1_day'),
    // CALENDAR_TICK_INTERVAL_MS is used directly in CalendarService as realTimeTickMs
    // and is part of its internal config, not directly from this file.
};

export default calendarConfig;
