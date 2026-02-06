// Scene Manager - Population Display
// Handles population visualization and statistics
import populationManager from '../../../managers/population/PopulationManager';
import { HexTile, HexasphereData, TileColorInfo, PopulationStats, BiomeStats } from './types';
import { TileOverlayManager } from './tileOverlays';

/** Population threshold for "high population" designation */
const HIGH_POPULATION_THRESHOLD = 10000;

/**
 * Update tile populations from population manager
 */
export function updateTilePopulations(hexasphere: HexasphereData | null): void {
    if (!hexasphere?.tiles) {
        console.warn('[SceneManager] updateTilePopulations: hexasphere not ready');
        return;
    }

    const tilePopulations = populationManager.getAllTilePopulations();
    const tiles = hexasphere.tiles;
    const tileCount = tiles.length;

    // Optimized loop with reduced property access
    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        const isHabitable = tile.Habitable === 'yes' || tile.is_habitable === true;

        if (isHabitable) {
            // Try numeric ID first, then string (most common case first)
            tile.population = tilePopulations[tile.id] ?? tilePopulations[String(tile.id)] ?? 0;
        } else {
            tile.population = 0;
        }
    }
}

/**
 * Check population thresholds and rebuild merged overlay
 * Collects all populated tiles and rebuilds overlay in single draw call
 */
export function checkPopulationThresholds(
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>,
    overlayManager: TileOverlayManager
): void {
    if (!hexasphere?.tiles) return;

    const tiles = hexasphere.tiles;
    const tileCount = tiles.length;
    const populatedTiles: HexTile[] = [];

    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];

        // Early continue for non-habitable tiles
        if (tile.Habitable !== 'yes') continue;

        const population = tile.population ?? 0;
        const tileIdStr = String(tile.id);
        const colorInfo = tileColorIndices.get(tileIdStr);
        if (!colorInfo) continue;

        // Track state and collect populated tiles for overlay
        colorInfo.isHighlighted = population > 0;
        if (population > 0) {
            populatedTiles.push(tile);
        }
    }

    // Rebuild merged overlay with all populated tiles (single draw call)
    overlayManager.rebuild(populatedTiles);
}

/**
 * Reset all tile colors and populations
 */
export function resetTileColors(
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>,
    overlayManager: TileOverlayManager
): void {
    if (!hexasphere?.tiles) return;

    // Clear merged overlay (single operation)
    overlayManager.clear();

    for (const tile of hexasphere.tiles) {
        const colorInfo = tileColorIndices.get(String(tile.id));
        if (colorInfo && colorInfo.isHighlighted) {
            colorInfo.isHighlighted = false;
            colorInfo.currentColor = colorInfo.originalColor.clone();
        }
        tile.population = 0;
    }
}

/**
 * Get population statistics
 */
export function getPopulationStats(
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>
): PopulationStats | { error: string } {
    if (!hexasphere?.tiles) return { error: 'No hexasphere data available' };

    const tiles = hexasphere.tiles;
    const tileCount = tiles.length;

    let habitableTiles = 0;
    let populatedTiles = 0;
    let highPopulationTiles = 0;
    let redTiles = 0;

    // Initialize biome statistics
    const biomes: Record<string, BiomeStats> = {
        tundra: { tiles: 0, population: 0 },
        desert: { tiles: 0, population: 0 },
        plains: { tiles: 0, population: 0 },
        grassland: { tiles: 0, population: 0 },
        alpine: { tiles: 0, population: 0 }
    };

    // Single optimized pass
    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        const population = tile.population || 0;
        const biome = tile.biome;

        if (tile.Habitable === 'yes') {
            habitableTiles++;
            if (population > 0) populatedTiles++;
            if (population >= HIGH_POPULATION_THRESHOLD) highPopulationTiles++;
            const colorInfo = tileColorIndices.get(String(tile.id));
            if (colorInfo?.isHighlighted) redTiles++;
        }

        // Count biome statistics
        if (biome && biomes[biome]) {
            biomes[biome].tiles++;
            biomes[biome].population += population;
        }
    }

    return {
        totalTiles: tileCount,
        habitableTiles,
        populatedTiles,
        highPopulationTiles,
        redTiles,
        threshold: HIGH_POPULATION_THRESHOLD,
        biomes
    };
}

/**
 * Initialize tile populations from server
 */
export async function initializeTilePopulations(
    habitableTileIds: (number | string)[],
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>,
    overlayManager: TileOverlayManager
): Promise<void> {
    try {
        const tileIdStrings = habitableTileIds.map(id => String(id));
        await populationManager.initializeTilePopulations(tileIdStrings);
        updateTilePopulations(hexasphere);
        checkPopulationThresholds(hexasphere, tileColorIndices, overlayManager);
    } catch (error: unknown) {
        console.error('❌ Failed to initialize tile populations:', error);
        throw error;
    }
}

/**
 * Reinitialize population for existing tiles
 */
export async function reinitializePopulation(
    hexasphere: HexasphereData | null,
    habitableTileIds: (number | string)[],
    tileColorIndices: Map<string, TileColorInfo>,
    overlayManager: TileOverlayManager
): Promise<(number | string)[]> {
    // Ensure habitableTileIds is populated
    let ids = habitableTileIds;
    if (!ids || ids.length === 0) {
        if (hexasphere?.tiles) {
            ids = hexasphere.tiles
                .filter((t: HexTile) => t.Habitable === 'yes')
                .map((t: HexTile) => t.id);
        }
    }

    if (!ids || ids.length === 0) {
        console.error('❌ No habitable tiles found to reinitialize population.');
        return [];
    }

    try {
        const tileIdStrings = ids.map(id => String(id));
        await populationManager.initializeTilePopulations(tileIdStrings);
        updateTilePopulations(hexasphere);
        checkPopulationThresholds(hexasphere, tileColorIndices, overlayManager);
    } catch (error: unknown) {
        console.error('❌ Failed to reinitialize population:', error);
    }

    return ids;
}
