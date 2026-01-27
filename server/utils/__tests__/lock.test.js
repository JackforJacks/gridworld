jest.mock('../../services/storage', () => {
    const MemoryAdapter = require('../../services/storage/memoryAdapter');
    const inst = new MemoryAdapter();
    return { getAdapter: () => inst };
});

const { acquireLock, releaseLock } = require('../lock');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('lock (memory adapter fallback)', () => {
    test('acquire and release succesful', async () => {
        const key = 'test:lock:1';
        const token = await acquireLock(key, 500, 200, 10);
        expect(token).toBeTruthy();
        const released = await releaseLock(key, token);
        expect(released).toBe(true);
    });

    test('concurrent acquire is blocked', async () => {
        const key = 'test:lock:2';
        const token1 = await acquireLock(key, 500, 200, 10);
        expect(token1).toBeTruthy();

        const token2 = await acquireLock(key, 500, 200, 10);
        expect(token2).toBeNull();

        await releaseLock(key, token1);
    });

    test('lock expires and allows reacquire', async () => {
        const key = 'test:lock:3';
        const t1 = await acquireLock(key, 50, 200, 10);
        expect(t1).toBeTruthy();
        await sleep(80);
        const t2 = await acquireLock(key, 500, 200, 10);
        expect(t2).toBeTruthy();
        await releaseLock(key, t2);
    });
});