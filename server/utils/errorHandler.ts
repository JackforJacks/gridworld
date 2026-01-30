/**
 * Centralized Error Handling Utility
 * Provides consistent error handling across the application
 */

/**
 * Error severity levels
 */
const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
} as const;

type ErrorSeverityType = typeof ErrorSeverity[keyof typeof ErrorSeverity];

/**
 * Interface for errors with additional metadata
 */
interface ErrorWithMeta extends Error {
    originalError?: Error | null;
    timestamp?: string;
    field?: string | null;
    state?: unknown;
    lockKey?: string | null;
}

/**
 * Error log entry structure
 */
interface ErrorLogEntry {
    timestamp: string;
    context: string;
    severity: ErrorSeverityType;
    name: string;
    message: string;
    stack?: string;
    originalError?: {
        name: string;
        message: string;
        stack?: string;
    };
    [key: string]: unknown;
}

/**
 * Options for withErrorHandling function
 */
interface ErrorHandlingOptions<T> {
    onError?: ((error: Error) => void | Promise<void>) | null;
    fallback?: T | null;
    severity?: ErrorSeverityType;
    rethrow?: boolean;
}

/**
 * Custom Error Classes
 */
class DatabaseError extends Error {
    public readonly originalError: Error | null;
    public readonly timestamp: string;

    constructor(message: string, originalError: Error | null = null) {
        super(message);
        this.name = 'DatabaseError';
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class RedisError extends Error {
    public readonly originalError: Error | null;
    public readonly timestamp: string;

    constructor(message: string, originalError: Error | null = null) {
        super(message);
        this.name = 'RedisError';
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class ValidationError extends Error {
    public readonly field: string | null;
    public readonly timestamp: string;

    constructor(message: string, field: string | null = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.timestamp = new Date().toISOString();
    }
}

class StateError extends Error {
    public readonly state: unknown;
    public readonly timestamp: string;

    constructor(message: string, state: unknown = null) {
        super(message);
        this.name = 'StateError';
        this.state = state;
        this.timestamp = new Date().toISOString();
    }
}

class LockError extends Error {
    public readonly lockKey: string | null;
    public readonly timestamp: string;

    constructor(message: string, lockKey: string | null = null) {
        super(message);
        this.name = 'LockError';
        this.lockKey = lockKey;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Log error with context
 */
function logError(
    error: ErrorWithMeta,
    context: string = 'Unknown',
    severity: ErrorSeverityType = ErrorSeverity.MEDIUM,
    metadata: Record<string, unknown> = {}
): ErrorLogEntry {
    const errorLog: ErrorLogEntry = {
        timestamp: new Date().toISOString(),
        context,
        severity,
        name: error.name || 'Error',
        message: error.message,
        stack: error.stack,
        ...metadata
    };

    // Add original error if available
    if (error.originalError) {
        errorLog.originalError = {
            name: error.originalError.name,
            message: error.originalError.message,
            stack: error.originalError.stack
        };
    }

    // Log based on severity
    switch (severity) {
        case ErrorSeverity.CRITICAL:
            console.error(`🔴 [CRITICAL ERROR] ${context}:`, errorLog);
            break;
        case ErrorSeverity.HIGH:
            console.error(`❌ [ERROR] ${context}:`, errorLog);
            break;
        case ErrorSeverity.MEDIUM:
            console.warn(`⚠️  [WARNING] ${context}:`, errorLog);
            break;
        case ErrorSeverity.LOW:
            console.log(`ℹ️  [INFO] ${context}:`, errorLog);
            break;
        default:
            console.warn(`⚠️  [WARNING] ${context}:`, errorLog);
    }

    return errorLog;
}

/**
 * Safe execution wrapper - executes function and logs errors
 */
async function safeExecute<T>(
    fn: () => Promise<T>,
    context: string,
    fallbackValue: T | null = null,
    severity: ErrorSeverityType = ErrorSeverity.MEDIUM
): Promise<T | null> {
    try {
        return await fn();
    } catch (error: unknown) {
        logError(error as ErrorWithMeta, context, severity);
        return fallbackValue;
    }
}

/**
 * Safe execution wrapper (sync version)
 */
function safeExecuteSync<T>(
    fn: () => T,
    context: string,
    fallbackValue: T | null = null,
    severity: ErrorSeverityType = ErrorSeverity.MEDIUM
): T | null {
    try {
        return fn();
    } catch (error: unknown) {
        logError(error as ErrorWithMeta, context, severity);
        return fallbackValue;
    }
}

/**
 * Wrap async operation with error handling
 */
async function withErrorHandling<T>(
    operation: () => Promise<T>,
    context: string,
    options: ErrorHandlingOptions<T> = {}
): Promise<T | null> {
    const {
        onError = null,
        fallback = null,
        severity = ErrorSeverity.MEDIUM,
        rethrow = false
    } = options;

    try {
        return await operation();
    } catch (error: unknown) {
        logError(error as ErrorWithMeta, context, severity);

        if (onError && typeof onError === 'function') {
            try {
                await onError(error as Error);
            } catch (handlerError: unknown) {
                logError(handlerError as ErrorWithMeta, `${context}:ErrorHandler`, ErrorSeverity.HIGH);
            }
        }

        if (rethrow) {
            throw error;
        }

        return fallback;
    }
}

/**
 * Ignore specific errors (use sparingly and only when truly safe)
 */
async function ignoreErrors<T>(
    fn: () => Promise<T>,
    errorsToIgnore: string[] = [],
    context: string = 'IgnoreErrors'
): Promise<T | null> {
    try {
        return await fn();
    } catch (error: unknown) {
        const err = error as Error;
        const shouldIgnore = errorsToIgnore.some(pattern =>
            err.name === pattern || err.message.includes(pattern)
        );

        if (!shouldIgnore) {
            logError(err as ErrorWithMeta, context, ErrorSeverity.LOW);
        }
        return null;
    }
}

export {
    // Error classes
    DatabaseError,
    RedisError,
    ValidationError,
    StateError,
    LockError,

    // Severity levels
    ErrorSeverity,

    // Utility functions
    logError,
    safeExecute,
    safeExecuteSync,
    withErrorHandling,
    ignoreErrors
};
