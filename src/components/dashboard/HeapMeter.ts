/**
 * HeapMeter - Simple memory display with emojis
 * 🖥️ Client heap (Chrome only) | ☁️ Server heap
 */

declare global {
    interface Performance {
        memory?: { usedJSHeapSize: number };
    }
}

class HeapMeter {
    private el: HTMLDivElement;
    private timer: ReturnType<typeof setInterval>;
    private serverHeap = 0;

    constructor() {
        this.el = document.createElement('div');
        this.el.id = 'heap-meter';
        this.el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,0.8);border-radius:8px;padding:8px 12px;font:12px monospace;color:#fff;z-index:1000';
        document.body.appendChild(this.el);

        this.update();
        this.timer = setInterval(() => this.update(), 2000);
        this.fetchServer();
        setInterval(() => this.fetchServer(), 1000);
    }

    private fmt(b: number): string {
        return b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`;
    }

    private update(): void {
        const client = performance.memory ? `🖥️${this.fmt(performance.memory.usedJSHeapSize)}` : '';
        const server = this.serverHeap > 0 ? `☁️${this.fmt(this.serverHeap)}` : '';
        this.el.textContent = [client, server].filter(Boolean).join(' ');
    }

    private async fetchServer(): Promise<void> {
        try {
            const r = await fetch('/api/system/memory');
            const d = await r.json();
            if (d.data?.heapUsed) this.serverHeap = d.data.heapUsed;
        } catch { /* ignore */ }
    }

    destroy(): void {
        clearInterval(this.timer);
        this.el.remove();
    }
}

export default HeapMeter;
