// Utility functions for GridWorld

import { getAppContext } from '../core/AppContext';
import { isLandTerrain } from './tileUtils';

// Define terrain colors and land function globally
const terrainColors = {
    ocean: 0x4A90E2,      // Light blue
    flats: 0xDAA520,      // Golden rod (yellow-brown)
    hills: 0xDEB887,      // Burlywood (very light brown)
    mountains: 0x8B4513   // Saddle brown (brown)
};

// Define biome colors for the new biome-based coloration system
const biomeColors = {
    desert: 0xF4A460,     // Sandy brown for desert
    tundra: 0xFFFFFF,     // Pure white for tundra (maximum visibility)
    grassland: 0x4CAF50,  // Grass green for grassland
    plains: 0x8FBC8F,     // Dark sea green (brownish green) for plains
    alpine: 0x8B4513,     // Dark brown for alpine (mountains)
    ocean: 0x4A90E2      // Keep ocean blue for water tiles
};

// Simple dashboard update function (non-ECSY)
function updateDashboard() {
    // Use AppContext to get tiles - single source of truth
    const ctx = getAppContext();
    const tiles = ctx.getHexasphereTiles();

    if (!tiles || tiles.length === 0) {
        return;
    }

    let landTileCount = 0;

    (tiles as Array<{ terrainType?: string }>).forEach((tile) => {
        if (isLandTerrain(tile.terrainType || 'unknown')) {
            landTileCount++;
        }
    });
    const landTileCountDisplay = document.getElementById('landTileCountDisplay');
    if (landTileCountDisplay) {
        landTileCountDisplay.textContent = landTileCount.toLocaleString();
    }
}

export { updateDashboard, terrainColors, biomeColors };
