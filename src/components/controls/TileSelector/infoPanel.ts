// TileSelector - Info Panel Rendering
// Handles tile information display in the info panel
import { HexTile, LandData, BIOME_ICONS, getFertilityIcon, getFertilityClass } from './types';

/**
 * Calculate lat/lon from tile center point
 */
export function calculateLatLon(tile: HexTile): { lat: number; lon: number } {
    // Use stored values if available
    if (tile.latitude != null && tile.longitude != null) {
        return { lat: tile.latitude, lon: tile.longitude };
    }

    // Use getLatLon method if available
    if (tile.centerPoint?.getLatLon) {
        return tile.centerPoint.getLatLon(1);
    }

    // Calculate from center point coordinates
    if (tile.centerPoint) {
        const { x, y, z } = tile.centerPoint;
        const r = Math.sqrt(x * x + y * y + z * z);
        return {
            lat: Math.asin(y / r) * 180 / Math.PI,
            lon: Math.atan2(z, x) * 180 / Math.PI
        };
    }

    return { lat: 0, lon: 0 };
}

/**
 * Count land types in tile
 */
export function countLandTypes(lands: LandData[] | undefined): { forested: number; waste: number; cleared: number } {
    if (!Array.isArray(lands)) {
        return { forested: 0, waste: 0, cleared: 0 };
    }
    return {
        forested: lands.filter(l => l.land_type === 'forest').length,
        waste: lands.filter(l => l.land_type === 'wasteland').length,
        cleared: lands.filter(l => l.land_type === 'cleared').length
    };
}

/**
 * Generate HTML content for the info panel page 1
 */
export function generateInfoPanelHTML(tile: HexTile): string {
    const terrainType = tile.terrainType || 'unknown';
    const habitable = tile.Habitable || 'unknown';
    const population = tile.population || 0;
    const populationDisplay = population > 0 ? population.toLocaleString() : 'Uninhabited';
    const biome = tile.biome || null;
    const fertility = tile.fertility ?? null;
    const landCounts = countLandTypes(tile.lands);

    const biomeDisplay = biome
        ? `${BIOME_ICONS[biome] || '🌍'} ${biome.charAt(0).toUpperCase() + biome.slice(1)}`
        : 'N/A';

    const fertilityDisplay = fertility !== null ? `${fertility}/100` : 'N/A';
    const fertilityIcon = getFertilityIcon(fertility);

    return `
        <div class="tile-info-row">
            <span class="label">Terrain:</span>
            <span class="value terrain-${terrainType.toLowerCase()}">${terrainType}</span>
        </div>
        ${biome ? `
        <div class="tile-info-row">
            <span class="label">Biome:</span>
            <span class="value biome-${biome}">${biomeDisplay}</span>
        </div>
        ` : ''}
        ${tile.lands?.length ? `
        <div class="tile-info-row">
            <span class="label">Land:</span>
            <span class="value">🌲 ${landCounts.forested} | 🏜️ ${landCounts.waste} | 🌱 ${landCounts.cleared}</span>
        </div>
        ` : ''}
        ${fertility !== null ? `
        <div class="tile-info-row">
            <span class="label">Fertility:</span>
            <span class="value fertility-${getFertilityClass(fertility)}">${fertilityIcon} ${fertilityDisplay}</span>
        </div>
        ` : ''}
        <div class="tile-info-row">
            <span class="label">Population:</span>
            <span class="value population-${population > 0 ? 'inhabited' : 'uninhabited'}">${populationDisplay}</span>
        </div>
        <div class="tile-info-row">
            <span class="label">Habitable:</span>
            <span class="value Habitable-${habitable}">${habitable}</span>
        </div>
    `;
}

/**
 * Update the info panel with tile data
 */
export function updateInfoPanel(panel: HTMLElement, tile: HexTile): void {
    const titleEl = panel.querySelector('#tileInfoTitle');
    if (titleEl) titleEl.textContent = `Tile ${tile.id}`;

    const contentDiv = panel.querySelector('#info-panel-page-1');
    if (contentDiv) {
        contentDiv.innerHTML = generateInfoPanelHTML(tile);
    }
}
