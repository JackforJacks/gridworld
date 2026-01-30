// Redis Configuration - Direct ioredis client (Redis-first architecture)
const Redis = require('ioredis');

// In test mode, use a mock or skip connection
const isTest = process.env.NODE_ENV === 'test';

const redis = isTest ? null : new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    retryStrategy: (times) => {
        if (times > 10) {
            console.error('❌ Redis not available after 10 retries, exiting');
            process.exit(1); // Fail fast - Redis is required
        }
        const delay = Math.min(times * 200, 2000);
        console.log(`🔴 Redis reconnecting in ${delay}ms (attempt ${times})...`);
        return delay;
    },
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    lazyConnect: false, // Connect immediately
});

// Track ready state
let isReady = false;
let readyResolve = null;
const readyPromise = new Promise(resolve => { readyResolve = resolve; });

if (redis) {
    redis.on('connect', () => {
        console.log('🔴 Redis connected');
    });

    redis.on('ready', () => {
        console.log('🔴 Redis ready');
        isReady = true;
        if (readyResolve) {
            readyResolve();
            readyResolve = null;
        }
    });

    redis.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.error('❌ Redis connection refused - Redis is REQUIRED for this application');
        } else {
            console.error('❌ Redis error:', err.message);
        }
        isReady = false;
    });

    redis.on('close', () => {
        console.log('🔴 Redis connection closed');
        isReady = false;
    });
}

// Export client with helper methods
const client = redis || {};
client.isReady = () => isReady;
client.waitForReady = () => isTest ? Promise.resolve() : readyPromise;

module.exports = client;
