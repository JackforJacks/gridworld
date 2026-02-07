/**
 * Global Type Definitions for GridWorld
 * Shared types across the application
 */

import * as THREE from 'three';
import { Pool, PoolClient } from 'pg';
import { Redis } from 'ioredis';

// Re-export for convenience
export { Pool, PoolClient, Redis };

/**
 * Environment configuration
 */
export interface EnvironmentConfig {
    NODE_ENV: string;
    PORT: string;
    PGHOST: string;
    PGPORT: string;
    PGUSER: string;
    PGPASSWORD: string;
    PGDATABASE: string;
    REDIS_HOST: string;
    REDIS_PORT: string;
    REDIS_PASSWORD?: string;
    [key: string]: string | undefined;
}

/**
 * Terrain types available in the game
 */
export type TerrainType =
    | 'ocean'
    | 'grassland'
    | 'forest'
    | 'desert'
    | 'mountain'
    | 'tundra'
    | 'ice';

/**
 * Tile data structure from server
 */
export interface TileData {
    id: number;
    center_x: number;
    center_y: number;
    center_z: number;
    latitude: number;
    longitude: number;
    terrain_type: TerrainType;
    boundary_points: Array<{ x: number, y: number, z: number }>;
    neighbor_ids: number[];
    biome?: string;
    fertility?: number;
    population?: number;
}

/**
 * Village data structure
 */
export interface VillageData {
    id: number;
    tile_id: number;
    land_chunk_index: number;
    name: string;
    housing_slots: number[];
    housing_capacity: number;
    food_stores: number;
    food_capacity: number;
    food_production_rate: number;
}

/**
 * Person data structure
 */
export interface PersonData {
    id: number;
    tile_id: number | null;
    sex: boolean; // true=male, false=female
    date_of_birth: string;
    residency: number | null;
    family_id: number | null;
    village_id?: number;
}

/**
 * Family data structure
 */
export interface FamilyData {
    id: number;
    husband_id: number | null;
    wife_id: number | null;
    tile_id: number;
    pregnancy: boolean;
    delivery_date: string | null;
    children_ids: number[];
}

/**
 * Calendar date structure
 */
export interface CalendarDate {
    year: number;
    month: number;
    day: number;
}

/**
 * Population statistics
 */
export interface PopulationStats {
    totalPopulation: number;
    males: number;
    females: number;
    averageAge: number;
    birthRate?: number;
    deathRate?: number;
}

/**
 * Scene configuration for 3D rendering
 */
export interface SceneConfig {
    radius: number;
    subdivisions: number;
    tileWidthRatio: number;
    scene: THREE.Scene;
    currentTiles: THREE.Mesh[];
    terrainColors: Record<TerrainType, number>;
    renderer: THREE.Renderer;
    camera: THREE.Camera;
    tileData: TileData[];
    updateDashboardCallback?: (data: TileData[]) => void;
}

/**
 * Rotation state
 */
export interface RotationState {
    x: number;
    y: number;
}

/**
 * Database error with context
 */
export interface DatabaseError extends Error {
    name: 'DatabaseError';
    originalError: Error | null;
    timestamp: string;
}

/**
 * Repository transaction client
 */
export interface TransactionClient {
    query: (sql: string, params?: any[]) => Promise<any>;
}

declare global {
    interface Window {
        // Legacy window references - maintained for backward compatibility during transition
        // New code should use AppContext singleton instead (src/core/AppContext.ts)
        sceneManager?: {
            hexasphere?: { tiles: unknown[] } | null;
        };
        tileSelector?: {
            selectedTile?: unknown;
            hideInfoPanel?: () => void;
            deselectAll?: () => void;
        };
        // Deprecated: Use AppContext instead
        hexasphere?: {
            mesh: THREE.Mesh;
        };
    }
}
