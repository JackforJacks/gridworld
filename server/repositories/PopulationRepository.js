/**
 * Population Repository - Data Access Layer
 * Implements Repository Pattern to separate data access from business logic
 */

const pool = require('../config/database');
const { DatabaseError } = require('../utils/errorHandler');

class PopulationRepository {
    constructor(dbPool = pool) {
        this.pool = dbPool;
    }

    /**
     * Get all people from database
     * @param {Object} filters - Optional filters { tileId, villageId, minAge, maxAge }
     * @returns {Promise<Array>}
     */
    async getAllPeople(filters = {}) {
        try {
            let query = 'SELECT * FROM people WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            if (filters.tileId !== undefined) {
                query += ` AND tile_id = $${paramIndex++}`;
                params.push(filters.tileId);
            }

            if (filters.villageId !== undefined) {
                query += ` AND residency = $${paramIndex++}`;
                params.push(filters.villageId);
            }

            const result = await this.pool.query(query, params);
            return result.rows;
        } catch (error) {
            throw new DatabaseError('Failed to fetch people', error);
        }
    }

    /**
     * Get person by ID
     * @param {number} personId
     * @returns {Promise<Object|null>}
     */
    async getPersonById(personId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM people WHERE id = $1',
                [personId]
            );
            return result.rows[0] || null;
        } catch (error) {
            throw new DatabaseError(`Failed to fetch person ${personId}`, error);
        }
    }

    /**
     * Get people by tile ID
     * @param {number} tileId
     * @returns {Promise<Array>}
     */
    async getPeopleByTile(tileId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM people WHERE tile_id = $1',
                [tileId]
            );
            return result.rows;
        } catch (error) {
            throw new DatabaseError(`Failed to fetch people for tile ${tileId}`, error);
        }
    }

    /**
     * Get population count by tile
     * @param {number} tileId
     * @returns {Promise<number>}
     */
    async getPopulationCountByTile(tileId) {
        try {
            const result = await this.pool.query(
                'SELECT COUNT(*) FROM people WHERE tile_id = $1',
                [tileId]
            );
            return parseInt(result.rows[0].count, 10);
        } catch (error) {
            throw new DatabaseError(`Failed to count people for tile ${tileId}`, error);
        }
    }

    /**
     * Get all families
     * @param {Object} filters - Optional filters { tileId }
     * @returns {Promise<Array>}
     */
    async getAllFamilies(filters = {}) {
        try {
            let query = 'SELECT * FROM family WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            if (filters.tileId !== undefined) {
                query += ` AND tile_id = $${paramIndex++}`;
                params.push(filters.tileId);
            }

            const result = await this.pool.query(query, params);
            return result.rows;
        } catch (error) {
            throw new DatabaseError('Failed to fetch families', error);
        }
    }

    /**
     * Get family by ID
     * @param {number} familyId
     * @returns {Promise<Object|null>}
     */
    async getFamilyById(familyId) {
        try {
            const result = await this.pool.query(
                'SELECT * FROM family WHERE id = $1',
                [familyId]
            );
            return result.rows[0] || null;
        } catch (error) {
            throw new DatabaseError(`Failed to fetch family ${familyId}`, error);
        }
    }

    /**
     * Get tiles with population counts
     * @returns {Promise<Array>}
     */
    async getTilePopulations() {
        try {
            const result = await this.pool.query(`
                SELECT tile_id, COUNT(*) as population
                FROM people
                GROUP BY tile_id
                ORDER BY tile_id
            `);
            return result.rows;
        } catch (error) {
            throw new DatabaseError('Failed to fetch tile populations', error);
        }
    }

    /**
     * Get demographic statistics
     * @returns {Promise<Object>}
     */
    async getDemographics() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE sex = 'M') as males,
                    COUNT(*) FILTER (WHERE sex = 'F') as females,
                    AVG(EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))) as avg_age
                FROM people
            `);
            return result.rows[0];
        } catch (error) {
            throw new DatabaseError('Failed to fetch demographics', error);
        }
    }

    /**
     * Execute a transaction
     * @param {Function} callback - Async function that receives client
     * @returns {Promise<*>}
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw new DatabaseError('Transaction failed', error);
        } finally {
            client.release();
        }
    }
}

module.exports = PopulationRepository;
