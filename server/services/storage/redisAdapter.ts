import redis from '../../config/redis';

function isAvailable() {
    return !!(redis && redis.status === 'ready');
}

export {
    isAvailable,
    redis as client
};

export const pipeline = () => redis.pipeline();
export const scanStream = (opts) => redis.scanStream(opts);

export default {
    isAvailable,
    client: redis,
    pipeline: () => redis.pipeline(),
    scanStream: (opts) => redis.scanStream(opts),
};
