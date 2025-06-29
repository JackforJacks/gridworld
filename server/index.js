// GridWorld Server - Main Entry Point
// Restarting server to fix port issue
require('dotenv').config(); // Load environment variables from .env
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

// Import configurations
const serverConfig = require('./config/server');
const socketConfig = require('./config/socket');

// Import routes
const apiRoutes = require('./routes/api');

// Import services
const populationService = require('./services/populationService');
const CalendarService = require('./services/calendarService');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

class GridWorldServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, socketConfig);
        this.port = serverConfig.port;

        // Initialize calendar service
        this.calendarService = new CalendarService(this.io);
    }

    async initialize() {
        // Configure middleware
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../dist')));

        // Setup routes
        this.app.use('/api', apiRoutes);        // Serve frontend for all non-API routes (SPA behavior)
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../dist', 'index.html'));
        });

        // Error handling middleware
        this.app.use(errorHandler);        // Initialize services
        await populationService.initialize(this.io, this.calendarService);

        // Make services available to routes
        this.app.locals.calendarService = this.calendarService;
        this.app.locals.populationService = populationService;

        // Setup socket connections
        this.setupSocketHandlers();

        return this;
    } setupSocketHandlers() {
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
                    const data = await populationService.getAllPopulationData();
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
                    const calendarState = this.app.locals.calendarService.getState();
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
            await populationService.shutdown();

            // Stop calendar service
            if (this.calendarService) {
                this.calendarService.stop();
                console.log('📅 Calendar service stopped');
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
