// Simple smoke-test script for memory adapter
(async () => {
    const storage = require('./index');
    const adapter = storage.getAdapter();
    console.log('Adapter type:', adapter.constructor ? adapter.constructor.name : 'redis');

    if (!adapter) {
        console.error('No adapter available');
        process.exit(2);
    }

    // hset/hgetall
    await adapter.hset('testhash', 'a', '1');
    await adapter.hset('testhash', 'b', '2');

    const all = await adapter.hgetall('testhash');
    console.log('hgetall testhash =>', all);

    // pipeline
    const pipeline = adapter.pipeline();
    pipeline.hset('testhash', 'c', '3');
    pipeline.set('key1', 'value1');
    const res = await pipeline.exec();
    console.log('pipeline exec =>', res);

    const val = await adapter.hget('testhash', 'c');
    console.log('hget testhash:c =>', val);

    // scanStream
    console.log('scanStream keys matching test*');
    const stream = adapter.scanStream({ match: 'test*', count: 2 });
    for await (const chunk of stream) {
        console.log('chunk:', chunk);
    }

    console.log('Smoke test complete');
})();