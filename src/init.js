// Initialization logic for GridWorld
import { updateDashboard } from './utils.js';

async function initializeAndStartGame() {
    console.log('Initializing and starting the game...');
    
    if (window.sceneInitialized) {
        console.log("Scene already initialized.");
        return;
    }
      // Remove the redundant createScene call - SceneManager already handles this
    // The SceneManager in main.js already created the hexasphere
    // Just update the dashboard with the existing data
    if (window.sceneManager && window.sceneManager.hexasphere) {
        // No separate tileData structure needed - properties are on tiles directly
        updateDashboard();
    }
    
    window.sceneInitialized = true;
    console.log('Game initialization complete');
}

if (typeof window !== 'undefined') {
  window.initializeAndStartGame = initializeAndStartGame;
}

export { initializeAndStartGame };
