// Shared type definitions for GridWorld
// Single source of truth - replaces duplicate definitions in SceneManager/types.ts and TileSelector/types.ts
import * as THREE from 'three';

// ============ Geometry Types ============

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

// ============ Tile Types ============

/** Land data within a tile */
export interface LandData {
    land_type?: string;
    cleared?: boolean;
    chunk_index?: number;
}

/** Tile interface for the hexasphere tiles */
export interface HexTile {
    id: number | string;
    terrainType?: string;
    biome?: string;
    fertility?: number;
    population?: number;
    rustPopulation?: number;
    latitude?: number | null;
    longitude?: number | null;
    lands?: LandData[];
    boundary: BoundaryPoint[];
    centerPoint: BoundaryPoint & { getLatLon?: (radius?: number) => { lat: number; lon: number } };
    getProperties?: () => Record<string, unknown>;
}

/** Hexasphere-like object */
export interface HexasphereData {
    tiles: HexTile[];
}

/** Server tile data response */
export interface TileDataResponse {
    tiles: HexTile[];
}

// ============ Color/Display Types ============

/** Color info for tile color tracking */
export interface TileColorInfo {
    originalColor: THREE.Color;
    currentColor: THREE.Color;
    isHighlighted: boolean;
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

/** View mode types for tile visualization */
export type ViewMode = 'terrain' | 'biome' | 'fertility' | 'population';

// ============ Interface-Only Types (avoid circular deps) ============

/** SceneManager interface (minimal for components that need it) */
export interface SceneManagerLike {
    hexasphere?: HexasphereData | null;
}

// ============ Tile Helper Constants & Functions ============

/** Biome icon mapping */
export const BIOME_ICONS: Record<string, string> = {
    tundra: '\u{1F3D4}\uFE0F',
    desert: '\u{1F3DC}\uFE0F',
    plains: '\u{1F33E}',
    grassland: '\u{1F331}',
    alpine: '\u26F0\uFE0F'
};

/** Get fertility icon based on value */
export function getFertilityIcon(fertility: number | null): string {
    if (fertility === null) return '\u2753';
    if (fertility === 0) return '\u{1FAA8}';
    if (fertility < 30) return '\u{1F32B}\uFE0F';
    if (fertility < 60) return '\u{1F33F}';
    if (fertility < 80) return '\u{1F33E}';
    return '\u{1F33B}';
}

/** Get fertility class based on value */
export function getFertilityClass(fertility: number): string {
    if (fertility === 0) return 'barren';
    if (fertility < 30) return 'poor';
    if (fertility < 60) return 'fair';
    if (fertility < 80) return 'good';
    return 'excellent';
}

// ============ Global Window Extensions ============

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
