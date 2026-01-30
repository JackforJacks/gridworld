/**
 * Population Repository - Data Access Layer
 * Implements Repository Pattern to separate data access from business logic
 */

import { Pool, PoolClient } from 'pg';
import pool from '../config/database';
import { DatabaseError } from '../utils/errorHandler';
import type { PersonData, FamilyData, PopulationStats, TransactionClient } from '../../types/global';

/**
 * Filter options for population queries
 */
interface PopulationFilters {
    tileId?: number;
    villageId?: number;
}

/**
 * Filter options for family queries
 */
interface FamilyFilters {
    tileId?: number;
}

/**
 * Tile population data
 */
interface TilePopulationData {
    tile_id: number;
    population: string;
}

/**
 * Demographics data
 */
interface DemographicsData {
    total: string;
    males: string;
    females: string;
    avg_age: string | null;
}

/**
 * Population Repository
 * Handles all database operations for population data
 */
class PopulationRepository {
    private pool: Pool;

    /**
     * Create a population repository
     * @param dbPool - Database pool instance
     */
    constructor(dbPool: Pool = pool) {
        this.pool = dbPool;
    }

    /**
     * Get all people from database
     * @param filters - Optional filters
     * @returns Array of person data
     * @throws DatabaseError If database query fails
     */
    async getAllPeople(filters: PopulationFilters = {}): Promise<PersonData[]> {
        try {
            let query = 'SELECT * FROM people WHERE 1=1';
            const params: (number | string)[] = [];
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
        } catch (error: unknown) {
            throw new DatabaseError('Failed to fetch people', error instanceof Error ? error : null);
        }
    }

    /**
     * Get person by ID
     * @param personId - The person's ID
     * @returns The person data or null
     */
    async getPersonById(personId: number): Promise<PersonData | null> {
        try {
            const result = await this.pool.query(
                'SELECT * FROM people WHERE id = $1',
                [personId]
            );
            return result.rows[0] || null;
        } catch (error: unknown) {
            throw new DatabaseError(`Failed to fetch person ${personId}`, error instanceof Error ? error : null);
        }
    }

    /**
     * Get people by tile ID
     * @param tileId - The tile ID
     * @returns Array of people data
     * @throws DatabaseError If database query fails
     */
    async getPeopleByTile(tileId: number): Promise<PersonData[]> {
        try {
            const result = await this.pool.query(
                'SELECT * FROM people WHERE tile_id = $1',
                [tileId]
            );
            return result.rows;
        } catch (error: unknown) {
            throw new DatabaseError(`Failed to fetch people for tile ${tileId}`, error instanceof Error ? error : null);
        }
    }

    /**
     * Get population count by tile
     * @param tileId - The tile ID
     * @returns Population count
     */
    async getPopulationCountByTile(tileId: number): Promise<number> {
        try {
            const result = await this.pool.query(
                'SELECT COUNT(*) FROM people WHERE tile_id = $1',
                [tileId]
            );
            return parseInt(result.rows[0].count, 10);
        } catch (error: unknown) {
            throw new DatabaseError(`Failed to count people for tile ${tileId}`, error instanceof Error ? error : null);
        }
    }

    /**
     * Get all families
     * @param filters - Optional filters
     * @returns Array of family data
     * @throws DatabaseError If database query fails
     */
    async getAllFamilies(filters: FamilyFilters = {}): Promise<FamilyData[]> {
        try {
            let query = 'SELECT * FROM family WHERE 1=1';
            const params: (number | string)[] = [];
            let paramIndex = 1;

            if (filters.tileId !== undefined) {
                query += ` AND tile_id = $${paramIndex++}`;
                params.push(filters.tileId);
            }

            const result = await this.pool.query(query, params);
            return result.rows;
        } catch (error: unknown) {
            throw new DatabaseError('Failed to fetch families', error instanceof Error ? error : null);
        }
    }

    /**
     * Get family by ID
     * @param familyId - The family ID
     * @returns The family data or null
     */
    async getFamilyById(familyId: number): Promise<FamilyData | null> {
        try {
            const result = await this.pool.query(
                'SELECT * FROM family WHERE id = $1',
                [familyId]
            );
            return result.rows[0] || null;
        } catch (error: unknown) {
            throw new DatabaseError(`Failed to fetch family ${familyId}`, error instanceof Error ? error : null);
        }
    }

    /**
     * Get tiles with population counts
     * @returns Array of tile population data
     * @throws DatabaseError If database query fails
     */
    async getTilePopulations(): Promise<TilePopulationData[]> {
        try {
            const result = await this.pool.query(`
                SELECT tile_id, COUNT(*) as population
                FROM people
                GROUP BY tile_id
                ORDER BY tile_id
            `);
            return result.rows;
        } catch (error: unknown) {
            throw new DatabaseError('Failed to fetch tile populations', error instanceof Error ? error : null);
        }
    }

    /**
     * Get demographic statistics
     * @returns Demographics data
     */
    async getDemographics(): Promise<DemographicsData> {
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
        } catch (error: unknown) {
            throw new DatabaseError('Failed to fetch demographics', error instanceof Error ? error : null);
        }
    }

    /**
     * Execute a transaction
     * @param callback - Async function that receives client
     * @returns Transaction result
     */
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
        const client: PoolClient = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error: unknown) {
            await client.query('ROLLBACK');
            throw new DatabaseError('Transaction failed', error instanceof Error ? error : null);
        } finally {
            client.release();
        }
    }
}

export default PopulationRepository;
