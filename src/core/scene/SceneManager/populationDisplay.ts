// Scene Manager - Population Display
// Handles population visualization and statistics
import populationManager from '../../../managers/population/PopulationManager';
import { HexTile, HexasphereData, TileColorInfo, PopulationStats, BiomeStats } from './types';
import { isHabitable } from '../../../utils/tileUtils';

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

    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        if (isHabitable(tile.terrainType || 'unknown', tile.biome)) {
            tile.population = tilePopulations[tile.id] ?? tilePopulations[String(tile.id)] ?? 0;
        } else {
            tile.population = 0;
        }
    }
}

/**
 * Check population thresholds and update color info.
 */
export function checkPopulationThresholds(
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>
): void {
    if (!hexasphere?.tiles) return;

    const tiles = hexasphere.tiles;
    const tileCount = tiles.length;

    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];

        if (!isHabitable(tile.terrainType || 'unknown', tile.biome)) continue;

        const population = tile.population ?? 0;
        const tileIdStr = String(tile.id);
        const colorInfo = tileColorIndices.get(tileIdStr);
        if (!colorInfo) continue;

        colorInfo.isHighlighted = population > 0;
    }
}

/**
 * Reset all tile colors and populations
 */
export function resetTileColors(
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>
): void {
    if (!hexasphere?.tiles) return;

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

    const biomes: Record<string, BiomeStats> = {
        tundra: { tiles: 0, population: 0 },
        desert: { tiles: 0, population: 0 },
        plains: { tiles: 0, population: 0 },
        grassland: { tiles: 0, population: 0 },
        alpine: { tiles: 0, population: 0 }
    };

    for (let i = 0; i < tileCount; i++) {
        const tile = tiles[i];
        const population = tile.population || 0;
        const biome = tile.biome;

        if (isHabitable(tile.terrainType || 'unknown', tile.biome)) {
            habitableTiles++;
            if (population > 0) populatedTiles++;
            if (population >= HIGH_POPULATION_THRESHOLD) highPopulationTiles++;
            const colorInfo = tileColorIndices.get(String(tile.id));
            if (colorInfo?.isHighlighted) redTiles++;
        }

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
    _habitableTileIds: (number | string)[],
    hexasphere: HexasphereData | null,
    tileColorIndices: Map<string, TileColorInfo>
): Promise<void> {
    try {
        await populationManager.refreshTilePopulations();
        updateTilePopulations(hexasphere);
        checkPopulationThresholds(hexasphere, tileColorIndices);
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
    tileColorIndices: Map<string, TileColorInfo>
): Promise<(number | string)[]> {
    let ids = habitableTileIds;
    if (!ids || ids.length === 0) {
        if (hexasphere?.tiles) {
            ids = hexasphere.tiles
                .filter((t: HexTile) => isHabitable(t.terrainType || 'unknown', t.biome))
                .map((t: HexTile) => t.id);
        }
    }

    if (!ids || ids.length === 0) {
        console.error('❌ No habitable tiles found to reinitialize population.');
        return [];
    }

    try {
        await populationManager.refreshTilePopulations();
        updateTilePopulations(hexasphere);
        checkPopulationThresholds(hexasphere, tileColorIndices);
    } catch (error: unknown) {
        console.error('❌ Failed to reinitialize population:', error);
    }

    return ids;
}
