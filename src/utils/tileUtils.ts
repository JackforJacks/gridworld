// Tile property derivation utilities
// These replace stored isLand/Habitable fields - derived from terrainType + biome

const UNINHABITABLE_TERRAIN = ['ocean', 'mountains'];
const UNINHABITABLE_BIOMES = ['desert', 'tundra', 'alpine'];

export function isLandTerrain(terrainType: string): boolean {
    return terrainType !== 'ocean';
}

export function isHabitable(terrainType: string, biome: string | null | undefined): boolean {
    if (UNINHABITABLE_TERRAIN.includes(terrainType)) return false;
    if (biome && UNINHABITABLE_BIOMES.includes(biome)) return false;
    return true;
}
