/**
 * Retry Helper - Generic retry logic with exponential backoff
 * 
 * Provides a reusable retry mechanism that can be used across:
 * - Server-side operations (delivery retries, sync operations)
 * - Client-side reconnection logic
 */

export interface RetryOptions {
    /** Maximum number of retry attempts (default: 5) */
    maxAttempts?: number;
    /** Base delay in milliseconds before first retry (default: 1000) */
    baseDelayMs?: number;
    /** Multiplier for exponential backoff (default: 2) */
    backoffMultiplier?: number;
    /** Maximum delay cap in milliseconds (default: 30000) */
    maxDelayMs?: number;
    /** Optional callback when a retry is scheduled */
    onRetry?: (attempt: number, delay: number, error?: Error) => void;
    /** Optional predicate to determine if error is retryable (default: all errors) */
    isRetryable?: (error: Error) => boolean;
}

export interface RetryState {
    /** Current attempt number (0 = initial attempt, 1+ = retries) */
    attempt: number;
    /** Delay until next retry in ms (0 if no more retries) */
    nextDelayMs: number;
    /** Whether more retries are available */
    canRetry: boolean;
    /** Whether max attempts has been reached */
    maxAttemptsReached: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'isRetryable'>> = {
    maxAttempts: 5,
    baseDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000
};

/**
 * Calculate the delay for a given attempt number using exponential backoff
 */
export function calculateBackoffDelay(
    attempt: number,
    baseDelayMs: number = DEFAULT_OPTIONS.baseDelayMs,
    backoffMultiplier: number = DEFAULT_OPTIONS.backoffMultiplier,
    maxDelayMs: number = DEFAULT_OPTIONS.maxDelayMs
): number {
    const delay = Math.round(baseDelayMs * Math.pow(backoffMultiplier, attempt));
    return Math.min(delay, maxDelayMs);
}

/**
 * Get the retry state for a given attempt
 */
export function getRetryState(attempt: number, options: RetryOptions = {}): RetryState {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const canRetry = attempt < opts.maxAttempts;
    
    return {
        attempt,
        nextDelayMs: canRetry ? calculateBackoffDelay(attempt, opts.baseDelayMs, opts.backoffMultiplier, opts.maxDelayMs) : 0,
        canRetry,
        maxAttemptsReached: attempt >= opts.maxAttempts
    };
}

/**
 * Execute an async operation with automatic retry on failure
 * 
 * @param operation - Async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the operation result
 * @throws Last error if all retries are exhausted
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= opts.maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            
            // Check if error is retryable
            if (opts.isRetryable && !opts.isRetryable(lastError)) {
                throw lastError;
            }
            
            // Check if we have more retries
            if (attempt >= opts.maxAttempts) {
                break;
            }
            
            // Calculate delay and wait
            const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.backoffMultiplier, opts.maxDelayMs);
            
            // Notify about retry
            if (opts.onRetry) {
                opts.onRetry(attempt + 1, delay, lastError);
            }
            
            await sleep(delay);
        }
    }
    
    throw lastError ?? new Error('Retry failed with no error');
}

/**
 * Create a retry tracker for manual retry management (e.g., event-based reconnection)
 */
export function createRetryTracker(options: RetryOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let attempt = 0;
    
    return {
        /** Get current state */
        getState(): RetryState {
            return getRetryState(attempt, opts);
        },
        
        /** Record a failed attempt and get next delay */
        recordFailure(): RetryState {
            attempt++;
            return getRetryState(attempt - 1, opts);
        },
        
        /** Reset the tracker after a successful operation */
        reset(): void {
            attempt = 0;
        },
        
        /** Get current attempt number */
        getAttempt(): number {
            return attempt;
        }
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
