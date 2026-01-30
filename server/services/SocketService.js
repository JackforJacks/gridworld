/**
 * Socket Service - Handles all Socket.IO communication
 * Decouples socket logic from business services
 */

const { logError, ErrorSeverity } = require('../utils/errorHandler');

class SocketService {
    constructor(io) {
        this.io = io;
        this.isConnected = false;
    }

    /**
     * Initialize socket service
     */
    initialize() {
        if (this.io) {
            this.isConnected = true;
            console.log('✅ Socket service initialized');
        }
    }

    /**
     * Emit event to all connected clients
     * @param {string} eventName - Event name
     * @param {Object} data - Data to send
     */
    emit(eventName, data) {
        if (!this.isConnected || !this.io) {
            logError(
                new Error('Socket not connected'),
                'SocketService:Emit',
                ErrorSeverity.LOW
            );
            return;
        }

        try {
            this.io.emit(eventName, data);
        } catch (error) {
            logError(error, `SocketService:Emit:${eventName}`, ErrorSeverity.MEDIUM);
        }
    }

    /**
     * Emit population update
     * @param {Object} data - Population data
     */
    emitPopulationUpdate(data) {
        this.emit('populationUpdate', data);
    }

    /**
     * Emit birth event
     * @param {Object} data - Birth data
     */
    emitBirth(data) {
        this.emit('birth', data);
    }

    /**
     * Emit death event
     * @param {Object} data - Death data
     */
    emitDeath(data) {
        this.emit('death', data);
    }

    /**
     * Emit family created event
     * @param {Object} data - Family data
     */
    emitFamilyCreated(data) {
        this.emit('familyCreated', data);
    }

    /**
     * Emit game saved event
     * @param {Object} data - Save data
     */
    emitGameSaved(data) {
        this.emit('gameSaved', data);
    }

    /**
     * Emit auto save complete event
     * @param {Object} data - Save data
     */
    emitAutoSaveComplete(data) {
        this.emit('autoSaveComplete', data);
    }

    /**
     * Emit integrity audit start event
     * @param {Object} data - Audit data
     */
    emitIntegrityAuditStart(data) {
        this.emit('integrityAuditStart', data);
    }

    /**
     * Emit integrity audit complete event
     * @param {Object} data - Audit results
     */
    emitIntegrityAuditComplete(data) {
        this.emit('integrityAuditComplete', data);
    }

    /**
     * Emit senescence applied event
     * @param {Object} data - Senescence data
     */
    emitSenescenceApplied(data) {
        this.emit('senescenceApplied', data);
    }

    /**
     * Broadcast to specific room
     * @param {string} room - Room name
     * @param {string} eventName - Event name
     * @param {Object} data - Data to send
     */
    emitToRoom(room, eventName, data) {
        if (!this.isConnected || !this.io) {
            return;
        }

        try {
            this.io.to(room).emit(eventName, data);
        } catch (error) {
            logError(error, `SocketService:EmitToRoom:${room}:${eventName}`, ErrorSeverity.MEDIUM);
        }
    }

    /**
     * Check if socket is connected
     * @returns {boolean}
     */
    isSocketConnected() {
        return this.isConnected && !!this.io;
    }

    /**
     * Disconnect socket service
     */
    disconnect() {
        this.isConnected = false;
        console.log('Socket service disconnected');
    }
}

module.exports = SocketService;
