const redis = require('../../config/redis');

function isAvailable() {
    return !!(redis && redis.status === 'ready');
}

module.exports = {
    isAvailable,
    client: redis,
    pipeline: () => redis.pipeline(),
    scanStream: (opts) => redis.scanStream(opts),
};
