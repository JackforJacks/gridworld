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
    getNextFamilyId: () => Promise<number>;
    addPerson: (person: unknown, isNew?: boolean) => Promise<void>;
    removePerson: (personId: number, markDeleted?: boolean) => Promise<void>;
    getPerson: (personId: number) => Promise<unknown>;
    updatePerson: (personId: number, updates: unknown) => Promise<void>;
    getAllPeople: () => Promise<unknown[]>;
    addFamily: (family: unknown, isNew?: boolean) => Promise<void>;
    getFamily: (familyId: number) => Promise<unknown>;
    updateFamily: (familyId: number, updates: unknown) => Promise<void>;
    getAllFamilies: () => Promise<unknown[]>;
    addEligiblePerson: (personId: number, isMale: boolean, tileId: number) => Promise<void>;
    removeEligiblePerson: (personId: number, tileId?: number, sex?: string) => Promise<void>;
    addFertileFamily: (familyId: number, year: number, month: number, day: number) => Promise<void>;
    removeFertileFamily: (familyId: number) => Promise<void>;
    [key: string]: unknown;
}

// Cache for lazy-loaded modules
let _familyManager: unknown = null;
let _lifecycle: unknown = null;
let _populationState: PopulationStateModule | null = null;
let _stateManager: unknown = null;
let _calculator: CalculatorModule | null = null;
let _lock: LockModule | null = null;

/**
 * Get familyManager module (lazy loaded)
 */
function getFamilyManager(): unknown {
    if (!_familyManager) {
        _familyManager = require('./familyManager');
    }
    return _familyManager;
}

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
    _familyManager = null;
    _lifecycle = null;
    _populationState = null;
    _stateManager = null;
    _calculator = null;
    _lock = null;
}

export {
    getFamilyManager,
    getLifecycle,
    getPopulationState,
    getStateManager,
    getCalculator,
    getLock,
    reset
};
