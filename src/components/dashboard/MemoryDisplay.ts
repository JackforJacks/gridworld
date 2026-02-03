/**
 * MemoryDisplay - Dashboard component showing server memory usage
 * Displays real-time memory statistics from the backend
 */
import { getApiClient, MemoryStats } from '../../services/api/ApiClient';

class MemoryDisplay {
    private container: HTMLDivElement | null = null;
    private refreshInterval: ReturnType<typeof setInterval> | null = null;
    private readonly updateIntervalMs: number = 10000; // Update every 10 seconds
    private lastStats: MemoryStats | null = null;

    constructor() {
        this.init();
    }

    /**
     * Initialize the memory display component
     */
    private init(): void {
        this.createDisplay();
        this.startAutoRefresh();
        this.updateDisplay();
    }

    /**
     * Create the memory display element in the bottom-right corner
     */
    private createDisplay(): void {
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'memory-display';
        this.container.className = 'memory-display';
        this.container.title = 'Server Memory Usage (click for details)';

        // Initial loading state
        this.container.innerHTML = this.renderLoading();

        // Add click handler for detailed view
        this.container.addEventListener('click', () => this.showDetails());

        // Append to body (positioned via CSS)
        document.body.appendChild(this.container);
    }

    /**
     * Render loading state
     */
    private renderLoading(): string {
        return `
            <div class="memory-icon">💾</div>
            <div class="memory-content">
                <div class="memory-label">Memory</div>
                <div class="memory-value">Loading...</div>
            </div>
        `;
    }

    /**
     * Render memory stats
     */
    private renderStats(stats: MemoryStats): string {
        const heapPercent = stats.heapUsagePercent;
        const barColor = heapPercent > 80 ? '#ff4444' : heapPercent > 60 ? '#ffaa00' : '#44ff44';
        
        return `
            <div class="memory-icon">💾</div>
            <div class="memory-content">
                <div class="memory-label">Heap</div>
                <div class="memory-value">${stats.formatted.heapUsed}</div>
                <div class="memory-bar">
                    <div class="memory-bar-fill" style="width: ${heapPercent}%; background: ${barColor};"></div>
                </div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    private renderError(): string {
        return `
            <div class="memory-icon">💾</div>
            <div class="memory-content">
                <div class="memory-label">Memory</div>
                <div class="memory-value memory-error">Unavailable</div>
            </div>
        `;
    }

    /**
     * Update the display with current memory stats
     */
    private async updateDisplay(): Promise<void> {
        if (!this.container) return;

        try {
            const apiClient = getApiClient();
            const response = await apiClient.getMemoryStats();

            if (response.success && response.data) {
                this.lastStats = response.data;
                this.container.innerHTML = this.renderStats(response.data);
            } else {
                this.container.innerHTML = this.renderError();
            }
        } catch (error) {
            console.error('Failed to fetch memory stats:', error);
            this.container.innerHTML = this.renderError();
        }
    }

    /**
     * Start auto-refresh interval
     */
    private startAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        this.refreshInterval = setInterval(() => this.updateDisplay(), this.updateIntervalMs);
    }

    /**
     * Stop auto-refresh interval
     */
    private stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Show detailed memory information in a popup
     */
    private async showDetails(): Promise<void> {
        // Remove existing popup if any
        const existingPopup = document.getElementById('memory-details-popup');
        if (existingPopup) {
            existingPopup.remove();
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'memory-details-popup';
        popup.className = 'memory-details-popup';

        try {
            const apiClient = getApiClient();
            const response = await apiClient.getMemoryHistory();

            if (response.success && response.data) {
                const { current, peak, averageHeapUsedFormatted, sampleCount } = response.data;
                const uptimeFormatted = this.formatUptime(current.uptimeSeconds);

                popup.innerHTML = `
                    <div class="memory-popup-header">
                        <h3>Server Memory Details</h3>
                        <button class="memory-popup-close" onclick="this.parentElement.parentElement.remove()">×</button>
                    </div>
                    <div class="memory-popup-content">
                        <div class="memory-section">
                            <h4>Current Usage</h4>
                            <table class="memory-table">
                                <tr><td>Heap Used</td><td>${current.formatted.heapUsed}</td></tr>
                                <tr><td>Heap Total</td><td>${current.formatted.heapTotal}</td></tr>
                                <tr><td>Heap Usage</td><td>${current.heapUsagePercent}%</td></tr>
                                <tr><td>RSS</td><td>${current.formatted.rss}</td></tr>
                                <tr><td>External</td><td>${current.formatted.external}</td></tr>
                                <tr><td>Array Buffers</td><td>${current.formatted.arrayBuffers}</td></tr>
                            </table>
                        </div>
                        <div class="memory-section">
                            <h4>Peak Usage</h4>
                            <table class="memory-table">
                                <tr><td>Peak Heap</td><td>${peak.heapUsedFormatted}</td></tr>
                                <tr><td>Peak RSS</td><td>${peak.rssFormatted}</td></tr>
                            </table>
                        </div>
                        <div class="memory-section">
                            <h4>Statistics</h4>
                            <table class="memory-table">
                                <tr><td>Average Heap</td><td>${averageHeapUsedFormatted}</td></tr>
                                <tr><td>Samples</td><td>${sampleCount}</td></tr>
                                <tr><td>Uptime</td><td>${uptimeFormatted}</td></tr>
                            </table>
                        </div>
                    </div>
                `;
            } else {
                popup.innerHTML = `
                    <div class="memory-popup-header">
                        <h3>Memory Details</h3>
                        <button class="memory-popup-close" onclick="this.parentElement.parentElement.remove()">×</button>
                    </div>
                    <div class="memory-popup-content">
                        <p class="memory-error">Failed to load memory details</p>
                    </div>
                `;
            }
        } catch (error) {
            popup.innerHTML = `
                <div class="memory-popup-header">
                    <h3>Memory Details</h3>
                    <button class="memory-popup-close" onclick="this.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="memory-popup-content">
                    <p class="memory-error">Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
                </div>
            `;
        }

        document.body.appendChild(popup);

        // Close popup when clicking outside
        const closeOnOutsideClick = (e: MouseEvent) => {
            if (!popup.contains(e.target as Node) && e.target !== this.container) {
                popup.remove();
                document.removeEventListener('click', closeOnOutsideClick);
            }
        };
        // Delay adding the listener to prevent immediate close
        setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 100);
    }

    /**
     * Format uptime seconds into human readable format
     */
    private formatUptime(seconds: number): string {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hours < 24) return `${hours}h ${mins}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    /**
     * Cleanup - stop refresh interval
     */
    public destroy(): void {
        this.stopAutoRefresh();
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        const popup = document.getElementById('memory-details-popup');
        if (popup) popup.remove();
    }
}

export default MemoryDisplay;
