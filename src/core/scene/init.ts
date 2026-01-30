// Initialization logic for GridWorld
import { updateDashboard } from '../../utils/index';

async function initializeAndStartGame() {

  if (window.sceneInitialized) {
    return;
  }
  // Remove the redundant createScene call - SceneManager already handles this
  // The SceneManager already created the hexasphere during initialization
  // Just update the dashboard with the existing data
  if (window.sceneManager && window.sceneManager.hexasphere) {
    // No separate tileData structure needed - properties are on tiles directly
    updateDashboard();
  }

  window.sceneInitialized = true;
}

if (typeof window !== 'undefined') {
  window.initializeAndStartGame = initializeAndStartGame;
}

export { initializeAndStartGame };
