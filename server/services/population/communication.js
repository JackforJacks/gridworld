// Population Communication - Handles broadcasting and real-time updates

/**
 * Broadcasts population updates to connected clients
 * @param {Object} io - Socket.io instance
 * @param {Function} getAllDataFn - Function to get all population data
 * @param {string} eventType - Type of event to broadcast
 */
async function broadcastUpdate(io, getAllDataFn, eventType = 'populationUpdate') {
    if (io) {
        const data = await getAllDataFn();
        io.emit(eventType, data);
    }
}

/**
 * Updates data and broadcasts changes
 * @param {Object} io - Socket.io instance
 * @param {Function} saveDataFn - Function to save data
 * @param {Function} getAllDataFn - Function to get all population data
 * @param {string} eventType - Type of event to broadcast
 */
async function updateDataAndBroadcast(io, saveDataFn, getAllDataFn, eventType = 'populationUpdate') {
    await saveDataFn();
    await broadcastUpdate(io, getAllDataFn, eventType);
}

/**
 * Sets up real-time population event listeners
 * @param {Object} io - Socket.io instance
 * @param {PopulationService} serviceInstance - Population service instance
 */
function setupRealtimeListeners(io, serviceInstance) {
    if (!io) return;

    // Listen for client requests for population data
    io.on('connection', (socket) => {
        console.log('Client connected for population updates');

        // Send initial population data
        socket.on('requestPopulationData', async () => {
            try {
                const data = await serviceInstance.getAllPopulationData();
                socket.emit('populationData', data);
            } catch (error) {
                console.error('Error sending population data:', error);
                socket.emit('populationError', { message: 'Failed to retrieve population data' });
            }
        });

        // Handle client disconnect
        socket.on('disconnect', () => {
            console.log('Client disconnected from population updates');
        });
    });
}

/**
 * Broadcasts specific population events
 * @param {Object} io - Socket.io instance
 * @param {string} eventType - Type of event
 * @param {Object} data - Event data
 */
function broadcastEvent(io, eventType, data) {
    if (io) {
        io.emit(eventType, {
            timestamp: new Date().toISOString(),
            type: eventType,
            data: data
        });
    }
}

module.exports = {
    broadcastUpdate,
    updateDataAndBroadcast,
    setupRealtimeListeners,
    broadcastEvent
};
