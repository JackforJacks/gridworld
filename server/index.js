// GridWorld Server - Main Entry Point
// Restarting server to fix port issue
require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const compression = require('compression');

// Import configurations
const serverConfig = require('./config/server');
const socketConfig = require('./config/socket');

// Import routes
const apiRoutes = require('./routes/api');
const villagesRouter = require('./routes/villages');
const pool = require('./config/database');

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
        // Wait for Redis to be ready before proceeding - Redis is required
        const storage = require('./services/storage');
        await storage.waitForReady();

        // Configure middleware
        this.app.use(compression()); // Compress all HTTP responses
        this.app.use(cors({ origin: true, credentials: true })); // Allow cross-origin from dev server
        this.app.use(express.json());
        // Metrics integration removed — no /metrics Prometheus endpoint is registered
        // (Monitoring provisioning moved out of this repository)
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

        // Setup socket connections
        this.setupSocketHandlers();

        return this;
    }

    async initializeSingletonServices() {
        // Initialize services only once as singletons
        if (!calendarServiceInstance) {
            calendarServiceInstance = new CalendarService(this.io);
            await calendarServiceInstance.initialize(); // Wait for DB state to load
        }

        if (!statisticsServiceInstance) {
            statisticsServiceInstance = new StatisticsService();
            statisticsServiceInstance.initialize(calendarServiceInstance);
        }

        if (!populationServiceInstance) {
            populationServiceInstance = new PopulationService(this.io, calendarServiceInstance, statisticsServiceInstance);
            await populationServiceInstance.initialize(this.io, calendarServiceInstance);
        } else {
            // Services already initialized
        }

        // Load state from PostgreSQL into Redis
        try {
            StateManager.setIo(this.io);
            StateManager.setCalendarService(calendarServiceInstance);

            // Perform the load - Redis is already guaranteed to be ready
            await StateManager.loadFromDatabase();

            // If storage reconnects later, re-sync automatically
            try {
                const storage = require('./services/storage');
                // Attach to storage events emitted when adapter becomes ready
                if (typeof storage.on === 'function') {
                    storage.on('ready', async () => {
                        console.log(`[DEBUG] storage 'ready' event fired. isRestarting=${require('./services/populationState').isRestarting}`);
                        try {
                            // Skip reload if we're in the middle of a world restart
                            // (worldrestart creates fresh data in Redis that shouldn't be overwritten)
                            const PopulationState = require('./services/populationState');
                            if (PopulationState.isRestarting) {
                                console.log('🔁 Storage adapter ready, but skipping reload (worldrestart in progress)');
                                return;
                            }
                            console.log('🔁 Storage adapter ready, reloading state from Postgres...');
                            await StateManager.loadFromDatabase();
                        } catch (e) {
                            console.warn('⚠️ Failed to reload state after storage reconnect:', e.message);
                        }
                    });
                }
            } catch (e) {
                console.warn('⚠️ Could not attach storage reconnect handler:', e.message);
            }

            // Periodic integrity monitor to auto-repair duplicate memberships if introduced at runtime
            try {
                const PopulationState = require('./services/populationState');
                // Run every 30s while server is running
                setInterval(async () => {
                    try {
                        const r = await PopulationState.repairIfNeeded();
                        if (r && r.repaired) {
                            console.log('✅ PeopleState repaired duplicate memberships at runtime:', r);
                        }
                    } catch (e) { /* ignore */ }
                }, 30000);
            } catch (e) {
                console.warn('⚠️ Failed to setup periodic population integrity monitor:', e && e.message ? e.message : e);
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
                // Client disconnected
            });

            // Add ping/pong handlers for connection health
            socket.on('ping', () => {
                socket.emit('pong');
            });
        });

        // Handle server-level socket errors (ignore common non-critical errors)
        this.io.engine.on('connection_error', (err) => {
            // "Session ID unknown" happens when clients reconnect with stale sessions - ignore it
            if (err.message && err.message.includes('Session ID unknown')) return;
            console.error('❌ Socket.io connection error:', err.message);
        });
    }

    async start() {
        await this.initialize();

        this.server.listen(this.port, () => {
            console.log(`🚀 GridWorld server running at http://localhost:${this.port}`);
        });

        // Graceful shutdown
        process.on('SIGINT', async () => {
            await this.shutdown();
            process.exit(0);
        });
    }

    /**
     * Shutdown server and cleanup resources. Safe to call multiple times.
     */
    async shutdown() {
        try {
            console.log('\n🛑 Shutting down server...');

            // DEBUG: Check person hash at shutdown start
            const _storage = require('./services/storage');
            const personCheck = await _storage.hgetall('person');
            console.log(`[DEBUG] At shutdown start: person hash has ${personCheck ? Object.keys(personCheck).length : 0} entries`);

            // Stop food update timer
            try {
                const VillageService = require('./services/villageService');
                VillageService.stopFoodUpdateTimer();
            } catch (e) { /* ignore */ }

            if (populationServiceInstance) {
                try { await populationServiceInstance.shutdown(); } catch (e) { /* ignore */ }
            }

            if (calendarServiceInstance) {
                try { calendarServiceInstance.stop(); console.log('📅 Calendar service stopped'); } catch (e) { /* ignore */ }
            }

            if (statisticsServiceInstance) {
                try { statisticsServiceInstance.shutdown(); console.log('📈 Statistics service stopped'); } catch (e) { /* ignore */ }
            }

            // Close http server if listening
            try { this.server && this.server.close(); } catch (e) { /* ignore */ }

            // Close socket.io if present
            try { this.io && this.io.close(); } catch (e) { /* ignore */ }

            console.log('👋 Server closed gracefully');
        } catch (err) {
            console.error('Error during shutdown:', err && err.message ? err.message : err);
        }
    }
}

// Start the server when invoked directly (prevents auto-start during tests)
if (require.main === module) {
    const server = new GridWorldServer();
    server.start().catch(console.error);
}

module.exports = GridWorldServer;
