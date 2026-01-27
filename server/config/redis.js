// Redis Configuration
const Redis = require('ioredis');

let redis = null;
let redisAvailable = false;

try {
    redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        retryStrategy: (times) => {
            if (times > 3) {
                console.warn('⚠️ Redis not available after 3 retries, running in PostgreSQL-only mode');
                redisAvailable = false;
                return null; // Stop retrying
            }
            const delay = Math.min(times * 100, 1000);
            console.log(`🔴 Redis reconnecting in ${delay}ms (attempt ${times})...`);
            return delay;
        },
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: true, // Don't connect immediately
    });

    redis.on('connect', () => {
        console.log('🔴 Redis connected');
        redisAvailable = true;
    });

    redis.on('ready', () => {
        console.log('🔴 Redis ready');
        redisAvailable = true;
    });

    redis.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.warn('⚠️ Redis connection refused - running in PostgreSQL-only mode');
        } else {
            console.error('❌ Redis error:', err.message);
        }
        redisAvailable = false;
    });

    redis.on('close', () => {
        console.log('🔴 Redis connection closed');
        redisAvailable = false;
    });

} catch (err) {
    console.warn('⚠️ Redis initialization failed:', err.message);
    redisAvailable = false;
}

// Helper to check if Redis is available
const isRedisAvailable = () => redisAvailable;

// Try to connect (non-blocking)
if (redis) {
    redis.connect().catch(() => {
        console.warn('⚠️ Redis not available, will use PostgreSQL mode');
        redisAvailable = false;
    });
}

module.exports = redis;
module.exports.isRedisAvailable = isRedisAvailable;
