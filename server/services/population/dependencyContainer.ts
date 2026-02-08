/**
 * Dependency Container - Breaks circular dependencies
 * Provides lazy-loaded references to commonly used modules
 */

interface PopulationStateModule {
    isRestarting: boolean;
    [key: string]: unknown;
}

// Cache for lazy-loaded modules
let _lifecycle: unknown = null;
let _populationState: PopulationStateModule | null = null;
let _stateManager: unknown = null;

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
 * Reset all cached modules (useful for testing)
 */
function reset(): void {
    _lifecycle = null;
    _populationState = null;
    _stateManager = null;
}

export {
    getLifecycle,
    getPopulationState,
    getStateManager,
    reset
};
