// Load Operations - Storage Clear Module
import storage from '../../storage';

/**
 * Clear existing storage state before loading fresh data
 * Tries flushdb first, falls back to selective clearing
 */
export async function clearExistingStorageState(): Promise<void> {
    try {
        // Flush the entire Redis database to ensure clean state
        if (typeof storage.flushdb === 'function') {
            await storage.flushdb();
        } else {
            throw new Error('flushdb not supported');
        }

        // Check what keys exist after flush
        let keysAfter: string[] = [];
        if (typeof storage.keys === 'function') {
            keysAfter = await storage.keys('*') || [];
        }

        if (keysAfter.length > 0) {
            console.warn(`⚠️ WARNING: ${keysAfter.length} keys still exist after flushdb! Keys: ${keysAfter.slice(0, 10).join(', ')}${keysAfter.length > 10 ? '...' : ''}`);
        }
    } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn('⚠️ Failed to flush Redis database:', errMsg);
        await fallbackClearStorage();
    }
}

/**
 * Fallback method to clear storage when flushdb is not available
 */
async function fallbackClearStorage(): Promise<void> {
    try {
        // Clear all known hash keys
        await storage.del(
            'person', 'family',
            'tile', 'tile:lands', 'tile:fertility',
            'counts:global'
        );

        // Clear all pattern-based keys using scanStream
        const patterns = [
            'eligible:*:*',         // Eligible matchmaking sets
            'pending:*',            // All pending operations
            'fertile:*',            // Fertile family sets
            'lock:*',               // Any stale locks
            'stats:*'               // Statistics counters
        ];

        for (const pattern of patterns) {
            await clearKeysMatchingPattern(pattern);
        }

        console.log('🧹 Cleared existing storage state keys (fallback method)');
    } catch (e2: unknown) {
        const e2Msg = e2 instanceof Error ? e2.message : String(e2);
        console.warn('⚠️ Failed to clear storage keys even with fallback:', e2Msg);
    }
}

/**
 * Clear all keys matching a pattern
 */
async function clearKeysMatchingPattern(pattern: string): Promise<void> {
    try {
        const stream = storage.scanStream({ match: pattern, count: 1000 });
        const keysToDelete: string[] = [];
        
        for await (const resultKeys of stream) {
            for (const key of resultKeys) {
                keysToDelete.push(key);
            }
        }
        
        if (keysToDelete.length > 0) {
            // Delete in batches of 100 to avoid overwhelming Redis
            for (let i = 0; i < keysToDelete.length; i += 100) {
                const batch = keysToDelete.slice(i, i + 100);
                await storage.del(...batch);
            }
            console.log(`🧹 Cleared ${keysToDelete.length} keys matching '${pattern}'`);
        }
    } catch (scanErr: unknown) {
        const scanErrMsg = scanErr instanceof Error ? scanErr.message : String(scanErr);
        console.warn(`⚠️ Failed to clear keys matching '${pattern}':`, scanErrMsg);
    }
}
