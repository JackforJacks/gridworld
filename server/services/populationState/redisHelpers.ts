/**
 * Shared storage helpers for population state modules
 * Storage removed - all data in Rust ECS
 */

/**
 * Check if Redis (or storage) is available
 * Storage removed - all data in Rust ECS
 */
function isRedisAvailable() {
    return false;
}

/**
 * Get the Redis-like client (or adapter).
 * Storage removed - all data in Rust ECS
 */
function getRedis() {
    return null;
}

export {
    isRedisAvailable,
    getRedis
};
