/**
 * State Manager - Save Operations
 * Saves world state to a local bincode file via Rust
 */

import fs from 'fs';
import storage from '../storage';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';

// ========== Type Definitions ==========

interface CalendarService {
    state?: { isRunning?: boolean };
    start: () => void;
    stop: () => void;
}

interface SaveContext {
    calendarService?: CalendarService;
    io?: SocketIOServer;
}

interface SaveResult {
    people: number;
    families: number;
    elapsed: number;
    fileBytes: number;
}

/** Default save file path */
const SAVE_DIR = path.resolve(process.cwd(), 'saves');
const SAVE_FILE = path.join(SAVE_DIR, 'world.bin');

/**
 * Save all state to a local bincode file.
 * The Rust side serializes the ECS (people, calendar, relationships).
 * Node-side state (families) is bundled as JSON bytes inside the same file.
 */
async function saveToDatabase(context: SaveContext): Promise<SaveResult> {
    const wasRunning = context.calendarService?.state?.isRunning;

    // Pause calendar ticks during save
    if (wasRunning && context.calendarService) {
        context.calendarService.stop();
    }

    try {
        const startTime = Date.now();
        const rustSimulation = require('../rustSimulation').default;

        // Read all state from Redis
        const [allPersonData, allFamilyData, allTileData, allTileFertility] = await Promise.all([
            storage.hgetall('person'),
            storage.hgetall('family'),
            storage.hgetall('tile'),
            storage.hgetall('tile:fertility')
        ]);
        const personCount = Object.keys(allPersonData || {}).length;
        const familyCount = Object.keys(allFamilyData || {}).length;

        // Bundle all state as JSON
        const nodeState = JSON.stringify({
            people: allPersonData || {},
            families: allFamilyData || {},
            tiles: allTileData || {},
            tileFertility: allTileFertility || {}
        });

        // Get world seed
        const seed = parseInt(process.env.WORLD_SEED || '0', 10);

        // Remove existing save file before writing
        try { fs.unlinkSync(SAVE_FILE); } catch { /* file may not exist */ }

        // Save via Rust (ECS + node state → bincode file)
        const stats = rustSimulation.saveToFile(nodeState, seed, SAVE_FILE);

        const elapsed = Date.now() - startTime;
        console.log(`💾 Saved in ${elapsed}ms — ${stats.population} people, ${familyCount} families, ${stats.fileBytes} bytes`);

        // Emit save event
        if (context.io) {
            context.io.emit('gameSaved', {
                timestamp: new Date().toISOString(),
                people: stats.population,
                families: familyCount
            });
        }

        return {
            people: stats.population,
            families: familyCount,
            elapsed,
            fileBytes: stats.fileBytes
        };
    } catch (err: unknown) {
        console.error('❌ [SaveOperations] Failed to save:', (err as Error).message);
        throw err;
    } finally {
        // Resume calendar ticks after save
        if (wasRunning && context.calendarService) {
            context.calendarService.start();
        }
    }
}

export {
    saveToDatabase,
    SAVE_FILE
};
