/**
 * PendingOperations - Pending insert/update/delete tracking
 * 
 * Handles:
 * - Tracking pending inserts, updates, deletes
 * - Clearing pending operations after sync
 */

import storage from '../storage';
import { StoredPerson, PipelineResult, getErrorMessage } from './types';

/**
 * Get pending person inserts (people with temp IDs)
 */
export async function getPendingInserts(): Promise<StoredPerson[]> {
    if (!storage.isAvailable()) return [];
    try {
        const ids = await storage.smembers('pending:person:inserts');
        if (ids.length === 0) return [];

        const pipeline = storage.pipeline();
        for (const id of ids) {
            pipeline.hget('person', id.toString());
        }
        const results = await pipeline.exec() as PipelineResult;

        const people: StoredPerson[] = [];
        for (const [err, json] of results) {
            if (!err && json) {
                try {
                    people.push(JSON.parse(json as string) as StoredPerson);
                } catch { /* skip invalid JSON */ }
            }
        }
        return people;
    } catch (err: unknown) {
        console.warn('[PendingOperations] getPendingInserts failed:', getErrorMessage(err));
        return [];
    }
}

/**
 * Get pending person updates (people that were modified)
 */
export async function getPendingUpdates(): Promise<StoredPerson[]> {
    if (!storage.isAvailable()) return [];
    try {
        const ids = await storage.smembers('pending:person:updates');
        if (ids.length === 0) return [];

        const pipeline = storage.pipeline();
        for (const id of ids) {
            pipeline.hget('person', id.toString());
        }
        const results = await pipeline.exec() as PipelineResult;

        const people: StoredPerson[] = [];
        for (const [err, json] of results) {
            if (!err && json) {
                try {
                    people.push(JSON.parse(json as string) as StoredPerson);
                } catch { /* skip invalid JSON */ }
            }
        }
        return people;
    } catch (err: unknown) {
        console.warn('[PendingOperations] getPendingUpdates failed:', getErrorMessage(err));
        return [];
    }
}

/**
 * Get pending person deletes
 */
export async function getPendingDeletes(): Promise<number[]> {
    if (!storage.isAvailable()) return [];
    try {
        const ids = await storage.smembers('pending:person:deletes');
        return ids.map(id => parseInt(id));
    } catch (err: unknown) {
        console.warn('[PendingOperations] getPendingDeletes failed:', getErrorMessage(err));
        return [];
    }
}

/**
 * Clear pending person operations
 */
export async function clearPendingOperations(): Promise<void> {
    if (!storage.isAvailable()) return;
    try {
        await storage.del('pending:person:inserts');
        await storage.del('pending:person:updates');
        await storage.del('pending:person:deletes');
    } catch (err: unknown) {
        console.warn('[PendingOperations] clearPendingOperations failed:', getErrorMessage(err));
    }
}
