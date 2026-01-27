// BOILERPLATE TEST (copy & rename this file for real tests)
// - Purpose: show a minimal, focused test pattern using the repo's MemoryAdapter
// - Markers: keep tests small, deterministic, and independent

const MemoryAdapter = require('../storage/memoryAdapter');

describe('BOILERPLATE: simple counter using MemoryAdapter', () => {
  let storage;
  let counter;

  beforeEach(async () => {
    storage = new MemoryAdapter();
    // ensure a clean bucket
    await storage.hset('counters', 'initial', 0);

    // Example unit: a tiny module that relies on storage
    counter = {
      async increment(id) {
        await storage.hincrby('counters', id, 1);
      },
      async get(id) {
        const val = await storage.hget('counters', id);
        return val ? parseInt(val, 10) : 0;
      }
    };
  });

  test('increments a counter by 1', async () => {
    await counter.increment('x');
    const v = await counter.get('x');
    expect(v).toBe(1);
  });

  test('increments multiple times', async () => {
    await counter.increment('x');
    await counter.increment('x');
    expect(await counter.get('x')).toBe(2);
  });

});
