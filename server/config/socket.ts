// Socket.io Configuration
const socketConfig = {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket'], // Prioritize polling
    allowEIO3: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6,
    allowUpgrades: false, // Disable upgrading to WebSocket to avoid proxy issues
    perMessageDeflate: false,
    httpCompression: false,
    serveClient: false
};

export default socketConfig;
