// Retry Utility - Centralized retry logic with exponential backoff
// Storage removed - all data in Rust ECS
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
    // Storage removed - all data in Rust ECS
    console.warn('[scheduleRetry] Storage removed - retry logic deprecated');
    return {
        shouldRetry: false,
        attemptNumber: 0,
        nextDelayMs: 0,
        maxAttemptsReached: false
    };
}

/**
 * Clears retry tracking for an item after successful processing
 * Storage removed - all data in Rust ECS
 */
export async function clearRetryTracking(
    itemId: string | number,
    config: Pick<RetryConfig, 'attemptsKey' | 'retryQueueKey'>
): Promise<void> {
    // Storage removed - all data in Rust ECS
}

/**
 * Gets items due for retry from a retry queue
 * Storage removed - all data in Rust ECS
 */
export async function popDueRetries(
    retryQueueKey: string,
    now: number = Date.now()
): Promise<number[]> {
    // Storage removed - all data in Rust ECS
    return [];
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
