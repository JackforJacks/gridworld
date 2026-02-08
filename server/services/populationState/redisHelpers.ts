/**
 * Shared storage helpers for population state modules
 */

import storage from '../storage';

/**
 * Check if Redis (or storage) is available
 */
function isRedisAvailable() {
    return storage && typeof storage.isAvailable === 'function' ? storage.isAvailable() : false;
}

/**
 * Get the Redis-like client (or adapter). For Redis this will be the Redis client,
 * for in-memory adapter we return the adapter itself which exposes the subset of
 * methods used by the codebase.
 */
function getRedis() {
    const adapter = storage.getAdapter ? storage.getAdapter() : storage;
    return adapter.client || adapter;
}

export {
    isRedisAvailable,
    getRedis
};
