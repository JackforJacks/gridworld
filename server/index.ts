// GridWorld Server - Main Entry Point
// Restarting server to fix port issue
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env
import express, { Application, Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import compression from 'compression';

// Import configurations
import serverConfig from './config/server';
import socketConfig from './config/socket';

// Import routes
import apiRoutes from './routes/api';

// Import services
import PopulationService from './services/PopulationService';
import CalendarService from './services/calendarService';
import StatisticsService from './services/statisticsService';
import StateManager from './services/stateManager';

// Import middleware
import errorHandler from './middleware/errorHandler';

// Import memory tracker
import memoryTracker from './services/memoryTracker';

// For CommonJS: __dirname is available directly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverDirname = __dirname || path.resolve(path.dirname(''));

// Singleton service instances
let populationServiceInstance: InstanceType<typeof PopulationService> | null = null;
let calendarServiceInstance: InstanceType<typeof CalendarService> | null = null;
let statisticsServiceInstance: InstanceType<typeof StatisticsService> | null = null;

class GridWorldServer {
    private app: Application;
    private server: http.Server;
    private io: SocketIOServer;
    private port: number;

    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new SocketIOServer(this.server, socketConfig as any);
        this.port = typeof serverConfig.port === 'number' ? serverConfig.port : Number(serverConfig.port);
    }

    async initialize(): Promise<this> {
        // Wait for Redis to be ready before proceeding - Redis is required
        const storage = await import('./services/storage');
        await storage.default.waitForReady();

        // Start memory tracker (samples every 60 seconds)
        memoryTracker.start(60000);

        // Configure middleware
        this.app.use(compression()); // Compress all HTTP responses
        this.app.use(cors({ origin: true, credentials: true })); // Allow cross-origin from dev server
        this.app.use(express.json());
        // Metrics integration removed — no /metrics Prometheus endpoint is registered
        // (Monitoring provisioning moved out of this repository)
        this.app.use(express.static(path.join(serverDirname, '../dist')));

        // Setup routes
        this.app.use('/api', apiRoutes);
        // Serve frontend for all non-API routes (SPA behavior)
        this.app.get('/', (req: Request, res: Response) => {
            res.sendFile(path.join(serverDirname, '../dist', 'index.html'));
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

    async initializeSingletonServices(): Promise<void> {
        // Initialize services only once as singletons
        if (!calendarServiceInstance) {
            calendarServiceInstance = new CalendarService(this.io);
            await calendarServiceInstance.initialize(); // Wait for DB state to load
        }

        if (!statisticsServiceInstance) {
            statisticsServiceInstance = new StatisticsService();
            // Cast to any to work around StatisticsService.initialize typing issue
            (statisticsServiceInstance as any).initialize(calendarServiceInstance);
        }

        if (!populationServiceInstance) {
            populationServiceInstance = new PopulationService(this.io, calendarServiceInstance!, statisticsServiceInstance);
            await populationServiceInstance.initialize(this.io, calendarServiceInstance!);
        } else {
            // Services already initialized
        }

        // Load saved state into Redis
        try {
            StateManager.setIo(this.io);
            StateManager.setCalendarService(calendarServiceInstance);

            // Perform the load - Redis is already guaranteed to be ready
            await StateManager.loadFromDatabase();

            // Sync Rust ECS from Redis population data
            try {
                const rustSim = await import('./services/rustSimulation');
                await rustSim.default.syncFromRedis();
            } catch (e: unknown) {
                console.warn('⚠️ Failed to sync Rust simulation from Redis:', (e as Error).message);
            }

            // If storage reconnects later, re-sync automatically
            try {
                const storage = await import('./services/storage');
                // Attach to storage events emitted when adapter becomes ready
                if (typeof storage.default.on === 'function') {
                    storage.default.on('ready', async () => {
                        const PopulationStateModule = await import('./services/populationState');
                        console.log(`[DEBUG] storage 'ready' event fired. isRestarting=${PopulationStateModule.default.isRestarting}`);
                        try {
                            // Skip reload if we're in the middle of a world restart
                            // (worldrestart creates fresh data in Redis that shouldn't be overwritten)
                            if (PopulationStateModule.default.isRestarting) {
                                console.log('🔁 Storage adapter ready, but skipping reload (worldrestart in progress)');
                                return;
                            }
                            console.log('🔁 Storage adapter ready, reloading state...');
                            await StateManager.loadFromDatabase();
                        } catch (e: unknown) {
                            console.warn('⚠️ Failed to reload state after storage reconnect:', (e as Error).message);
                        }
                    });
                }
            } catch (e: unknown) {
                console.warn('⚠️ Could not attach storage reconnect handler:', (e as Error).message);
            }

            // Periodic integrity monitor to auto-repair duplicate memberships if introduced at runtime
            try {
                const PopulationStateModule = await import('./services/populationState');
                const PopulationState = PopulationStateModule.default;
                // Run every 30s while server is running
                setInterval(async () => {
                    try {
                        await PopulationState.repairIfNeeded();
                        // Silently repair - no need to log successful repairs
                    } catch (e: unknown) { /* ignore */ }
                }, 30000);
            } catch (e: unknown) {
                const error = e as Error;
                console.warn('⚠️ Failed to setup periodic population integrity monitor:', error?.message || e);
            }
        } catch (err: unknown) {
            console.error('❌ Failed to load state:', (err as Error).message);
            console.log('🌍 Creating fresh world instead...');
            
            // Create a fresh world so the app is usable
            try {
                const { restartWorld } = await import('./services/worldRestart');
                await restartWorld({
                    skipCalendarReset: false,
                    context: {
                        calendarService: calendarServiceInstance,
                        io: this.io
                    }
                });
                console.log('✅ Fresh world created successfully');
            } catch (restartErr: unknown) {
                console.error('❌ Failed to create fresh world:', (restartErr as Error).message);
            }
        }

    }

    setupSocketHandlers(): void {
        this.io.on('connection', (socket) => {
            // Handle connection errors
            socket.on('connect_error', (error: Error) => {
                console.error(`❌ Connection error for ${socket.id}:`, error.message);
            });

            socket.on('error', (error: Error) => {
                console.error(`❌ Socket error for ${socket.id}:`, error.message);
            });            // Handle socket events
            socket.on('getPopulation', async () => {
                try {
                    const data = await populationServiceInstance?.getAllPopulationData();
                    socket.emit('populationUpdate', data);
                } catch (error: unknown) {
                    console.error('❌ Error getting population data:', error);
                    socket.emit('error', { message: 'Failed to get population data' });
                }
            });

            // Calendar subscription handling
            socket.on('subscribeToCalendar', () => {
                // Send current calendar state immediately
                try {
                    const calendarState = calendarServiceInstance?.getState();
                    socket.emit('calendarState', calendarState);
                } catch (error: unknown) {
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

    async start(): Promise<void> {
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
    async shutdown(): Promise<void> {
        try {
            console.log('\n🛑 Shutting down server...');

            // DEBUG: Check person hash at shutdown start (use hlen for efficiency)
            const _storage = await import('./services/storage');
            const personCount = await _storage.default.hlen('person');
            console.log(`[DEBUG] At shutdown start: person hash has ${personCount} entries`);

            // Stop memory tracker
            try { memoryTracker.stop(); } catch (e: unknown) { /* ignore */ }

            if (populationServiceInstance) {
                try { await populationServiceInstance.shutdown(); } catch (e: unknown) { /* ignore */ }
            }

            if (calendarServiceInstance) {
                try { calendarServiceInstance.stop(); console.log('📅 Calendar service stopped'); } catch (e: unknown) { /* ignore */ }
            }

            if (statisticsServiceInstance) {
                try { statisticsServiceInstance.shutdown(); console.log('📈 Statistics service stopped'); } catch (e: unknown) { /* ignore */ }
            }

            // Close http server if listening
            try { this.server && this.server.close(); } catch (e: unknown) { /* ignore */ }

            // Close socket.io if present
            try { this.io && this.io.close(); } catch (e: unknown) { /* ignore */ }

            console.log('👋 Server closed gracefully');
        } catch (err: unknown) {
            const error = err as Error;
            console.error('Error during shutdown:', error?.message || err);
        }
    }
}

// Start the server when invoked directly (prevents auto-start during tests)
// Check if this module is the main entry point
const isMainModule = process.argv[1] && require.main === module;
if (isMainModule) {
    const server = new GridWorldServer();
    server.start().catch(console.error);
}

export default GridWorldServer;

