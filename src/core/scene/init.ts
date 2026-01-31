// Initialization logic for GridWorld
import { updateDashboard } from '../../utils/index';
import { getAppContext } from '../AppContext';

async function initializeAndStartGame() {
  const ctx = getAppContext();
  
  if (ctx.sceneInitialized) {
    return;
  }
  // Remove the redundant createScene call - SceneManager already handles this
  // The SceneManager already created the hexasphere during initialization
  // Just update the dashboard with the existing data
  if (ctx.sceneManager && ctx.sceneManager.hexasphere) {
    // No separate tileData structure needed - properties are on tiles directly
    updateDashboard();
  }

  ctx.sceneInitialized = true;
}

export { initializeAndStartGame };
