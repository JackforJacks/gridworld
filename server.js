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
    globalData: {
        lastUpdated: Date.now(),
        growth: {
            rate: 1, // Population grows by 1 per tile per interval
            interval: 3000 // Update every 3000ms (3 seconds)
        }
    },
    tilePopulations: {} // Will store population for each habitable tile: { tileId: population }
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

// Update population every interval
function startPopulationGrowth() {
    setInterval(async () => {
        // Grow population for each habitable tile
        const habitableTileIds = Object.keys(populationData.tilePopulations);

        habitableTileIds.forEach(tileId => {
            // Each tile grows by the growth rate
            populationData.tilePopulations[tileId] += populationData.globalData.growth.rate;
        });

        populationData.globalData.lastUpdated = Date.now();

        // Save to file
        await savePopulationData();        // Emit to all connected clients
        io.emit('populationUpdate', {
            globalData: populationData.globalData,
            tilePopulations: populationData.tilePopulations,
            totalPopulation: getTotalPopulation()
        });

        // Population grows silently - no console logging
    }, populationData.globalData.growth.interval);
}

// Helper function to calculate total population
function getTotalPopulation() {
    return Object.values(populationData.tilePopulations).reduce((total, pop) => total + pop, 0);
}

// API Routes
app.get('/api/population', (req, res) => {
    res.json({
        globalData: populationData.globalData,
        tilePopulations: populationData.tilePopulations,
        totalPopulation: getTotalPopulation()
    });
});

app.post('/api/population', async (req, res) => {
    const { rate, tilePopulations } = req.body;

    if (typeof rate === 'number' && rate >= 0) {
        populationData.globalData.growth.rate = rate;
    }

    if (tilePopulations && typeof tilePopulations === 'object') {
        populationData.tilePopulations = { ...populationData.tilePopulations, ...tilePopulations };
    }

    populationData.globalData.lastUpdated = Date.now();
    await savePopulationData();

    // Notify all clients of the update
    const responseData = {
        globalData: populationData.globalData,
        tilePopulations: populationData.tilePopulations,
        totalPopulation: getTotalPopulation()
    };
    io.emit('populationUpdate', responseData);

    res.json(responseData);
});

// New endpoint to initialize tile populations
app.post('/api/population/initialize', async (req, res) => {
    const { habitableTiles } = req.body;

    if (!habitableTiles || !Array.isArray(habitableTiles)) {
        return res.status(400).json({ error: 'habitableTiles array is required' });
    }

    // Initialize population for each habitable tile
    habitableTiles.forEach(tileId => {
        if (!(tileId in populationData.tilePopulations)) {
            // Start with random population between 1000-10000 for each tile
            populationData.tilePopulations[tileId] = Math.floor(Math.random() * 9000) + 1000;
        }
    });

    populationData.globalData.lastUpdated = Date.now();
    await savePopulationData();

    const responseData = {
        globalData: populationData.globalData,
        tilePopulations: populationData.tilePopulations,
        totalPopulation: getTotalPopulation(),
        message: `Initialized population for ${habitableTiles.length} habitable tiles`
    };

    io.emit('populationUpdate', responseData);
    res.json(responseData);
});

app.get('/api/population/reset', async (req, res) => {
    populationData.tilePopulations = {};
    populationData.globalData.lastUpdated = Date.now();
    await savePopulationData();

    const responseData = {
        globalData: populationData.globalData,
        tilePopulations: populationData.tilePopulations,
        totalPopulation: 0
    };

    io.emit('populationUpdate', responseData);
    res.json({ message: 'All tile populations reset', data: responseData });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('👤 Client connected');

    // Send current population data to new client
    const currentData = {
        globalData: populationData.globalData,
        tilePopulations: populationData.tilePopulations,
        totalPopulation: getTotalPopulation()
    };
    socket.emit('populationUpdate', currentData);

    socket.on('disconnect', () => {
        console.log('👤 Client disconnected');
    });

    // Handle client requests for population data
    socket.on('getPopulation', () => {
        const currentData = {
            globalData: populationData.globalData,
            tilePopulations: populationData.tilePopulations,
            totalPopulation: getTotalPopulation()
        };
        socket.emit('populationUpdate', currentData);
    });
});

// Serve the main HTML file for all routes (SPA behavior)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Initialize and start server
async function startServer() {
    await initializeData();
    startPopulationGrowth(); // Re-enabled automatic population growth

    server.listen(PORT, () => {
        console.log(`🚀 GridWorld server running at http://localhost:${PORT}`);
    });
}

startServer().catch(console.error);

console.log(`Server running at http://localhost:${PORT}/`);
console.log(`Press Ctrl+C to stop the server`);
