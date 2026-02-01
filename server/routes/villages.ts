import express, { Router } from 'express';
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
import idAllocator from '../services/idAllocator';

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
        if (!storage.isAvailable()) {
            return res.status(503).json({ error: 'Storage not available' });
        }
        const redisVillages = await getVillagesFromRedis();
        return res.json({ villages: redisVillages || [] });
    } catch (err: unknown) {
        console.error('Error fetching villages:', err);
        res.status(500).json({ error: 'Failed to fetch villages' });
    }
});

// GET /api/villages/tile/:tileId - Get villages for a specific tile
router.get('/tile/:tileId', validateParams(TileIdParamSchema), async (req, res) => {
    const { tileId } = req.params;
    try {
        if (!storage.isAvailable()) {
            return res.status(503).json({ error: 'Storage not available' });
        }
        const redisVillages = await getVillagesFromRedis(tileId);
        return res.json({ villages: redisVillages || [] });
    } catch (err: unknown) {
        console.error('Error fetching villages for tile:', err);
        res.status(500).json({ error: 'Failed to fetch villages for tile' });
    }
});

// POST /api/villages - Create a new village (Redis-only)
router.post('/', validateBody(CreateVillageSchema), async (req, res) => {
    const { tile_id, land_chunk_index, name } = req.body;
    try {
        if (!storage.isAvailable()) {
            return res.status(503).json({ error: 'Storage not available' });
        }

        // Check if the land chunk is cleared and available from Redis
        const landsJson = await storage.hget('tile:lands', tile_id.toString());
        if (!landsJson) {
            return res.status(400).json({ error: 'Tile lands data not found' });
        }
        const lands = JSON.parse(landsJson);
        const land = Array.isArray(lands) ? lands.find((l: any) => l.chunk_index === land_chunk_index) : null;
        if (!land || land.land_type !== 'cleared') {
            return res.status(400).json({ error: 'Land chunk is not available for a village' });
        }

        // Check if a village already exists at this location
        const existingVillages = await StateManager.getAllVillages();
        const existingVillage = existingVillages.find(
            (v: any) => v.tile_id === tile_id && v.land_chunk_index === land_chunk_index
        );
        if (existingVillage) {
            return res.status(400).json({ error: 'A village already exists at this location' });
        }

        // Create the village with fixed capacity 1000
        const villageId = await idAllocator.getNextVillageId();
        const village = {
            id: villageId,
            tile_id,
            land_chunk_index,
            name: name || `Village ${villageId}`,
            housing_slots: [],
            housing_capacity: 1000,
            food_stores: 10000,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        await storage.hset('village', villageId.toString(), JSON.stringify(village));
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

// PUT /api/villages/:id/assign-family - Assign a family to a village (Redis-only)
router.put('/:id/assign-family', validateParams(VillageIdParamSchema), validateBody(AssignFamilySchema), async (req, res) => {
    const { id } = req.params;
    const { family_id } = req.body;
    try {
        if (!storage.isAvailable()) {
            return res.status(503).json({ error: 'Storage not available' });
        }

        // Get current village from Redis
        const villageJson = await storage.hget('village', id);
        if (!villageJson) {
            return res.status(404).json({ error: 'Village not found' });
        }
        const village = JSON.parse(villageJson);
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
        village.housing_slots = [...currentSlots, family_id];
        village.updated_at = new Date().toISOString();
        
        await storage.hset('village', id, JSON.stringify(village));
        res.json({ village });
    } catch (err: unknown) {
        console.error('Error assigning family to village:', err);
        res.status(500).json({ error: 'Failed to assign family to village' });
    }
});

// DELETE /api/villages/:id - Delete a village (Redis-only)
router.delete('/:id', validateParams(VillageIdParamSchema), async (req, res) => {
    const { id } = req.params;
    try {
        if (!storage.isAvailable()) {
            return res.status(503).json({ error: 'Storage not available' });
        }

        // Check if village exists
        const villageJson = await storage.hget('village', id);
        if (!villageJson) {
            return res.status(404).json({ error: 'Village not found' });
        }
        
        // Delete the village from Redis
        await storage.hdel('village', id);
        res.json({ success: true, message: 'Village deleted successfully' });
    } catch (err: unknown) {
        console.error('Error deleting village:', err);
        res.status(500).json({ error: 'Failed to delete village' });
    }
});

export default router;
