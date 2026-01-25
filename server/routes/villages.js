const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const villageSeeder = require('../services/villageSeeder');

// GET /api/villages - Get all villages
router.get('/', async (req, res) => {
    try {
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
    } catch (err) {
        console.error('Error fetching villages:', err);
        res.status(500).json({ error: 'Failed to fetch villages' });
    }
});

// GET /api/villages/tile/:tileId - Get villages for a specific tile
router.get('/tile/:tileId', async (req, res) => {
    const { tileId } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT v.*, tl.land_type, tl.cleared,
                   jsonb_array_length(v.housing_slots) as occupied_slots
            FROM villages v
                LEFT JOIN tiles_lands tl ON v.tile_id = tl.tile_id AND v.land_chunk_index = tl.chunk_index
            WHERE v.tile_id = $1
            ORDER BY v.land_chunk_index
        `, [tileId]);
        res.json({ villages: rows });
    } catch (err) {
        console.error('Error fetching villages for tile:', err);
        res.status(500).json({ error: 'Failed to fetch villages for tile' });
    }
});

// POST /api/villages - Create a new village
router.post('/', async (req, res) => {
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
        `, [tile_id, land_chunk_index, name || 'Village', housingSlots, housingCapacity]);
        const village = rows[0];
        res.json({ village });
    } catch (err) {
        console.error('Error creating village:', err);
        res.status(500).json({ error: 'Failed to create village' });
    }
});

// POST /api/villages/seed-random - Seed a random number of villages (3..30)
router.post('/seed-random', async (req, res) => {
    const requestedCount = req.body && req.body.count ? parseInt(req.body.count, 10) : null;
    try {
        const result = await villageSeeder.seedRandomVillages(requestedCount);
        if (!result || result.created === 0) {
            return res.status(400).json({ error: 'No available cleared land chunks to create villages' });
        }
        res.json(result);
    } catch (err) {
        console.error('Error seeding random villages:', err);
        res.status(500).json({ error: 'Failed to seed villages' });
    }
});

// POST /api/villages/seed-tile/:tileId - Seed villages for a single tile using population + random buffer
router.post('/seed-tile/:tileId', async (req, res) => {
    const tileId = parseInt(req.params.tileId, 10);
    if (isNaN(tileId)) return res.status(400).json({ error: 'Invalid tileId' });
    try {
        const result = await villageSeeder.seedVillagesForTile(tileId);
        if (!result || result.created === 0) {
            return res.status(400).json({ error: 'No available cleared land chunks to create villages on this tile' });
        }
        res.json(result);
    } catch (err) {
        console.error(`Error seeding villages for tile ${tileId}:`, err);
        res.status(500).json({ error: 'Failed to seed villages for tile' });
    }
});

// PUT /api/villages/:id/assign-family - Assign a family to a village
router.put('/:id/assign-family', async (req, res) => {
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
    } catch (err) {
        console.error('Error assigning family to village:', err);
        res.status(500).json({ error: 'Failed to assign family to village' });
    }
});

// DELETE /api/villages/:id - Delete a village
router.delete('/:id', async (req, res) => {
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
    } catch (err) {
        console.error('Error deleting village:', err);
        res.status(500).json({ error: 'Failed to delete village' });
    }
});

module.exports = router;
