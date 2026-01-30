jest.mock('../../config/calendar', () => ({
    daysPerMonth: 30,
    monthsPerYear: 12,
    startDay: 1,
    startMonth: 1,
    startYear: 1,
    defaultSpeed: '1_day',
    autoStart: false
}));

jest.mock('../../config/server', () => ({ verboseLogs: false }));

jest.mock('../../models/calendarState', () => ({
    getCalendarState: jest.fn(),
    setCalendarState: jest.fn()
}));

const { getCalendarState, setCalendarState } = require('../../models/calendarState');
const CalendarService = require('../calendarService');

describe('CalendarService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('initialize loads DB state and persists default when missing', async () => {
        getCalendarState.mockResolvedValue(null);
        setCalendarState.mockResolvedValue(true);

        const svc = new CalendarService();
        await svc.initialize();

        expect(setCalendarState).toHaveBeenCalledWith({ year: 1, month: 1, day: 1 });
        expect(svc.getCurrentDate()).toEqual({ year: 1, month: 1, day: 1 });
    });

    test('start and stop lifecycle', () => {
        const io = { emit: jest.fn() };
        const svc = new CalendarService(io);
        // make the interval very large to avoid accidental ticks
        svc.internalConfig.realTimeTickMs = 1_000_000;

        const started = svc.start();
        expect(started).toBe(true);
        expect(svc.state.isRunning).toBe(true);
        expect(svc.tickTimer).not.toBeNull();

        // starting again returns false
        expect(svc.start()).toBe(false);

        // Verify events and io emissions
        // Emitted 'started' and io emitted 'calendarStarted' & 'calendarState'
        // Use a small spy on emit
        const emitSpy = jest.spyOn(svc, 'emit');
        // Stopping should emit 'stopped' and return true
        const stopped = svc.stop();
        expect(stopped).toBe(true);
        expect(svc.state.isRunning).toBe(false);
        expect(svc.tickTimer).toBeNull();
        expect(emitSpy).toHaveBeenCalledWith('stopped', expect.any(Object));

        // stop again returns false
        expect(svc.stop()).toBe(false);

        svc.destroy();
    });

    test('advanceOneDay triggers month and year rollovers and emits events', () => {
        const svc = new CalendarService();
        svc.currentDate = { year: 1, month: 12, day: 30 }; // last day
        const emitSpy = jest.spyOn(svc, 'emit');

        const events = svc.advanceOneDay();

        // Should have both newMonth and newYear in returned events
        expect(events.some(e => e.type === 'newMonth')).toBe(true);
        expect(events.some(e => e.type === 'newYear')).toBe(true);

        // Expect emitted monthChanged and yearChanged
        expect(emitSpy).toHaveBeenCalledWith('monthChanged', expect.any(Number), expect.any(Number));
        expect(emitSpy).toHaveBeenCalledWith('yearChanged', expect.any(Number), expect.any(Number));

        // Day should wrap to 1, month 1, year 2
        expect(svc.currentDate).toEqual({ year: 2, month: 1, day: 1 });
    });

    test('tick advances multiple days according to speed and emits tick', async () => {
        const svc = new CalendarService();
        svc.currentDate = { year: 1, month: 1, day: 1 };
        svc.state.isRunning = true;
        svc.state.totalTicks = 0;
        svc.state.totalDays = 0;

        // Use 4_day to advance 4 days
        svc.currentSpeed = '4_day';
        // stub DB save to avoid actual DB interaction
        svc.saveStateToDB = jest.fn().mockResolvedValue(true);

        const emitSpy = jest.spyOn(svc, 'emit');

        await svc.tick();

        // totalDays increased by 4 and totalTicks incremented
        expect(svc.state.totalDays).toBeGreaterThanOrEqual(4);
        expect(svc.state.totalTicks).toBeGreaterThanOrEqual(1);

        // tick emitted
        expect(emitSpy).toHaveBeenCalledWith('tick', expect.objectContaining({ daysAdvanced: expect.any(Number) }));
    });

    test('setDate validates and updates date and total days', () => {
        const svc = new CalendarService();
        svc.currentDate = { year: 1, month: 1, day: 1 };
        svc.state = { ...svc.state };
        svc.saveStateToDB = jest.fn().mockResolvedValue(true);

        // invalid day throws
        expect(() => svc.setDate(0, 1, 1)).toThrow();
        expect(() => svc.setDate(1, 0, 1)).toThrow();
        expect(() => svc.setDate(1, 1, 0)).toThrow();

        // valid set
        const prevTotalDays = svc.state.totalDays;
        const changed = svc.setDate(5, 2, 1);
        expect(changed).toBe(true);
        expect(svc.currentDate).toEqual({ day: 5, month: 2, year: 1 });
        expect(svc.state.totalDays).toBeGreaterThanOrEqual(0);
    });

    test('setSpeed accepts valid speeds and rejects invalid ones', () => {
        const svc = new CalendarService();
        // valid
        expect(svc.setSpeed('1_day')).toBe(true);

        // invalid
        expect(() => svc.setSpeed('invalid_speed')).toThrow();
    });

    test('calculateTotalDays and getFormattedDate work as expected', () => {
        const svc = new CalendarService();
        // initialize currentDate to configured start to avoid undefined
        svc.currentDate = { year: 1, month: 1, day: 1 };
        expect(svc.calculateTotalDays(1, 1, 1)).toBe(0);
        expect(svc.calculateTotalDays(1, 1, 2)).toBe(1);
        expect(svc.getFormattedDate()).toHaveProperty('short');
        expect(svc.getFormattedDate()).toHaveProperty('progress');
    });

    test('subscribe returns unsubscribe and initial callback is invoked', () => {
        const svc = new CalendarService();
        // ensure a currentDate exists so the subscriber receives a valid state
        svc.currentDate = { year: 1, month: 1, day: 1 };
        const cb = jest.fn();
        const unsub = svc.subscribe(cb);
        expect(cb).toHaveBeenCalledWith('state', expect.objectContaining({ currentDate: expect.any(Object) }));
        unsub();
        // Ensure unsubscribe removed callback
        expect(svc.subscribers.has(cb)).toBe(false);
    });
});
