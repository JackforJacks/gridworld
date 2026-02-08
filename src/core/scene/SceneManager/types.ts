// Scene Manager - Type Definitions
import * as THREE from 'three';

/** Tile boundary point interface - supports both object and array formats */
export interface BoundaryPoint {
    x: number;
    y: number;
    z: number;
}

/** Compact boundary point as array [x, y, z] */
export type CompactPoint = [number, number, number];

/** Boundary point can be object or array format */
export type AnyPoint = BoundaryPoint | CompactPoint;

/** Tile interface for the hexasphere tiles */
export interface HexTile {
    id: number | string;
    terrainType?: string;
    biome?: string;
    population?: number;
    boundary: BoundaryPoint[];
    centerPoint: BoundaryPoint & { getLatLon?: () => { lat: number; lon: number } };
    getProperties?: () => Record<string, unknown>;
}

/** Color info for tile color tracking */
export interface TileColorInfo {
    originalColor: THREE.Color;
    currentColor: THREE.Color;
    isHighlighted: boolean;
}

/** Hexasphere-like object */
export interface HexasphereData {
    tiles: HexTile[];
}

/** Server tile data response */
export interface TileDataResponse {
    tiles: HexTile[];
}

/** Population event data type */
export type PopulationEventType = 'populationUpdate' | string;

/** Biome statistics */
export interface BiomeStats {
    tiles: number;
    population: number;
}

/** Population statistics result */
export interface PopulationStats {
    totalTiles: number;
    habitableTiles: number;
    populatedTiles: number;
    highPopulationTiles: number;
    redTiles: number;
    threshold: number;
    biomes: Record<string, BiomeStats>;
}

/** Tile properties result */
export interface TileProperties {
    terrainType: string;
    lat: number;
    lon: number;
}

// Extend Window interface for global properties
declare global {
    interface Window {
        THREE: typeof THREE;
        currentTiles?: THREE.Mesh[];
        GridWorldApp?: {
            calendarManager?: {
                updateState: (state: unknown) => void;
            };
            calendarDisplay?: {
                updateDateDisplay: (state: unknown) => void;
            };
        };
    }
}
