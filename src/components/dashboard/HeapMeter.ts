/**
 * HeapMeter - Combined frontend + backend memory display
 * Shows JS heap (WebView) and Rust process RSS side by side
 */

import { invoke } from '@tauri-apps/api/core';

declare global {
    interface Performance {
        memory?: { usedJSHeapSize: number };
    }
}

interface MemoryUsage {
    physical_mem: number;
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

    private async update(): Promise<void> {
        const fe = performance.memory ? performance.memory.usedJSHeapSize : 0;

        let be = 0;
        try {
            const usage = await invoke<MemoryUsage>('get_memory_usage');
            be = usage.physical_mem;
        } catch { /* fallback to 0 */ }

        if (fe || be) {
            this.el.textContent = `\u{1F5B5} ${this.fmt(fe)}  \u{2699} ${this.fmt(be)}`;
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
