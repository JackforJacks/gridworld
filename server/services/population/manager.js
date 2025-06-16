// server/services/population/manager.js
import { getRandomSex, getRandomAge, getRandomBirthDate } from './calculator.js';
import { trackBirths, trackDeaths } from './PopStats.js';
import config from '../../config/server.js';

async function addPeopleToTile(pool, tileId, count, currentYear, currentMonth, currentDay, populationServiceInstance, doTrackBirths = false) {
    const people = [];
    const batchSize = config.populationBatchSize || 100; // Use config or default

    for (let i = 0; i < count; i++) {
        const sex = getRandomSex();
        const age = getRandomAge();
        const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
        people.push([tileId, sex, birthDate]);
    }

    if (people.length > 0) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (let i = 0; i < people.length; i += batchSize) {
                const batch = people.slice(i, i + batchSize);
                const values = batch.map((person, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`).join(',');
                const flatBatch = batch.flat();
                await client.query(`INSERT INTO people (tile_id, sex, date_of_birth) VALUES ${values}`, flatBatch);
            }
            await client.query('COMMIT');
            if (doTrackBirths && populationServiceInstance && typeof trackBirths === 'function') {
                // Pass populationServiceInstance as context to trackBirths
                trackBirths(populationServiceInstance, count);
            }
        } catch (error) {
            await client.query('ROLLBACK');
            console.warn('Error adding people to tile, rolling back transaction:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

async function removePeopleFromTile(pool, tileId, count, populationServiceInstance, doTrackDeaths = false) {
    if (count <= 0) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Select 'count' random people from the specified tile_id to remove
        // This query might need optimization for very large tables.
        const result = await client.query(
            'SELECT id FROM people WHERE tile_id = $1 ORDER BY RANDOM() LIMIT $2',
            [tileId, count]
        );
        const peopleIdsToRemove = result.rows.map(row => row.id);

        if (peopleIdsToRemove.length > 0) {
            await client.query('DELETE FROM people WHERE id = ANY($1::int[])', [peopleIdsToRemove]);
            if (doTrackDeaths && populationServiceInstance && typeof trackDeaths === 'function') {
                // Pass populationServiceInstance as context to trackDeaths
                trackDeaths(populationServiceInstance, peopleIdsToRemove.length);
            }
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.warn('Error removing people from tile, rolling back transaction:', error);
        throw error;
    } finally {
        client.release();
    }
}

export { addPeopleToTile, removePeopleFromTile };
