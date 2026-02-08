/**
 * Dependency Container - Breaks circular dependencies
 * Provides lazy-loaded references to commonly used modules
 */

// Type definitions for lazy-loaded modules
interface LockModule {
    acquireLock: (key: string, ttlMs?: number, timeoutMs?: number, retryDelayMs?: number) => Promise<string | null>;
    releaseLock: (key: string, token: string) => Promise<boolean>;
}

interface CalculatorModule {
    getRandomSex: () => boolean;
    getRandomAge: () => number;
    calculateAge: (birthDate: string | Date, currentYear: number, currentMonth: number, currentDay: number) => number;
    getRandomBirthDate: (currentYear: number, currentMonth: number, currentDay: number, age: number) => string;
}

interface PopulationStateModule {
    isRestarting: boolean;
    getNextId: () => Promise<number>;
    getIdBatch: (count: number) => Promise<number[]>;
    // All other methods removed - person data now managed by Rust ECS
    [key: string]: unknown;
}

// Cache for lazy-loaded modules
let _lifecycle: unknown = null;
let _populationState: PopulationStateModule | null = null;
let _stateManager: unknown = null;
let _calculator: CalculatorModule | null = null;
let _lock: LockModule | null = null;

/**
 * Get lifecycle module (lazy loaded)
 */
function getLifecycle(): unknown {
    if (!_lifecycle) {
        _lifecycle = require('./lifecycle');
    }
    return _lifecycle;
}

/**
 * Get PopulationState module (lazy loaded)
 */
function getPopulationState(): PopulationStateModule {
    if (!_populationState) {
        _populationState = require('../populationState').default as PopulationStateModule;
    }
    return _populationState;
}

/**
 * Get StateManager module (lazy loaded)
 */
function getStateManager(): unknown {
    if (!_stateManager) {
        _stateManager = require('../stateManager').default;
    }
    return _stateManager;
}

/**
 * Get calculator module (lazy loaded)
 */
function getCalculator(): CalculatorModule {
    if (!_calculator) {
        _calculator = require('./calculator') as CalculatorModule;
    }
    return _calculator;
}

/**
 * Get lock utilities (lazy loaded)
 */
function getLock(): LockModule {
    if (!_lock) {
        _lock = require('../../utils/lock') as LockModule;
    }
    return _lock;
}

/**
 * Reset all cached modules (useful for testing)
 */
function reset(): void {
    _lifecycle = null;
    _populationState = null;
    _stateManager = null;
    _calculator = null;
    _lock = null;
}

export {
    getLifecycle,
    getPopulationState,
    getStateManager,
    getCalculator,
    getLock,
    reset
};
