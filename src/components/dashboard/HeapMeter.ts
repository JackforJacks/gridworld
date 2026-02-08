/**
 * HeapMeter - Simple client-side memory display
 * Shows Chrome JS heap usage (when available)
 */

declare global {
    interface Performance {
        memory?: { usedJSHeapSize: number };
    }
}

class HeapMeter {
    private el: HTMLDivElement;
    private displayTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.el = document.createElement('div');
        this.el.id = 'heap-meter';
        this.el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:rgba(0,0,0,0.8);border-radius:8px;padding:8px 12px;font:12px monospace;color:#fff;z-index:1000';
        document.body.appendChild(this.el);

        this.update();
        this.displayTimer = setInterval(() => this.update(), 2000);
    }

    private fmt(b: number): string {
        return b < 1048576 ? `${(b / 1024).toFixed(0)}KB` : `${(b / 1048576).toFixed(1)}MB`;
    }

    private update(): void {
        if (performance.memory) {
            this.el.textContent = this.fmt(performance.memory.usedJSHeapSize);
        } else {
            this.el.textContent = '';
        }
    }

    destroy(): void {
        if (this.displayTimer) {
            clearInterval(this.displayTimer);
            this.displayTimer = null;
        }
        this.el.remove();
    }
}

export default HeapMeter;
