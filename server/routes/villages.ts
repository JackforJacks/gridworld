import express, { Router } from 'express';
import pool from '../config/database';
import * as villageSeeder from '../services/villageSeeder';
import StateManager from '../services/stateManager';
import { logError, ErrorSeverity } from '../utils/errorHandler';
import storage from '../services/storage';
import { validateBody, validateParams } from '../middleware/validate';
import {
    CreateVillageSchema,
    SeedRandomVillagesSchema,
    AssignFamilySchema,
    TileIdParamSchema,
    VillageIdParamSchema
} from '../schemas';

const router: Router = express.Router();

async function getVillagesFromRedis(filterTileId: string | number | null = null) {
    if (!storage.isAvailable()) return null;

    const villages = await StateManager.getAllVillages();
    if (!villages || villages.length === 0) return [];

    // Enrich with tile and land info from Redis
    let tileData = {};
    let landsData = {};
    try {
        tileData = await storage.hgetall('tile') || {};
        landsData = await storage.hgetall('tile:lands') || {};
    } catch (err: unknown) {
        logError(err as Error, 'VillagesRoute:FetchTileData', ErrorSeverity.MEDIUM);
        // best-effort; continue with raw villages
    }

    return villages
        .filter(v => filterTileId === null || Number(v.tile_id) === Number(filterTileId))
        .map(v => {
            const tileJson = tileData[v.tile_id];
            const tile = tileJson ? JSON.parse(tileJson) : null;
            const landsJson = landsData[v.tile_id];
            const lands = landsJson ? JSON.parse(landsJson) : null;
            const land = Array.isArray(lands)
                ? lands.find(l => Number(l.chunk_index) === Number(v.land_chunk_index))
                : null;

            return {
                ...v,
                center_x: tile ? tile.center_x : undefined,
                center_y: tile ? tile.center_y : undefined,
                terrain_type: tile ? tile.terrain_type : undefined,
                biome: tile ? tile.biome : undefined,
                land_type: land ? land.land_type : undefined,
                cleared: land ? land.cleared : undefined,
                occupied_slots: Array.isArray(v.housing_slots) ? v.housing_slots.length : undefined
            };
        });
}

// GET /api/villages - Get all villages
router.get('/', async (req, res) => {
    try {
        const redisVillages = await getVillagesFromRedis();
        if (redisVillages) {
            return res.json({ villages: redisVillages });
        }

        // Fallback to Postgres if Redis unavailable
        const { rows } = await pool.query(`
            SELECT v.*, t.center_x, t.center_y, t.terrain_type, t.biome,
                   tl.land_type, tl.cleared,
                   jsonb_array_length(v.housing_slots) as occupied_slots
            FROM villages v
            JOIN tiles t ON v.tile_id = t.id
                LEFT JOIN tiles_lands tl ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
            ORDER BY v.id
        `);
        res.json({ villages: rows });
    } catch (err: unknown) {
        console.error('Error fetching villages:', err);
        res.status(500).json({ error: 'Failed to fetch villages' });
    }
});

// GET /api/villages/tile/:tileId - Get villages for a specific tile
router.get('/tile/:tileId', validateParams(TileIdParamSchema), async (req, res) => {
    const { tileId } = req.params;
    try {
        const redisVillages = await getVillagesFromRedis(tileId);
        if (redisVillages) {
            return res.json({ villages: redisVillages });
        }

        // Fallback to Postgres if Redis unavailable
        const { rows } = await pool.query(`
            SELECT v.*, tl.land_type, tl.cleared,
                   jsonb_array_length(v.housing_slots) as occupied_slots
            FROM villages v
                LEFT JOIN tiles_lands tl ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
            WHERE v.tile_id = $1
            ORDER BY v.land_chunk_index
        `, [tileId]);
        res.json({ villages: rows });
    } catch (err: unknown) {
        console.error('Error fetching villages for tile:', err);
        res.status(500).json({ error: 'Failed to fetch villages for tile' });
    }
});

