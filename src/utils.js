// Utility functions for GridWorld

// Define terrain colors and land function globally
const terrainColors = {
    ocean: 0x0066cc,
    grassland: 0x66cc66,
    forest: 0x228b22,
    desert: 0xffd700,
    mountain: 0x8b7355,
    tundra: 0xe0e0e0
};

const isLand = function(centerPoint) {
    // Simple land/ocean determination - you can make this more sophisticated
    const y = centerPoint.y;
    const randomFactor = Math.random();
    return y > -0.3 && randomFactor > 0.4; // Roughly 60% chance of land if above certain Y
};

// Simple dashboard update function (non-ECSY)
function updateDashboard() {
    // Use SceneManager hexasphere tiles directly - single source of truth
    if (!window.sceneManager || !window.sceneManager.hexasphere || !window.sceneManager.hexasphere.tiles) {
        return;
    }
    
    const tiles = window.sceneManager.hexasphere.tiles;
    let totalTiles = tiles.length;
    let landTileCount = 0;
    
    tiles.forEach(tile => {
        // Use tile properties directly - no separate data structure needed!
        if (tile.isLand === true || (tile.isLand === null && isLand(tile.centerPoint))) {
            landTileCount++;
        }
    });
      const landTileCountDisplay = document.getElementById('landTileCountDisplay');
    if (landTileCountDisplay) {
        landTileCountDisplay.textContent = landTileCount.toLocaleString();
    }
}

export { updateDashboard, terrainColors, isLand };
