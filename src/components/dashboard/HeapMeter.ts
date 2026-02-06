/**
 * HeapMeter - Simple memory display with emojis
 * 🖥️ Client heap (Chrome only) | ☁️ Server heap
 * 
 * Optimized with:
 * - Visibility-aware polling (pauses when tab hidden)
 * - Proper cleanup of all intervals
 * - Reduced polling frequency (5s instead of 1s)
 * - Request deduplication
 */

declare global {
    interface Performance {
        memory?: { usedJSHeapSize: number };
    }
}

class HeapMeter {
    private el: HTMLDivElement;
    private displayTimer: ReturnType<typeof setInterval> | null = null;
    private serverTimer: ReturnType<typeof setInterval> | null = null;
    private serverHeap = 0;
    private rustMemoryBytes = 0;
    private rustAvailable = false;
    private isVisible = true;
    private isFetching = false;
    private readonly SERVER_FETCH_INTERVAL_MS = 5000; // Reduced from 1000ms
    private readonly DISPLAY_UPDATE_INTERVAL_MS = 2000;
    private boundVisibilityHandler: () => void;

    constructor() {
        this.el = document.createElement('div');
        this.el.id = 'heap-meter';
        this.el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,0.8);border-radius:8px;padding:8px 12px;font:12px monospace;color:#fff;z-index:1000';
        document.body.appendChild(this.el);

        this.update();
        this.startTimers();
        this.setupVisibilityHandling();
    }

    /**
     * Start all timers
     */
    private startTimers(): void {
        // Update display every 2 seconds
        this.displayTimer = setInterval(() => this.update(), this.DISPLAY_UPDATE_INTERVAL_MS);
        
        // Fetch server data every 5 seconds (reduced from 1s to save battery/network)
        this.fetchServer();
        this.serverTimer = setInterval(() => this.fetchServer(), this.SERVER_FETCH_INTERVAL_MS);
    }

    /**
     * Pause timers when tab is hidden to save battery/network
     */
    private setupVisibilityHandling(): void {
        this.boundVisibilityHandler = () => {
            if (document.hidden) {
                this.pause();
            } else {
                this.resume();
            }
        };
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    }

    /**
     * Pause polling when tab is not visible
     */
    private pause(): void {
        this.isVisible = false;
        if (this.serverTimer) {
            clearInterval(this.serverTimer);
            this.serverTimer = null;
        }
    }

    /**
     * Resume polling when tab becomes visible
     */
    private resume(): void {
        if (!this.isVisible) {
            this.isVisible = true;
            // Immediate fetch on resume for fresh data
            this.fetchServer();
            this.serverTimer = setInterval(() => this.fetchServer(), this.SERVER_FETCH_INTERVAL_MS);
        }
    }

    private fmt(b: number): string {
        return b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`;
    }

    private update(): void {
        const client = performance.memory ? `🖥️${this.fmt(performance.memory.usedJSHeapSize)}` : '';
        const server = this.serverHeap > 0 ? `☁️${this.fmt(this.serverHeap)}` : '';
        const rust = this.rustAvailable ? `⚙️${this.fmt(this.rustMemoryBytes)}` : '';
        this.el.textContent = [client, server, rust].filter(Boolean).join(' ');
    }

    /**
     * Fetch server memory with request deduplication
     * Prevents multiple concurrent requests
     */
    private async fetchServer(): Promise<void> {
        if (this.isFetching) return; // Skip if already fetching
        
        this.isFetching = true;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout
            
            // Fetch memory and rust stats in parallel
            const [memRes, rustRes] = await Promise.all([
                fetch('/api/system/memory', { signal: controller.signal }),
                fetch('/api/system/rust', { signal: controller.signal }),
            ]);
            clearTimeout(timeoutId);
            
            if (memRes.ok) {
                const d = await memRes.json();
                if (d.data?.heapUsed) this.serverHeap = d.data.heapUsed;
            }
            
            if (rustRes.ok) {
                const d = await rustRes.json();
                if (d.data) {
                    this.rustAvailable = d.data.available;
                    if (d.data.memoryBytes) this.rustMemoryBytes = d.data.memoryBytes;
                }
            }
        } catch { 
            // Ignore fetch errors silently
        } finally {
            this.isFetching = false;
        }
    }

    /**
     * Clean up all resources
     * Call this when component is destroyed
     */
    destroy(): void {
        if (this.displayTimer) {
            clearInterval(this.displayTimer);
            this.displayTimer = null;
        }
        if (this.serverTimer) {
            clearInterval(this.serverTimer);
            this.serverTimer = null;
        }
        if (this.boundVisibilityHandler) {
            document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        }
        this.el.remove();
    }
}

export default HeapMeter;
