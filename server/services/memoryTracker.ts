/**
 * Memory Usage Tracker Service
 * Tracks and reports Node.js memory usage statistics
 */

export interface MemoryStats {
    /** Resident Set Size - total memory allocated for the process */
    rss: number;
    /** Total size of the allocated heap */
    heapTotal: number;
    /** Actual memory used during execution */
    heapUsed: number;
    /** V8 external memory (C++ objects bound to JS) */
    external: number;
    /** Memory used by ArrayBuffers and SharedArrayBuffers */
    arrayBuffers: number;
    /** Formatted human-readable values */
    formatted: {
        rss: string;
        heapTotal: string;
        heapUsed: string;
        external: string;
        arrayBuffers: string;
    };
    /** Heap usage percentage */
    heapUsagePercent: number;
    /** Timestamp of the measurement */
    timestamp: number;
    /** Uptime in seconds */
    uptimeSeconds: number;
}

export interface MemoryHistory {
    current: MemoryStats;
    peak: {
        heapUsed: number;
        heapUsedFormatted: string;
        rss: number;
        rssFormatted: string;
        timestamp: number;
    };
    samples: MemoryStats[];
    sampleCount: number;
    averageHeapUsed: number;
    averageHeapUsedFormatted: string;
}

class MemoryTracker {
    private samples: MemoryStats[] = [];
    private maxSamples: number = 60; // Keep last 60 samples (1 hour at 1 sample/min)
    private intervalId: NodeJS.Timeout | null = null;
    private peakHeapUsed: number = 0;
    private peakHeapTimestamp: number = 0;
    private peakRss: number = 0;
    private peakRssTimestamp: number = 0;
    private startTime: number = Date.now();

    /**
     * Format bytes to human-readable string
     */
    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }

    /**
     * Get current memory statistics
     */
    getStats(): MemoryStats {
        const memUsage = process.memoryUsage();
        const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

        const stats: MemoryStats = {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            formatted: {
                rss: this.formatBytes(memUsage.rss),
                heapTotal: this.formatBytes(memUsage.heapTotal),
                heapUsed: this.formatBytes(memUsage.heapUsed),
                external: this.formatBytes(memUsage.external),
                arrayBuffers: this.formatBytes(memUsage.arrayBuffers),
            },
            heapUsagePercent: memUsage.heapTotal > 0
                ? Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
                : 0,
            timestamp: Date.now(),
            uptimeSeconds,
        };

        // Update peak values
        if (memUsage.heapUsed > this.peakHeapUsed) {
            this.peakHeapUsed = memUsage.heapUsed;
            this.peakHeapTimestamp = Date.now();
        }
        if (memUsage.rss > this.peakRss) {
            this.peakRss = memUsage.rss;
            this.peakRssTimestamp = Date.now();
        }

        return stats;
    }

    /**
     * Get memory history with statistics
     */
    getHistory(): MemoryHistory {
        const current = this.getStats();

        // Calculate average heap usage from samples
        const avgHeapUsed = this.samples.length > 0
            ? this.samples.reduce((sum, s) => sum + s.heapUsed, 0) / this.samples.length
            : current.heapUsed;

        return {
            current,
            peak: {
                heapUsed: this.peakHeapUsed,
                heapUsedFormatted: this.formatBytes(this.peakHeapUsed),
                rss: this.peakRss,
                rssFormatted: this.formatBytes(this.peakRss),
                timestamp: this.peakHeapTimestamp,
            },
            samples: this.samples.slice(-10), // Return last 10 samples
            sampleCount: this.samples.length,
            averageHeapUsed: avgHeapUsed,
            averageHeapUsedFormatted: this.formatBytes(avgHeapUsed),
        };
    }

    /**
     * Record a sample of current memory usage
     */
    private recordSample(): void {
        const stats = this.getStats();
        this.samples.push(stats);

        // Keep only the last maxSamples
        if (this.samples.length > this.maxSamples) {
            this.samples = this.samples.slice(-this.maxSamples);
        }
    }

    /**
     * Start automatic memory tracking at specified interval
     * @param intervalMs Interval in milliseconds (default: 60000 = 1 minute)
     */
    start(intervalMs: number = 60000): void {
        if (this.intervalId) {
            console.log('⚠️ Memory tracker already running');
            return;
        }

        // Record initial sample
        this.recordSample();

        this.intervalId = setInterval(() => {
            this.recordSample();
        }, intervalMs);

        console.log(`📊 Memory tracker started (sampling every ${intervalMs / 1000}s)`);
    }

    /**
     * Stop automatic memory tracking
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('📊 Memory tracker stopped');
        }
    }

    /**
     * Force garbage collection if available (requires --expose-gc flag)
     * @returns true if GC was triggered, false otherwise
     */
    forceGC(): boolean {
        if (global.gc) {
            global.gc();
            console.log('🗑️ Garbage collection triggered');
            return true;
        }
        return false;
    }

    /**
     * Reset tracking statistics
     */
    reset(): void {
        this.samples = [];
        this.peakHeapUsed = 0;
        this.peakHeapTimestamp = 0;
        this.peakRss = 0;
        this.peakRssTimestamp = 0;
        this.startTime = Date.now();
        console.log('📊 Memory tracker reset');
    }

    /**
     * Log current memory stats to console
     */
    logStats(): void {
        const stats = this.getStats();
        console.log(`📊 Memory: Heap ${stats.formatted.heapUsed}/${stats.formatted.heapTotal} (${stats.heapUsagePercent}%), RSS ${stats.formatted.rss}`);
    }
}

// Export singleton instance
const memoryTracker = new MemoryTracker();
export default memoryTracker;
