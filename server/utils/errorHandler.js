/**
 * Centralized Error Handling Utility
 * Provides consistent error handling across the application
 */

/**
 * Custom Error Classes
 */
class DatabaseError extends Error {
    constructor(message, originalError = null) {
        super(message);
        this.name = 'DatabaseError';
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class RedisError extends Error {
    constructor(message, originalError = null) {
        super(message);
        this.name = 'RedisError';
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class ValidationError extends Error {
    constructor(message, field = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.timestamp = new Date().toISOString();
    }
}

class StateError extends Error {
    constructor(message, state = null) {
        super(message);
        this.name = 'StateError';
        this.state = state;
        this.timestamp = new Date().toISOString();
    }
}

class LockError extends Error {
    constructor(message, lockKey = null) {
        super(message);
        this.name = 'LockError';
        this.lockKey = lockKey;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Error severity levels
 */
const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
};

/**
 * Log error with context
 * @param {Error} error - The error to log
 * @param {string} context - Where the error occurred
 * @param {string} severity - Error severity level
 * @param {Object} metadata - Additional metadata
 */
function logError(error, context = 'Unknown', severity = ErrorSeverity.MEDIUM, metadata = {}) {
    const errorLog = {
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
 * @param {Function} fn - Function to execute
 * @param {string} context - Context for error logging
 * @param {*} fallbackValue - Value to return on error
 * @param {string} severity - Error severity
 * @returns {Promise<*>} Result or fallback value
 */
async function safeExecute(fn, context, fallbackValue = null, severity = ErrorSeverity.MEDIUM) {
    try {
        return await fn();
    } catch (error) {
        logError(error, context, severity);
        return fallbackValue;
    }
}

/**
 * Safe execution wrapper (sync version)
 * @param {Function} fn - Function to execute
 * @param {string} context - Context for error logging
 * @param {*} fallbackValue - Value to return on error
 * @param {string} severity - Error severity
 * @returns {*} Result or fallback value
 */
function safeExecuteSync(fn, context, fallbackValue = null, severity = ErrorSeverity.MEDIUM) {
    try {
        return fn();
    } catch (error) {
        logError(error, context, severity);
        return fallbackValue;
    }
}

/**
 * Wrap async operation with error handling
 * @param {Function} operation - Async operation to execute
 * @param {string} context - Context for error logging
 * @param {Object} options - Options { onError, fallback, severity }
 * @returns {Promise<*>}
 */
async function withErrorHandling(operation, context, options = {}) {
    const {
        onError = null,
        fallback = null,
        severity = ErrorSeverity.MEDIUM,
        rethrow = false
    } = options;

    try {
        return await operation();
    } catch (error) {
        logError(error, context, severity);

        if (onError && typeof onError === 'function') {
            try {
                await onError(error);
            } catch (handlerError) {
                logError(handlerError, `${context}:ErrorHandler`, ErrorSeverity.HIGH);
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
 * @param {Function} fn - Function to execute
 * @param {Array<string>} ignoreErrors - Error names/messages to ignore
 * @param {string} context - Context for logging
 * @returns {Promise<*>}
 */
async function ignoreErrors(fn, ignoreErrors = [], context = 'IgnoreErrors') {
    try {
        return await fn();
    } catch (error) {
        const shouldIgnore = ignoreErrors.some(pattern =>
            error.name === pattern || error.message.includes(pattern)
        );

        if (!shouldIgnore) {
            logError(error, context, ErrorSeverity.LOW);
        }
        return null;
    }
}

module.exports = {
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
