// GridWorld Server with Population Management
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = 8080;
const DATA_FILE = path.join(__dirname, 'data.json');

// Population data structure
let populationData = {
    count: 1000000, // Starting population
    lastUpdated: Date.now(),
    growth: {
        rate: 1, // Population grows by 1 per second
        interval: 1000 // Update every 1000ms (1 second)
    }
};

// Middleware
app.use(express.json());
app.use(express.static('dist')); // Serve static files from dist directory

// Load or create initial population data
async function initializeData() {
    try {
        if (await fs.pathExists(DATA_FILE)) {
            const data = await fs.readJson(DATA_FILE);
            populationData = { ...populationData, ...data };
            console.log('📊 Population data loaded from file:', populationData.count);
        } else {
            await savePopulationData();
            console.log('📊 Created new population data file');
        }
    } catch (error) {
        console.error('❌ Error initializing population data:', error);
    }
}

// Save population data to JSON file
async function savePopulationData() {
    try {
        await fs.writeJson(DATA_FILE, populationData, { spaces: 2 });
    } catch (error) {
        console.error('❌ Error saving population data:', error);
    }
}

// Update population every second
function startPopulationGrowth() {
    setInterval(async () => {
        populationData.count += populationData.growth.rate;
        populationData.lastUpdated = Date.now();
        
        // Save to file
        await savePopulationData();
        
        // Emit to all connected clients
        io.emit('populationUpdate', populationData);
        
        console.log(`🌍 Population updated: ${populationData.count.toLocaleString()}`);
    }, populationData.growth.interval);
}

// API Routes
app.get('/api/population', (req, res) => {
    res.json(populationData);
});

app.post('/api/population', async (req, res) => {
    const { count, rate } = req.body;
    
    if (typeof count === 'number' && count >= 0) {
        populationData.count = count;
    }
    
    if (typeof rate === 'number' && rate >= 0) {
        populationData.growth.rate = rate;
    }
    
    populationData.lastUpdated = Date.now();
    await savePopulationData();
    
    // Notify all clients of the update
    io.emit('populationUpdate', populationData);
    
    res.json(populationData);
});

app.get('/api/population/reset', async (req, res) => {
    populationData.count = 1000000;
    populationData.lastUpdated = Date.now();
    await savePopulationData();
    
    io.emit('populationUpdate', populationData);
    res.json({ message: 'Population reset to 1,000,000', data: populationData });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('👤 Client connected');
    
    // Send current population data to new client
    socket.emit('populationUpdate', populationData);
    
    socket.on('disconnect', () => {
        console.log('👤 Client disconnected');
    });
    
    // Handle client requests for population data
    socket.on('getPopulation', () => {
        socket.emit('populationUpdate', populationData);
    });
});

// Serve the main HTML file for all routes (SPA behavior)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Initialize and start server
async function startServer() {
    await initializeData();
    startPopulationGrowth();
    
    server.listen(PORT, () => {
        console.log(`🚀 GridWorld server running at http://localhost:${PORT}`);
        console.log(`📊 Population management API available at /api/population`);
        console.log(`🔄 Population updates every ${populationData.growth.interval}ms`);
        console.log(`📈 Growth rate: +${populationData.growth.rate} per update`);
    });
}

startServer().catch(console.error);

console.log(`Server running at http://localhost:${PORT}/`);
console.log(`Press Ctrl+C to stop the server`);
