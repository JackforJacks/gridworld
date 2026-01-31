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
    village_id?: number | null;
    village_name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_slots?: number[];
    housing_capacity?: number;
    occupied_slots?: number;
}

/** Tile interface for the hexasphere tiles */
export interface HexTile {
    id: number | string;
    Habitable?: string;
    is_habitable?: boolean;
    terrainType?: string;
    biome?: string;
    population?: number;
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

/** Village data from API */
export interface VillageApiData {
    id?: number | null;
    tile_id?: number;
    land_chunk_index?: number;
    village_name?: string;
    name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_slots?: number[];
    housing_capacity?: number;
    occupied_slots?: number;
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

// Extend Window interface for global properties
declare global {
    interface Window {
        THREE: typeof THREE;
        currentTiles?: THREE.Mesh[];
        sceneManager?: SceneManagerLike;
        __tileSelectorJustClosed?: number;
        __tileSelectorDebug?: boolean;
        __tileSelectorCloseHandlerAttached?: boolean;
    }
}
