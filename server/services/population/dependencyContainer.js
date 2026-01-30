/**
 * Dependency Container - Breaks circular dependencies
 * Provides lazy-loaded references to commonly used modules
 */

// Cache for lazy-loaded modules
let _familyManager = null;
let _lifecycle = null;
let _populationState = null;
let _stateManager = null;
let _calculator = null;
let _lock = null;

/**
 * Get familyManager module (lazy loaded)
 */
function getFamilyManager() {
    if (!_familyManager) {
        _familyManager = require('./familyManager.js');
    }
    return _familyManager;
}

/**
 * Get lifecycle module (lazy loaded)
 */
function getLifecycle() {
    if (!_lifecycle) {
        _lifecycle = require('./lifecycle.js');
    }
    return _lifecycle;
}

/**
 * Get PopulationState module (lazy loaded)
 */
function getPopulationState() {
    if (!_populationState) {
        _populationState = require('../populationState');
    }
    return _populationState;
}

/**
 * Get StateManager module (lazy loaded)
 */
function getStateManager() {
    if (!_stateManager) {
        _stateManager = require('../stateManager');
    }
    return _stateManager;
}

/**
 * Get calculator module (lazy loaded)
 */
function getCalculator() {
    if (!_calculator) {
        _calculator = require('./calculator.js');
    }
    return _calculator;
}

/**
 * Get lock utilities (lazy loaded)
 */
function getLock() {
    if (!_lock) {
        _lock = require('../../utils/lock');
    }
    return _lock;
}

/**
 * Reset all cached modules (useful for testing)
 */
function reset() {
    _familyManager = null;
    _lifecycle = null;
    _populationState = null;
    _stateManager = null;
    _calculator = null;
    _lock = null;
}

module.exports = {
    getFamilyManager,
    getLifecycle,
    getPopulationState,
    getStateManager,
    getCalculator,
    getLock,
    reset
};
