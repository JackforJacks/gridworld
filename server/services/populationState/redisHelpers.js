/**
 * Shared Redis helpers for population state modules
 */

const redis = require('../../config/redis');
const pool = require('../../config/database');

/**
 * Check if Redis is available
 */
function isRedisAvailable() {
    return redis && redis.status === 'ready';
}

/**
 * Get the Redis client
 */
function getRedis() {
    return redis;
}

/**
 * Get the Postgres pool
 */
function getPool() {
    return pool;
}

module.exports = {
    isRedisAvailable,
    getRedis,
    getPool
};
