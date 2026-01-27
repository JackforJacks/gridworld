// GridWorld Server - Main Entry Point
// Restarting server to fix port issue
require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');

// Import configurations
const serverConfig = require('./config/server');
const socketConfig = require('./config/socket');

// Import routes
const apiRoutes = require('./routes/api');
const villagesRouter = require('./routes/villages');
const pool = require('./config/database');
const villageSeeder = require('./services/villageSeeder');

// Import services
const PopulationService = require('./services/populationService');
const CalendarService = require('./services/calendarService');
const StatisticsService = require('./services/statisticsService');
const StateManager = require('./services/stateManager');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// Singleton service instances
let populationServiceInstance = null;
let calendarServiceInstance = null;
let statisticsServiceInstance = null;

class GridWorldServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, socketConfig);
        this.port = serverConfig.port;
    }

    async initialize() {
        // Configure middleware
        this.app.use(cors({ origin: true, credentials: true })); // Allow cross-origin from dev server
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../dist')));

        // Setup routes
        this.app.use('/api', apiRoutes);
        this.app.use('/api/villages', villagesRouter);        // Serve frontend for all non-API routes (SPA behavior)
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../dist', 'index.html'));
        });

        // Error handling middleware
        this.app.use(errorHandler);

        // Initialize singleton services if not already initialized
        await this.initializeSingletonServices();

        // Make services available to routes
        this.app.locals.calendarService = calendarServiceInstance;
        this.app.locals.populationService = populationServiceInstance;
        this.app.locals.statisticsService = statisticsServiceInstance;

        // Attempt to seed villages if none exist yet
        try {
            const seeded = await villageSeeder.seedIfNoVillages();
            if (seeded && seeded.created && seeded.created > 0) {
                console.log(`🌱 Seeded ${seeded.created} villages at startup`);
            }
        } catch (err) {
            console.error('Error seeding villages at startup:', err);
        }

        // Setup socket connections
        this.setupSocketHandlers();

        return this;
    }

    async initializeSingletonServices() {
        // Initialize services only once as singletons
        if (!calendarServiceInstance) {
            console.log('🔧 Initializing Calendar Service singleton...');
            calendarServiceInstance = new CalendarService(this.io);
            console.log('📅 Calendar Service singleton initialized');
        }

        if (!statisticsServiceInstance) {
            console.log('🔧 Initializing Statistics Service singleton...');
            statisticsServiceInstance = new StatisticsService();
            statisticsServiceInstance.initialize(calendarServiceInstance);
            console.log('📈 Statistics Service singleton initialized');
        }

        if (!populationServiceInstance) {
            console.log('🔧 Initializing Population Service singleton...');
            populationServiceInstance = new PopulationService(this.io, calendarServiceInstance, statisticsServiceInstance);
            await populationServiceInstance.initialize(this.io, calendarServiceInstance);
            console.log('👥 Population Service singleton initialized');
        } else {
            console.log('🔄 Services already initialized, skipping initialization...');
        }

        // Load state from PostgreSQL to Redis
        console.log('🔧 Initializing State Manager (Redis)...');
        try {
            await StateManager.loadFromDatabase();
            StateManager.setIo(this.io);
            StateManager.setCalendarService(calendarServiceInstance);
            console.log('🔴 State Manager initialized (Redis mode)');

            // If Redis reconnects later, re-sync automatically
            try {
                const redis = require('./config/redis');
                redis.on && redis.on('ready', async () => {
                    try {
                        console.log('🔁 Redis reconnected, reloading state to Redis from Postgres...');
                        await StateManager.loadFromDatabase();
                    } catch (e) {
                        console.warn('⚠️ Failed to reload state after Redis reconnect:', e.message);
                    }
                });
            } catch (e) {
                console.warn('⚠️ Could not attach Redis reconnect handler:', e.message);
            }
        } catch (err) {
            console.error('❌ Failed to initialize Redis state, falling back to PostgreSQL:', err.message);
        }

        // Setup food production on calendar ticks (instead of interval timer)
        const VillageService = require('./services/villageService');
        VillageService.setIo(this.io);
        VillageService.setupTickBasedFoodUpdates(calendarServiceInstance);
    }

    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`👤 Client connected: ${socket.id}`);

            // Handle connection errors
            socket.on('connect_error', (error) => {
                console.error(`❌ Connection error for ${socket.id}:`, error.message);
            });

            socket.on('error', (error) => {
                console.error(`❌ Socket error for ${socket.id}:`, error.message);
            });            // Handle socket events
            socket.on('getPopulation', async () => {
                try {
                    const data = await populationServiceInstance.getAllPopulationData();
                    socket.emit('populationUpdate', data);
                } catch (error) {
                    console.error('❌ Error getting population data:', error);
                    socket.emit('error', { message: 'Failed to get population data' });
                }
            });

            // Calendar subscription handling
            socket.on('subscribeToCalendar', () => {
                console.log(`📅 Client ${socket.id} subscribed to calendar updates`);
                // Send current calendar state immediately
                try {
                    const calendarState = calendarServiceInstance.getState();
                    socket.emit('calendarState', calendarState);
                } catch (error) {
                    console.error('❌ Error getting calendar state:', error);
                    socket.emit('error', { message: 'Failed to get calendar state' });
                }
            });

            socket.on('disconnect', (reason) => {
                console.log(`👤 Client disconnected: ${socket.id}, reason: ${reason}`);
            });

            // Add ping/pong handlers for connection health
            socket.on('ping', () => {
                socket.emit('pong');
            });
        });

        // Handle server-level socket errors
        this.io.engine.on('connection_error', (err) => {
            console.error('❌ Socket.io connection error:', err.message);
        });
    }

    async start() {
        await this.initialize();

        this.server.listen(this.port, () => {
            console.log(`🚀 GridWorld server running at http://localhost:${this.port}`);
            console.log(`📊 API available at http://localhost:${this.port}/api/`);
            console.log(`🔌 WebSocket server ready for real-time updates`);
        });        // Graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down server...');

            // Stop food update timer
            const VillageService = require('./services/villageService');
            VillageService.stopFoodUpdateTimer();

            if (populationServiceInstance) {
                await populationServiceInstance.shutdown();
            }

            // Stop calendar service
            if (calendarServiceInstance) {
                calendarServiceInstance.stop();
                console.log('📅 Calendar service stopped');
            }

            // Stop statistics service
            if (statisticsServiceInstance) {
                statisticsServiceInstance.shutdown();
                console.log('📈 Statistics service stopped');
            }

            this.server.close(() => {
                console.log('👋 Server closed gracefully');
                process.exit(0);
            });
        });
    }
}

// Start the server
const server = new GridWorldServer();
server.start().catch(console.error);

module.exports = GridWorldServer;
