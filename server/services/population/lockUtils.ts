// Lock Utilities - Centralized lock management with automatic release
import storage from '../storage';
import * as deps from './dependencyContainer';
import { safeExecute, ErrorSeverity } from '../../utils/errorHandler';

export interface LockConfig {
    /** Lock key in Redis */
    key: string;
    /** Time-to-live for the lock in milliseconds */
    ttlMs: number;
    /** How long to wait to acquire the lock (0 = immediate fail) */
    acquireTimeoutMs: number;
    /** Delay between acquisition retries */
    retryDelayMs: number;
    /** Stats key to increment on contention (optional) */
    contentionStatsKey?: string;
}

export interface LockResult<T> {
    /** Whether the lock was acquired */
    acquired: boolean;
    /** Result of the operation if lock was acquired and operation succeeded */
    result?: T;
    /** Error if operation failed */
    error?: Error;
}

/**
 * Attempts to get the current lock holder for debugging
 */
async function getLockHolder(lockKey: string): Promise<string> {
    try {
        const adapter: any = storage.getAdapter ? storage.getAdapter() : storage;
        if (adapter?.client?.get) {
            const holder = await adapter.client.get(lockKey);
            return holder || 'unknown';
        }
    } catch {
        // Ignore
    }
    return 'unknown';
}

/**
 * Executes an operation with an exclusive lock
 * Automatically acquires and releases the lock
 * 
 * @param config - Lock configuration
 * @param operation - Async function to execute while holding the lock
 * @returns LockResult with the operation result or error
 */
export async function withLock<T>(
    config: LockConfig,
    operation: () => Promise<T>
): Promise<LockResult<T>> {
    const { acquireLock, releaseLock } = deps.getLock();
    let lockToken: string | null = null;

    try {
        // Try to acquire the lock
        lockToken = await acquireLock(
            config.key,
            config.ttlMs,
            config.acquireTimeoutMs,
            config.retryDelayMs
        );

        if (!lockToken) {
            // Track contention silently - only increment stats
            if (config.contentionStatsKey) {
                await safeExecute(
                    () => storage.incr(config.contentionStatsKey!),
                    'LockUtils:Contention',
                    null,
                    ErrorSeverity.LOW
                );
            }

            // Don't log every contention - it's expected with concurrent operations
            return { acquired: false };
        }

        // Execute the operation
        const result = await operation();
        return { acquired: true, result };

    } catch (error) {
        return { acquired: true, error: error as Error };
    } finally {
        // Always release the lock if acquired
        if (lockToken) {
            try {
                await releaseLock(config.key, lockToken);
            } catch (e) {
                console.warn(`[withLock] Failed to release lock ${config.key}:`, e);
            }
        }
    }
}

/**
 * Creates a lock config for a family operation
 */
export function familyLockConfig(familyId: number, options?: Partial<LockConfig>): LockConfig {
    return {
        key: `lock:family:${familyId}`,
        ttlMs: options?.ttlMs ?? 10000,
        acquireTimeoutMs: options?.acquireTimeoutMs ?? 5000,
        retryDelayMs: options?.retryDelayMs ?? 100,
        contentionStatsKey: options?.contentionStatsKey
    };
}

/**
 * Creates a lock config for a couple (used during family creation)
 */
export function coupleLockConfig(person1Id: number, person2Id: number, options?: Partial<LockConfig>): LockConfig {
    // Sort IDs to ensure consistent lock key regardless of argument order
    const sortedIds = [person1Id, person2Id].sort((a, b) => a - b);
    return {
        key: `lock:couple:${sortedIds[0]}:${sortedIds[1]}`,
        ttlMs: options?.ttlMs ?? 3000,
        acquireTimeoutMs: options?.acquireTimeoutMs ?? 1500,
        retryDelayMs: options?.retryDelayMs ?? 40,
        contentionStatsKey: options?.contentionStatsKey ?? 'stats:matchmaking:contention'
    };
}

/**
 * Wrapper that handles lock contention with optional retry scheduling
 * Returns null if lock couldn't be acquired (caller should handle retry logic)
 */
export async function withFamilyLock<T>(
    familyId: number,
    operation: () => Promise<T>,
    options?: Partial<LockConfig>
): Promise<T | null> {
    const config = familyLockConfig(familyId, options);
    const result = await withLock(config, operation);

    if (!result.acquired) {
        return null;
    }

    if (result.error) {
        throw result.error;
    }

    return result.result as T;
}

/**
 * Creates a lock config for sync operations
 */
export function syncLockConfig(options?: Partial<LockConfig>): LockConfig {
    return {
        key: options?.key ?? 'population:sync:lock',
        ttlMs: options?.ttlMs ?? 30000,
        acquireTimeoutMs: options?.acquireTimeoutMs ?? 5000,
        retryDelayMs: options?.retryDelayMs ?? 100,
        contentionStatsKey: options?.contentionStatsKey
    };
}

/**
 * Wrapper for sync operations that require exclusive lock
 * Returns a result object with skipped=true if lock couldn't be acquired
 */
export async function withSyncLock<T>(
    operation: () => Promise<T>,
    options?: Partial<LockConfig>
): Promise<{ skipped: true; reason: string } | T> {
    const config = syncLockConfig(options);
    const result = await withLock(config, operation);

    if (!result.acquired) {
        return { skipped: true, reason: 'could not acquire sync lock' };
    }

    if (result.error) {
        throw result.error;
    }

    return result.result as T;
}
