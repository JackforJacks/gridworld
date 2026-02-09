// Utility functions for GridWorld

import { getAppContext } from '../core/AppContext';
import { isLandTerrain } from './tileUtils';

// Re-export color definitions from centralized module
import { terrainColors, biomeColors } from './colors';

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

/**
 * Force all WebGL contexts on the page to lose their context.
 * Used during cleanup to prevent GPU memory retention.
 */
function loseAllWebGLContexts(): void {
    document.querySelectorAll('canvas').forEach(canvas => {
        const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
        if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context');
            if (ext) ext.loseContext();
        }
    });
}

export { updateDashboard, terrainColors, biomeColors, loseAllWebGLContexts };
