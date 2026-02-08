// Load Operations - Tile Loader Module
// Optimized with parallel queries and raw data return for batched pipeline
import pool from '../../../config/database';
import { TileRow, LandRow, LandsByTile } from './types';

/** Raw tile data for batched Redis insertion */
export interface TileLoadResult {
    tiles: TileRow[];
    tilesData: Array<{ id: string; json: string; fertility: string | null }>;
}

/** Raw land data for batched Redis insertion */
export interface LandLoadResult {
    count: number;
    landsData: Array<{ tileId: string; json: string }>;
}

/**
 * Fetch tiles from PostgreSQL (query only, no Redis writes)
 * Returns raw data for batched pipeline insertion
 */
export async function fetchTiles(): Promise<TileLoadResult> {
    const { rows: tiles } = await pool.query<TileRow>('SELECT * FROM tiles');

    const tilesData = tiles.map(t => ({
        id: t.id.toString(),
        json: JSON.stringify({
            id: t.id,
            center_x: t.center_x,
            center_y: t.center_y,
            center_z: t.center_z,
            latitude: t.latitude,
            longitude: t.longitude,
            terrain_type: t.terrain_type,
            boundary_points: t.boundary_points,
            neighbor_ids: t.neighbor_ids,
            biome: t.biome,
            fertility: t.fertility
        }),
        fertility: t.fertility !== null ? t.fertility.toString() : null
    }));

    return { tiles, tilesData };
}

/**
 * Fetch tiles_lands from PostgreSQL (query only, no Redis writes)
 * Returns grouped data for batched pipeline insertion
 */
export async function fetchTilesLands(): Promise<LandLoadResult> {
    const { rows: lands } = await pool.query<LandRow>(
        'SELECT * FROM tiles_lands ORDER BY tile_id, chunk_index'
    );

    // Group lands by tile_id
    const landsByTile: LandsByTile = {};
    for (const land of lands) {
        const tileId = land.tile_id.toString();
        if (!landsByTile[tileId]) {
            landsByTile[tileId] = [];
        }
        landsByTile[tileId].push({
            tile_id: land.tile_id,
            chunk_index: land.chunk_index,
            land_type: land.land_type,
            cleared: land.cleared,
            owner_id: land.owner_id
        });
    }

    // Pre-serialize for pipeline
    const landsData = Object.entries(landsByTile).map(([tileId, tileLands]) => ({
        tileId,
        json: JSON.stringify(tileLands)
    }));

    return { count: lands.length, landsData };
}

// Legacy functions for backward compatibility
import { Pipeline } from './types';

export async function loadTiles(pipeline: Pipeline): Promise<TileRow[]> {
    const { tiles, tilesData } = await fetchTiles();
    for (const t of tilesData) {
        pipeline.hset('tile', t.id, t.json);
        if (t.fertility !== null) {
            pipeline.hset('tile:fertility', t.id, t.fertility);
        }
    }
    return tiles;
}

export async function loadTilesLands(pipeline: Pipeline): Promise<number> {
    const { count, landsData } = await fetchTilesLands();
    for (const l of landsData) {
        pipeline.hset('tile:lands', l.tileId, l.json);
    }
    return count;
}
