const storage = require('../../storage');
const ops = require('../operations');

jest.setTimeout(10000);

describe('resetAllPopulation storage readiness', () => {
    test('waits for storage ready before clearing when storage initially unavailable', async () => {
        // Fake pool and service
        const fakePool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        const fakeService = { broadcastUpdate: jest.fn() };

        // Spy on storage.isAvailable to be false first call, then true
        const isAvailableSpy = jest.spyOn(storage, 'isAvailable')
            .mockImplementationOnce(() => false)
            .mockImplementation(() => true);

        const delSpy = jest.spyOn(storage, 'del').mockResolvedValue(0);
        const scanStreamSpy = jest.spyOn(storage, 'scanStream').mockImplementation(async function* () { yield []; });

        // Trigger reset in background and emit 'ready' shortly after
        const resetPromise = ops.resetAllPopulation(fakePool, fakeService);
        setTimeout(() => storage.emit('ready'), 100);

        await resetPromise;

        expect(isAvailableSpy).toHaveBeenCalled();
        expect(delSpy).toHaveBeenCalled();

        // clean up spies
        isAvailableSpy.mockRestore();
        delSpy.mockRestore();
        scanStreamSpy.mockRestore();
    });
});