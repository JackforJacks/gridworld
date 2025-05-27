// Main Application Entry Point - Modularized GridWorld
// Coordinates all modules and initializes the application

const { fetchTileDataFromServer, postInitialDataToServer, clearServerData, exportTileDataToServer } = require('../utils/data');
const { initializeAndStartGame } = require('./init');
const CameraController = require('../managers/camera-controller');
const InputHandler = require('../utils/input-handler');
const TileSelector = require('./tile-selector');
const SceneManager = require('../managers/scene-manager');
const UIManager = require('../managers/ui-manager');

// ...existing code...

module.exports = GridWorldApp;
