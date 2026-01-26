const { io } = require('socket.io-client');
const VillageService = require('./server/services/villageService');

(async () => {
    const socket = io('http://localhost:3001', { transports: ['polling'], upgrade: false, path: '/socket.io' });
    socket.on('connect', () => {
        console.log('Test socket connected', socket.id);
    });
    socket.on('villageUpdated', (v) => {
        console.log('Received villageUpdated:', v.id, 'food_stores=', v.food_stores);
    });
    socket.on('villagesUpdated', (vs) => {
        console.log('Received villagesUpdated, count=', vs.length);
    });

    // Wait a bit for connection, then trigger an update
    setTimeout(async () => {
        try {
            console.log('Invoking updateAllVillageFoodStores()');
            await VillageService.updateAllVillageFoodStores();
            console.log('updateAllVillageFoodStores invoked');
        } catch (e) {
            console.error('Error invoking updateAllVillageFoodStores:', e);
        }
    }, 1000);

    // Close after a short while
    setTimeout(() => {
        socket.close();
        process.exit(0);
    }, 5000);
})();