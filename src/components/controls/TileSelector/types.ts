// TileSelector - Type Definitions
import * as THREE from 'three';

/** Tile boundary point interface */
export interface BoundaryPoint {
    x: number;
    y: number;
    z: number;
}

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
    population?: number;
    rustPopulation?: number;
    fertility?: number;
    latitude?: number | null;
    longitude?: number | null;
    lands?: LandData[];
    boundary: BoundaryPoint[];
    centerPoint: BoundaryPoint & { getLatLon?: (radius?: number) => { lat: number; lon: number } };
    getProperties?: () => Record<string, unknown>;
}

/** Hexasphere data structure */
export interface HexasphereData {
    tiles: HexTile[];
}

/** SceneManager interface (minimal for TileSelector usage) */
export interface SceneManagerLike {
    hexasphere?: HexasphereData | null;
}

/** Biome icon mapping */
export const BIOME_ICONS: Record<string, string> = {
    tundra: '🏔️',
    desert: '🏜️',
    plains: '🌾',
    grassland: '🌱',
    alpine: '⛰️'
};

/** Get fertility icon based on value */
export function getFertilityIcon(fertility: number | null): string {
    if (fertility === null) return '❓';
    if (fertility === 0) return '🪨';
    if (fertility < 30) return '🌫️';
    if (fertility < 60) return '🌿';
    if (fertility < 80) return '🌾';
    return '🌻';
}

/** Get fertility class based on value */
export function getFertilityClass(fertility: number): string {
    if (fertility === 0) return 'barren';
    if (fertility < 30) return 'poor';
    if (fertility < 60) return 'fair';
    if (fertility < 80) return 'good';
    return 'excellent';
}

// Window.THREE is set by index.ts for global access
declare global {
    interface Window {
        THREE: typeof THREE;
    }
}
