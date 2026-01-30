/**
 * Population Event Emitter
 * Decouples services using event-driven architecture
 */

const EventEmitter = require('events');

class PopulationEventEmitter extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(20); // Increase limit for multiple listeners
    }

    /**
     * Emit birth event
     * @param {Object} data - { personId, tileId, familyId, date, population }
     */
    emitBirth(data) {
        this.emit('birth', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit death event
     * @param {Object} data - { personId, tileId, cause, date, population }
     */
    emitDeath(data) {
        this.emit('death', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit family created event
     * @param {Object} data - { familyId, husbandId, wifeId, tileId }
     */
    emitFamilyCreated(data) {
        this.emit('family:created', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit pregnancy started event
     * @param {Object} data - { familyId, deliveryDate }
     */
    emitPregnancyStarted(data) {
        this.emit('pregnancy:started', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit population updated event
     * @param {Object} data - { tileId, oldPopulation, newPopulation }
     */
    emitPopulationUpdated(data) {
        this.emit('population:updated', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit tick event (calendar tick processed)
     * @param {Object} data - { daysAdvanced, date }
     */
    emitTick(data) {
        this.emit('tick', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit save completed event
     * @param {Object} data - { duration, recordCount }
     */
    emitSaveCompleted(data) {
        this.emit('save:completed', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Emit integrity check event
     * @param {Object} data - { success, issues }
     */
    emitIntegrityCheck(data) {
        this.emit('integrity:check', {
            ...data,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Subscribe to birth events
     * @param {Function} handler
     */
    onBirth(handler) {
        this.on('birth', handler);
    }

    /**
     * Subscribe to death events
     * @param {Function} handler
     */
    onDeath(handler) {
        this.on('death', handler);
    }

    /**
     * Subscribe to family created events
     * @param {Function} handler
     */
    onFamilyCreated(handler) {
        this.on('family:created', handler);
    }

    /**
     * Subscribe to pregnancy started events
     * @param {Function} handler
     */
    onPregnancyStarted(handler) {
        this.on('pregnancy:started', handler);
    }

    /**
     * Subscribe to population updated events
     * @param {Function} handler
     */
    onPopulationUpdated(handler) {
        this.on('population:updated', handler);
    }

    /**
     * Subscribe to tick events
     * @param {Function} handler
     */
    onTick(handler) {
        this.on('tick', handler);
    }

    /**
     * Subscribe to save completed events
     * @param {Function} handler
     */
    onSaveCompleted(handler) {
        this.on('save:completed', handler);
    }

    /**
     * Subscribe to integrity check events
     * @param {Function} handler
     */
    onIntegrityCheck(handler) {
        this.on('integrity:check', handler);
    }
}

// Singleton instance
const populationEvents = new PopulationEventEmitter();

module.exports = populationEvents;
