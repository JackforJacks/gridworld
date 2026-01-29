/**
 * Village Seeder - Main Entry Point
 * Handles village creation and seeding
 * 
 * This module has been refactored into:
 * - dbUtils.js - Database schema utilities
 * - postgresSeeding.js - Postgres-based village seeding
 * - redisSeeding.js - Redis-first village seeding
 * - residency.js - Residency assignment utilities
 */

const pool = require('../../config/database');
const { seedRandomVillages, seedVillagesForTile } = require('./postgresSeeding');
const { seedVillagesStorageFirst } = require('./redisSeeding');
const { assignResidencyForTile } = require('./residency');
const storage = require('../storage');

/**
 * Seed villages if none exist in the database
 * @returns {Promise<Object>} Result with created count and villages
 */
async function seedIfNoVillages() {
    try {
        // Check if any villages exist
        const { rows: existingVillages } = await pool.query('SELECT COUNT(*) as count FROM villages');
        const villageCount = parseInt(existingVillages[0].count);

        if (villageCount > 0) {
            console.log(`[villageSeeder] ${villageCount} villages already exist, skipping seeding`);
            return { created: 0, villages: [] };
        }

        console.log('[villageSeeder] No villages found, seeding initial villages...');

        // --- REDIS-FIRST CHECK ---
        const PopulationState = require('../populationState');
        if (storage.isAvailable()) {
            const peopleCount = await PopulationState.getTotalPopulation();
            const villagesData = await storage.hgetall('village');
            const villagesCountRedis = villagesData ? Object.keys(villagesData).length : 0;
            if (peopleCount > 0 && villagesCountRedis > 0) {
                console.log(`[villageSeeder] Redis already has ${villagesCountRedis} villages and ${peopleCount} people, skipping fallback seeding.`);
                return { created: 0, villages: [] };
            }
        }
        // --- END REDIS-FIRST CHECK ---

        // Check if there are any populated tiles
        const { rows: populatedTiles } = await pool.query(`
            SELECT DISTINCT tile_id FROM people WHERE tile_id IS NOT NULL
        `);

        if (!populatedTiles || populatedTiles.length === 0) {
            console.log('[villageSeeder] No populated tiles found, creating initial population and villages...');
            await createInitialWorld();
        }

        // Now seed villages
        const result = await seedRandomVillages(5);

        console.log(`[villageSeeder] Seeded ${result.created} initial villages`);
        return result;

    } catch (error) {
        console.error('[villageSeeder] Error seeding villages if none exist:', error);
        throw error;
    }
}

/**
 * Create initial world with tiles and population (fallback)
 */
async function createInitialWorld() {
    // Check if there are any tiles at all
    const { rows: allTiles } = await pool.query('SELECT COUNT(*) as count FROM tiles');
    const tileCount = parseInt(allTiles[0].count);

    if (tileCount === 0) {
        console.log('[villageSeeder] No tiles found, creating initial habitable tiles...');
        await createInitialTiles();
    }

    // Create initial population on each tile
    for (const tile of initialTiles) {
        await createInitialPopulation(tile.id);
    }
}

/**
 * Create initial habitable tiles
 */
async function createInitialTiles() {
    const initialTiles = [
        { id: 1, center_x: 0, center_y: 0, center_z: 1, latitude: 90, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 75 },
        { id: 2, center_x: 1, center_y: 0, center_z: 0, latitude: 0, longitude: 90, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 70 },
        { id: 3, center_x: 0, center_y: 1, center_z: 0, latitude: 0, longitude: 0, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 80 },
        { id: 4, center_x: -1, center_y: 0, center_z: 0, latitude: 0, longitude: 180, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 65 },
        { id: 5, center_x: 0, center_y: -1, center_z: 0, latitude: 0, longitude: 270, terrain_type: 'plains', is_land: true, is_habitable: true, fertility: 72 }
    ];

    for (const tile of initialTiles) {
        await pool.query(`
            INSERT INTO tiles (id, center_x, center_y, center_z, latitude, longitude, terrain_type, is_land, is_habitable, fertility, biome, boundary_points, neighbor_ids)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO NOTHING
        `, [tile.id, tile.center_x, tile.center_y, tile.center_z, tile.latitude, tile.longitude, tile.terrain_type, tile.is_land, tile.is_habitable, tile.fertility, 'temperate_grassland', '[]', '[]']);

        // Create tiles_lands for this tile
        for (let chunkIndex = 0; chunkIndex < 100; chunkIndex++) {
            const landType = chunkIndex < 5 ? 'cleared' : (Math.random() > 0.3 ? 'forest' : 'wasteland');
            await pool.query(`
                INSERT INTO tiles_lands (tile_id, chunk_index, land_type, cleared)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (tile_id, chunk_index) DO NOTHING
            `, [tile.id, chunkIndex, landType, landType === 'cleared']);
        }
    }

    console.log(`[villageSeeder] Created ${initialTiles.length} initial habitable tiles with land chunks`);
}

/**
 * Create initial population on a tile
 */
async function createInitialPopulation(tileId) {
    const PopulationState = require('../populationState');
    const { getRandomSex, getRandomAge, getRandomBirthDate } = require('../population/calculator.js');

    // Add 100-200 people per tile
    const peopleCount = 100 + Math.floor(Math.random() * 100);

    for (let i = 0; i < peopleCount; i++) {
        const sex = getRandomSex();
        const age = getRandomAge();
        const birthDate = getRandomBirthDate(1, 1, 1, age); // Year 1, month 1, day 1

        const tempId = await PopulationState.getNextTempId();

        const personObj = {
            id: tempId,
            tile_id: tileId,
            residency: null,
            sex: sex,
            date_of_birth: birthDate,
            health: 100,
            family_id: null
        };

        await PopulationState.addPerson(personObj, true);
    }

    console.log(`[villageSeeder] Created ${peopleCount} people on tile ${tileId}`);
}

module.exports = {
    seedRandomVillages,
    seedIfNoVillages,
    assignResidencyForTile,
    seedVillagesStorageFirst,
    seedVillagesForTile
};