// POST /api/villages - Create a new village
router.post('/', validateBody(CreateVillageSchema), async (req, res) => {
    const { tile_id, land_chunk_index, name } = req.body;
    try {
        // Check if the land chunk is cleared and available (no need to check village_id)
        const { rows: landCheck } = await pool.query(`
            SELECT * FROM tiles_lands 
            WHERE tile_id = $1 AND chunk_index = $2 AND land_type = 'cleared'
        `, [tile_id, land_chunk_index]);
        if (landCheck.length === 0) {
            return res.status(400).json({ error: 'Land chunk is not available for a village' });
        }
        // Check if a village already exists at this location
        const { rows: existingVillage } = await pool.query(
            'SELECT * FROM villages WHERE tile_id = $1 AND land_chunk_index = $2',
            [tile_id, land_chunk_index]
        );
        if (existingVillage.length > 0) {
            return res.status(400).json({ error: 'A village already exists at this location' });
        }
        // Create the village with fixed capacity 1000
        const housingSlots = JSON.stringify([]);
        const housingCapacity = 1000;
        const { rows } = await pool.query(`
            INSERT INTO villages (tile_id, land_chunk_index, name, housing_slots, housing_capacity)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [tile_id, land_chunk_index, name, housingSlots, housingCapacity]);
        const village = rows[0];
        res.json({ village });
    } catch (err: unknown) {
        console.error('Error creating village:', err);
        res.status(500).json({ error: 'Failed to create village' });
    }
});

// POST /api/villages/seed-random - Seed a random number of villages (3..30)
router.post('/seed-random', validateBody(SeedRandomVillagesSchema), async (req, res) => {
    const requestedCount = req.body.count ?? null;
    try {
        const result = await villageSeeder.seedRandomVillages(requestedCount);
        if (!result || result.created === 0) {
            return res.status(400).json({ error: 'No available cleared land chunks to create villages' });
        }
        res.json(result);
    } catch (err: unknown) {
        console.error('Error seeding random villages:', err);
        res.status(500).json({ error: 'Failed to seed villages' });
    }
});

// POST /api/villages/seed-tile/:tileId - Seed villages for a single tile using population + random buffer
router.post('/seed-tile/:tileId', validateParams(TileIdParamSchema), async (req, res) => {
    const tileId = parseInt(req.params.tileId, 10);
    try {
        const result = await villageSeeder.seedVillagesForTile(tileId);
        if (!result || result.created === 0) {
            return res.status(400).json({ error: 'No available cleared land chunks to create villages on this tile' });
        }
        res.json(result);
    } catch (err: unknown) {
        console.error(`Error seeding villages for tile ${tileId}:`, err);
        res.status(500).json({ error: 'Failed to seed villages for tile' });
    }
});

// PUT /api/villages/:id/assign-family - Assign a family to a village
router.put('/:id/assign-family', validateParams(VillageIdParamSchema), validateBody(AssignFamilySchema), async (req, res) => {
    const { id } = req.params;
    const { family_id } = req.body;
    try {
        // Get current village
        const { rows: villageRows } = await pool.query(
            'SELECT * FROM villages WHERE id = $1',
            [id]
        );
        if (villageRows.length === 0) {
            return res.status(404).json({ error: 'Village not found' });
        }
        const village = villageRows[0];
        const currentSlots = village.housing_slots || [];
        // Check if village is full using the capacity column
        const capacity = village.housing_capacity || 100;
        if (currentSlots.length >= capacity) {
            return res.status(400).json({ error: 'Village is at full capacity' });
        }
        // Check if family is already assigned
        if (currentSlots.includes(family_id)) {
            return res.status(400).json({ error: 'Family already assigned to this village' });
        }
        // Add family to housing slots
        const updatedSlots = [...currentSlots, family_id];
        const { rows } = await pool.query(`
            UPDATE villages 
            SET housing_slots = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [JSON.stringify(updatedSlots), id]);
        res.json({ village: rows[0] });
    } catch (err: unknown) {
        console.error('Error assigning family to village:', err);
        res.status(500).json({ error: 'Failed to assign family to village' });
    }
});

// DELETE /api/villages/:id - Delete a village
router.delete('/:id', validateParams(VillageIdParamSchema), async (req, res) => {
    const { id } = req.params;
    try {
        // Just delete the village, do not update tiles_lands
        const { rowCount } = await pool.query(
            'DELETE FROM villages WHERE id = $1',
            [id]
        );
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Village not found' });
        }
        res.json({ success: true, message: 'Village deleted successfully' });
    } catch (err: unknown) {
        console.error('Error deleting village:', err);
        res.status(500).json({ error: 'Failed to delete village' });
    }
});

export default router;
