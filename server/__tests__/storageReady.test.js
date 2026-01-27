// Test: storage ready event triggers StateManager.loadFromDatabase (initial + reconnect)

jest.useRealTimers();

// Reset modules to allow clean mocks
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('StateManager.loadFromDatabase is called on init and on storage ready event', async () => {
  // Mock storage to avoid actual Redis client and side-effects
  jest.mock('../services/storage', () => {
    const EventEmitter = require('events');
    const ee = new EventEmitter();
    return {
      isAvailable: () => false,
      on: (evt, cb) => ee.on(evt, cb),
      emit: (evt, ...args) => ee.emit(evt, ...args),
      getAdapter: () => null,
      pipeline: () => ({ exec: async () => [] }),
      hset: async () => 1,
      sadd: async () => 1,
      smembers: async () => [],
      incr: async () => 0,
    };
  });

  // Prevent config/redis from creating a real client during tests
  jest.mock('../config/redis', () => ({ on: () => {} }));

  // Mock dependent services to keep initialization lightweight
  jest.mock('../services/calendarService', () => {
    return function MockCalendar() {
      this.initialize = async () => {};
      this.getCurrentDate = () => ({ year: 1, month: 1, day: 1 });
      this.on = () => {};
    };
  });

  jest.mock('../services/statisticsService', () => {
    return function MockStats() {
      this.initialize = () => {};
      this.shutdown = () => {};
    };
  });

  jest.mock('../services/populationService', () => {
    return function MockPopulation() {
      this.initialize = async () => {};
      this.shutdown = async () => {};
      this.getAllPopulationData = async () => [];
    };
  });

  jest.mock('../services/villageSeeder', () => ({ seedIfNoVillages: async () => ({ created: 0 }) }));

  // Mock StateManager so we can assert calls
  const mockLoad = jest.fn(async () => {});
  jest.mock('../services/stateManager', () => ({
    setIo: jest.fn(),
    setCalendarService: jest.fn(),
    loadFromDatabase: mockLoad,
    isInitialized: jest.fn(() => true),
  }));

  const GridWorldServer = require('../index');
  const storage = require('../services/storage');
  const StateManager = require('../services/stateManager');

  const server = new GridWorldServer();

  // Initialize singletons (this should call StateManager.loadFromDatabase once)
  await server.initializeSingletonServices();
  expect(StateManager.loadFromDatabase).toHaveBeenCalledTimes(1);

  // Simulate storage 'ready' event
  StateManager.loadFromDatabase.mockClear();
  storage.emit('ready');

  // Allow any async handlers to run
  await new Promise(r => setTimeout(r, 20));

  expect(StateManager.loadFromDatabase).toHaveBeenCalledTimes(1);

  // Shutdown server to ensure we don't leave open handles
  await server.shutdown();
});