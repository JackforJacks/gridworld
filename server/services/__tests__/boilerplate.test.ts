// BOILERPLATE TEST (copy & rename this file for real tests)
// - Purpose: show a minimal, focused test pattern
// - Markers: keep tests small, deterministic, and independent
// - Storage removed - all data in Rust ECS

describe('BOILERPLATE: simple counter test', () => {
  let counter: { increment: (id: string) => void; get: (id: string) => number };

  beforeEach(() => {
    // Storage removed - all data in Rust ECS
    const counters = new Map<string, number>();

    // Example unit: a tiny module
    counter = {
      increment(id) {
        counters.set(id, (counters.get(id) || 0) + 1);
      },
      get(id) {
        return counters.get(id) || 0;
      }
    };
  });

  test('increments a counter by 1', () => {
    counter.increment('x');
    const v = counter.get('x');
    expect(v).toBe(1);
  });

  test('increments multiple times', () => {
    counter.increment('x');
    counter.increment('x');
    expect(counter.get('x')).toBe(2);
  });

});
