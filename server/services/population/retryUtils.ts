// Retry Utility - Centralized retry logic with exponential backoff
import storage from '../storage';
import serverConfig from '../../config/server';

export interface RetryConfig {
    /** Base delay in milliseconds before first retry */
    baseDelayMs: number;
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Multiplier for exponential backoff (e.g., 2 = double each time) */
    backoffMultiplier: number;
    /** Redis key prefix for tracking attempts (e.g., 'pending:delivery:attempts') */
    attemptsKey: string;
    /** Redis sorted set key for scheduling retries (e.g., 'pending:deliveries:retry') */
    retryQueueKey: string;
    /** Stats key for retry count (optional) */
    retryStatsKey?: string;
    /** Stats key for permanent failures (optional) */
    failureStatsKey?: string;
}

export interface RetryResult {
    /** Whether the item should be retried later */
    shouldRetry: boolean;
    /** Current attempt number */
    attemptNumber: number;
    /** Delay until next retry (0 if no retry) */
    nextDelayMs: number;
    /** Whether max attempts was reached */
    maxAttemptsReached: boolean;
}

/**
 * Schedules an item for retry with exponential backoff
 * Returns retry status information
 */
export async function scheduleRetry(
    itemId: string | number,
    config: RetryConfig
): Promise<RetryResult> {
    const id = String(itemId);

    try {
        // Increment attempt counter
        const attempts = await storage.hincrby(config.attemptsKey, id, 1);

        if (attempts <= config.maxAttempts) {
            // Calculate delay with exponential backoff
            const delay = Math.round(
                config.baseDelayMs * Math.pow(config.backoffMultiplier, attempts - 1)
            );

            // Schedule retry
            await storage.zadd(config.retryQueueKey, Date.now() + delay, id);

            // Track retry stats
            if (config.retryStatsKey) {
                try {
                    await storage.incr(config.retryStatsKey);
                } catch {
                    // Ignore stats errors
                }
            }

            return {
                shouldRetry: true,
                attemptNumber: attempts,
                nextDelayMs: delay,
                maxAttemptsReached: false
            };
        } else {
            // Max attempts reached
            if (config.failureStatsKey) {
                try {
                    await storage.incr(config.failureStatsKey);
                } catch {
                    // Ignore stats errors
                }
            }

            return {
                shouldRetry: false,
                attemptNumber: attempts,
                nextDelayMs: 0,
                maxAttemptsReached: true
            };
        }
    } catch (error) {
        // On error, don't retry (fail-safe)
        console.warn('[scheduleRetry] Failed to schedule retry:', error);
        return {
            shouldRetry: false,
            attemptNumber: 0,
            nextDelayMs: 0,
            maxAttemptsReached: false
        };
    }
}

/**
 * Clears retry tracking for an item after successful processing
 */
export async function clearRetryTracking(
    itemId: string | number,
    config: Pick<RetryConfig, 'attemptsKey' | 'retryQueueKey'>
): Promise<void> {
    const id = String(itemId);
    try {
        await storage.hdel(config.attemptsKey, id);
        await storage.zrem(config.retryQueueKey, id);
    } catch (error) {
        console.warn('[clearRetryTracking] Failed to clear tracking:', error);
    }
}

/**
 * Gets items due for retry from a retry queue
 * Removes them from the queue atomically
 */
export async function popDueRetries(
    retryQueueKey: string,
    now: number = Date.now()
): Promise<number[]> {
    try {
        const due = await storage.zrangebyscore(retryQueueKey, 0, now);
        if (!due || due.length === 0) {
            return [];
        }

        // Remove from queue
        for (const id of due) {
            try {
                await storage.zrem(retryQueueKey, id);
            } catch {
                // Continue even if one fails
            }
        }

        return due.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    } catch {
        return [];
    }
}

/**
 * Default retry configuration for delivery operations
 */
export function getDeliveryRetryConfig(): RetryConfig {
    return {
        baseDelayMs: serverConfig.deliveryRetryDelayMs ?? 5000,
        maxAttempts: serverConfig.deliveryRetryMaxAttempts ?? 5,
        backoffMultiplier: serverConfig.deliveryRetryBackoffMultiplier ?? 2,
        attemptsKey: 'pending:delivery:attempts',
        retryQueueKey: 'pending:deliveries:retry',
        retryStatsKey: 'stats:deliveries:retries',
        failureStatsKey: 'stats:deliveries:permanent_failures'
    };
}
