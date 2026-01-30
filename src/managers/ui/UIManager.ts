// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

import populationManager from '../population/PopulationManager';

// Interface for SceneManager to avoid circular dependencies
interface SceneManagerLike {
    getPopulationStats(): Record<string, unknown>;
}

// Interface for growth stats from PopulationManager
interface GrowthStats {
    currentRate: number;
    interval: number;
    totalTiles: number;
    averagePopulationPerTile: number;
    lastUpdated: string;
}

// Interface for population stats API response
interface PopulationApiStats {
    male?: number;
    female?: number;
    minors?: number;
    working_age?: number;
    elderly?: number;
    bachelors?: number;
    birthRate?: number;
    deathRate?: number;
    birthCount?: number;
    deathCount?: number;
    totalFamilies?: number;
    pregnantFamilies?: number;
    familiesWithChildren?: number;
    avgChildrenPerFamily?: number;
    totalPopulation?: number;
    villagesCount?: number;
}

// Interface for stats data
interface StatsData {
    totalPopulation?: number;
    male?: number;
    female?: number;
    minors?: number;
    working_age?: number;
    elderly?: number;
    bachelors?: number;
    birthRate?: number;
    deathRate?: number;
    birthCount?: number;
    deathCount?: number;
    totalFamilies?: number;
    pregnantFamilies?: number;
    familiesWithChildren?: number;
    avgChildrenPerFamily?: number;
    villagesCount?: number;
    totalTiles?: number;
    habitableTiles?: number;
    populatedTiles?: number;
    highPopulationTiles?: number;
    threshold?: number;
    redTiles?: number;
    biomes?: {
        tundra: { tiles: number; population: number };
        desert: { tiles: number; population: number };
        plains: { tiles: number; population: number };
        grassland: { tiles: number; population: number };
        alpine: { tiles: number; population: number };
    };
}

// Chart.js instance interface
interface ChartInstance {
    destroy(): void;
}

// Extended window interface for local use
interface ExtendedWindow {
    sceneManager?: SceneManagerLike;
    Chart?: {
        new(ctx: CanvasRenderingContext2D, config: Record<string, unknown>): ChartInstance;
    };
    vitalRatesChartInstance?: ChartInstance;
}

// Type assertion helper for window
const extendedWindow = window as unknown as ExtendedWindow;

class UIManager {
    private controlsPanel: HTMLElement | null;
    private toggleHelpButton: HTMLElement | null;
    private isInitialized: boolean;
    private populationUnsubscribe: (() => void) | null;
    private sceneManager: SceneManagerLike | null;
    private currentTotalPopulation: number;
    private isConnected: boolean;
    private loadingIndicator: HTMLElement | null;
    private messageTimeout: ReturnType<typeof setTimeout> | null;

    constructor(sceneManager: SceneManagerLike | null) {
        this.controlsPanel = null;
        this.toggleHelpButton = null;
        this.isInitialized = false;
        this.populationUnsubscribe = null;
        this.sceneManager = sceneManager; // Store sceneManager instance
        this.currentTotalPopulation = 0; // Store current total population
        this.isConnected = false; // Store connection status
        this.loadingIndicator = null; // Store loading indicator element
        this.messageTimeout = null; // Store message timeout
    }

    initialize(): void { // sceneManager parameter removed
        // this.sceneManager = sceneManager; // This line removed
        this.setupControlsPanel();
        this.setupPopulationDisplay();
        this.setupResetButtons();
        this.connectToPopulationManager();
        this.isInitialized = true;
    }

    getContainer(): HTMLElement {
        // Return the main container element where the renderer should be attached
        return document.getElementById('container') || document.body;
    }

    showLoadingIndicator(message: string = 'Loading...'): void {
        // Remove existing loading indicator if any
        this.hideLoadingIndicator();

        // Create loading indicator
        const indicator = document.createElement('div');
        indicator.className = 'loading-indicator';
        indicator.innerHTML = `
            <div class="loading-indicator-spinner"></div>
            <span>${message}</span>
        `;

        document.body.appendChild(indicator);
        this.loadingIndicator = indicator;
    }

    hideLoadingIndicator(): void {
        if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = null;
        }
    }

    showMessage(message: string, type: string = 'info', duration: number = 3000): void {
        // Clear any existing message timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        // Remove existing message if any
        const existingMessage = document.querySelector('.message-element');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = `message-element ${type}`;
        messageElement.textContent = message;

        document.body.appendChild(messageElement);

        // Show message with animation
        setTimeout(() => {
            messageElement.classList.add('visible');
        }, 10);

        // Auto-hide message after duration
        this.messageTimeout = setTimeout(() => {
            messageElement.classList.remove('visible');
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 300); // Wait for fade-out animation
        }, duration);
    }

    setupControlsPanel(): void {
        this.toggleHelpButton = document.getElementById('toggle-help');
        this.controlsPanel = document.getElementById('controls-help');

        if (this.toggleHelpButton && this.controlsPanel) {
            this.toggleHelpButton.addEventListener('click', () => {
                this.toggleControlsPanel();
            });

            // Initially show controls for a few seconds, then collapse
            setTimeout(() => {
                this.collapseControlsPanel();
            }, 5000);
        }
    }

    toggleControlsPanel(): void {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.toggle('collapsed');
        this.toggleHelpButton.textContent = this.controlsPanel.classList.contains('collapsed') ? '?' : '×';
    }

    collapseControlsPanel(): void {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.add('collapsed');
        this.toggleHelpButton.textContent = '?';
    }

    expandControlsPanel(): void {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.remove('collapsed');
        this.toggleHelpButton.textContent = '×';
    }

    setupPopulationDisplay(): void {
        // Move population display into the dashboard
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;

        // Remove old population panel if it exists
        const oldPanel = document.getElementById('population-panel');
        if (oldPanel) oldPanel.remove();

        // The year display logic is handled by the CalendarDisplay component
    }

    setupResetButtons(): void {
        const resetDataButton = document.getElementById('reset-data');
        const showStatsButton = document.getElementById('show-stats');
        const saveGameButton = document.getElementById('save-game');
        const loadGameButton = document.getElementById('load-game');

        if (resetDataButton) {
            resetDataButton.addEventListener('click', () => {
                this.handleResetData();
            });
        }

        if (showStatsButton) {
            showStatsButton.addEventListener('click', () => {
                this.handleShowStats();
            });
        }

        if (saveGameButton) {
            saveGameButton.addEventListener('click', () => {
                this.handleSaveGame();
            });
        }

        if (loadGameButton) {
            loadGameButton.addEventListener('click', () => {
                this.handleLoadGame();
            });
        }

        // Normalize dashboard buttons sizes and log pixel sizes for debugging
        this.measureAndNormalizeDashboardButtons();
    }

    /**
     * Measure the pixel heights of the dashboard buttons and normalize
     * If one button is smaller, apply a min-height so all match the tallest
     */
    measureAndNormalizeDashboardButtons(): void {
        try {
            const resetBtn = document.getElementById('reset-data');
            const statsBtn = document.getElementById('show-stats');
            const saveBtn = document.getElementById('save-game');
            const loadBtn = document.getElementById('load-game');
            if (!resetBtn || !statsBtn || !saveBtn || !loadBtn) return;

            const r = resetBtn.getBoundingClientRect();
            const s = statsBtn.getBoundingClientRect();
            const v = saveBtn.getBoundingClientRect();
            const l = loadBtn.getBoundingClientRect();

            const heights = { reset: Math.round(r.height), stats: Math.round(s.height), save: Math.round(v.height), load: Math.round(l.height) };
            // [log removed]

            const maxHeight = Math.max(heights.reset, heights.stats, heights.save, heights.load);
            // Apply min-height to all dashboard buttons to ensure uniform vertical size
            [resetBtn, statsBtn, saveBtn, loadBtn].forEach(btn => {
                btn.style.minHeight = maxHeight + 'px';
                // Also set line-height to center single-line content if needed
                btn.style.lineHeight = maxHeight + 'px';
            });
        } catch (err: unknown) {
            console.warn('Could not normalize dashboard button heights:', err instanceof Error ? (err as Error).message : err);
        }
    }

    async handleSaveGame(): Promise<void> {
        const saveButton = document.getElementById('save-game') as HTMLButtonElement | null;
        if (!saveButton) return;

        // Prevent double-clicking
        if (saveButton.disabled) return;

        const originalText = saveButton.innerHTML;
        saveButton.disabled = true;
        saveButton.classList.add('saving');
        saveButton.innerHTML = '⏳ Saving...';

        try {
            const response = await fetch('/api/save', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                saveButton.classList.remove('saving');
                saveButton.classList.add('saved');
                saveButton.innerHTML = '✅ Saved!';

                setTimeout(() => {
                    saveButton.innerHTML = originalText;
                    saveButton.classList.remove('saved');
                    saveButton.disabled = false;
                }, 2000);
            } else {
                throw new Error(result.error || 'Save failed');
            }
        } catch (error: unknown) {
            console.error('❌ Save failed:', error);
            saveButton.classList.remove('saving');
            saveButton.innerHTML = '❌ Failed';

            setTimeout(() => {
                saveButton.innerHTML = originalText;
                saveButton.disabled = false;
            }, 2000);
        }
    }

    async handleLoadGame(): Promise<void> {
        const loadButton = document.getElementById('load-game') as HTMLButtonElement | null;
        if (!loadButton) return;

        // Prevent double-clicking
        if (loadButton.disabled) return;

        const originalText = loadButton.innerHTML;
        loadButton.disabled = true;
        loadButton.classList.add('loading');
        loadButton.innerHTML = '⏳ Loading...';

        try {
            const response = await fetch('/api/sync', { method: 'POST' });
            const result = await response.json();

            if (result.success) {
                loadButton.classList.remove('loading');
                loadButton.classList.add('loaded');
                loadButton.innerHTML = '✅ Loaded!';

                // Reload the page to refresh all client state with the loaded data
                setTimeout(() => {
                    // [log removed]
                    window.location.reload();
                }, 500);
            } else {
                throw new Error(result.error || 'Load failed');
            }
        } catch (error: unknown) {
            console.error('❌ Load failed:', error);
            loadButton.classList.remove('loading');
            loadButton.innerHTML = '❌ Failed';

            setTimeout(() => {
                loadButton.innerHTML = originalText;
                loadButton.disabled = false;
            }, 2000);
        }
    }

    async handleResetData(): Promise<void> {
        if (!this.sceneManager) {
            console.error("SceneManager not available in UIManager for reset.");
            return;
        }

        // Require user confirmation before wiping all data
        const confirmed = window.confirm(
            '⚠️ WARNING: This will DELETE ALL POPULATION DATA permanently!\n\n' +
            'All people, families, and villages will be wiped and regenerated.\n\n' +
            'Are you absolutely sure you want to restart the world?'
        );

        if (!confirmed) {
            // [log removed]
            return;
        }

        try {
            // [log removed]
            // Single fast-reset endpoint handles: regenerate tiles/lands, reset & reinit population, seed villages
            // Must send confirmation token to prove intentional restart
            const fastResult = await this.fetchWithFallback([
                'http://localhost:3000/api/worldrestart', // hit backend directly first to avoid proxy empty responses
                '/api/worldrestart'
            ], {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
            });
            // [log removed]
        } catch (error: unknown) {
            console.error("❌ Error during data reset:", error);
            // Still reload even on error so state is consistent
        }
        // Always reload page after reset attempt to guarantee fresh client state
        // [log removed]
        window.location.reload();
    }

    // Try multiple URLs until one succeeds; throws if all fail
    async fetchWithFallback(urls: string[], options: RequestInit = {}): Promise<unknown> {
        let lastErr: Error | null = null;
        for (const url of urls) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout per attempt
                const resp = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timeoutId);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return await resp.json();
            } catch (err: unknown) {
                lastErr = err instanceof Error ? err : new Error(String(err));
                console.warn(`Fetch attempt failed for ${url}:`, lastErr.message);
            }
        }
        throw lastErr || new Error('All fetch attempts failed');
    }

    async handleShowStats(): Promise<void> {
        if (!extendedWindow.sceneManager) {
            this.showMessage('Scene manager not available', 'error');
            return;
        }

        try {
            // Show loading indicator while fetching
            this.showLoadingIndicator('Loading statistics...');

            // Get tile stats from sceneManager
            const stats = extendedWindow.sceneManager.getPopulationStats() as StatsData;
            // Fetch demographic stats from backend API (force fresh)
            const popData = await populationManager.makeApiRequest<PopulationApiStats>('/stats', 'GET');
            // Merge demographic stats if available
            if (popData) {
                if (typeof popData.male !== 'undefined') stats.male = Number(popData.male);
                if (typeof popData.female !== 'undefined') stats.female = Number(popData.female);
                if (typeof popData.minors !== 'undefined') stats.minors = Number(popData.minors);
                if (typeof popData.working_age !== 'undefined') stats.working_age = Number(popData.working_age);
                if (typeof popData.elderly !== 'undefined') stats.elderly = Number(popData.elderly);
                if (typeof popData.bachelors !== 'undefined') stats.bachelors = Number(popData.bachelors);
                if (typeof popData.birthRate !== 'undefined') stats.birthRate = Number(popData.birthRate);
                if (typeof popData.deathRate !== 'undefined') stats.deathRate = Number(popData.deathRate);
                if (typeof popData.birthCount !== 'undefined') stats.birthCount = Number(popData.birthCount);
                if (typeof popData.deathCount !== 'undefined') stats.deathCount = Number(popData.deathCount);
                if (typeof popData.totalFamilies !== 'undefined') stats.totalFamilies = Number(popData.totalFamilies);
                if (typeof popData.pregnantFamilies !== 'undefined') stats.pregnantFamilies = Number(popData.pregnantFamilies);
                if (typeof popData.familiesWithChildren !== 'undefined') stats.familiesWithChildren = Number(popData.familiesWithChildren);
                if (typeof popData.avgChildrenPerFamily !== 'undefined') stats.avgChildrenPerFamily = Number(popData.avgChildrenPerFamily);
                if (typeof popData.totalPopulation !== 'undefined') stats.totalPopulation = Number(popData.totalPopulation);
                if (typeof popData.villagesCount !== 'undefined') stats.villagesCount = Number(popData.villagesCount);
            }
            this.currentTotalPopulation = stats.totalPopulation ?? 0;
            const growthStats = populationManager.getGrowthStats();
            this.hideLoadingIndicator();
            this.showStatsModal(stats, growthStats);
            // [log removed]
        } catch (error: unknown) {
            this.hideLoadingIndicator();
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    showStatsModal(stats: StatsData, growthStats: GrowthStats): void {
        // Remove existing modal if any
        const existingModal = document.getElementById('stats-modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'stats-modal-overlay';
        overlay.classList.add('stats-modal-overlay');

        // Create modal
        const modal = document.createElement('div');
        modal.classList.add('stats-modal');

        // Modal Header
        const header = document.createElement('div');
        header.classList.add('stats-modal-header');
        header.innerHTML = '<h3>📊 Population Statistics</h3>';

        // Add Refresh button
        const refreshButton = document.createElement('button');
        refreshButton.classList.add('stats-modal-refresh');
        refreshButton.innerHTML = '⟳ Refresh';
        refreshButton.style.marginRight = '8px';
        refreshButton.onclick = async () => {
            refreshButton.disabled = true;
            refreshButton.textContent = 'Refreshing...';
            try {
                await this.handleShowStats();
            } finally {
                // The modal will be replaced, so no need to re-enable
            }
        };
        header.appendChild(refreshButton);

        const closeButton = document.createElement('button');
        closeButton.classList.add('stats-modal-close');
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => overlay.remove();
        header.appendChild(closeButton);

        // Modal Content
        const content = document.createElement('div');
        content.classList.add('stats-modal-content');
        content.innerHTML = `
            <p><strong>Total Population:</strong> <span id="stats-modal-total-population">${stats.totalPopulation?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Male Population:</strong> <span id="stats-modal-male-population">${stats.male?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Female Population:</strong> <span id="stats-modal-female-population">${stats.female?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Minors (under 16):</strong> <span id="stats-modal-minors">${stats.minors?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Working Age (16-60):</strong> <span id="stats-modal-working-age">${stats.working_age?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Elderly (over 60):</strong> <span id="stats-modal-elderly">${stats.elderly?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Bachelors:</strong> <span id="stats-modal-bachelors">${stats.bachelors?.toLocaleString() ?? 'N/A'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Total Families:</strong> <span id="stats-modal-total-families">${stats.totalFamilies?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Pregnant Families:</strong> <span id="stats-modal-pregnant-families">${stats.pregnantFamilies?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Families with Children:</strong> <span id="stats-modal-families-with-children">${stats.familiesWithChildren?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Avg. Children per Family:</strong> <span id="stats-modal-avg-children">${stats.avgChildrenPerFamily?.toFixed(1) ?? '0.0'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Birth Rate:</strong> <span id="stats-modal-birth-rate">${stats.birthRate?.toFixed(2) ?? '0.00'} %</span></p>
            <p><strong>Death Rate:</strong> <span id="stats-modal-death-rate">${stats.deathRate?.toFixed(2) ?? '0.00'} %</span></p>
            <p><strong>Total Births:</strong> <span id="stats-modal-birth-count">${stats.birthCount?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Total Deaths:</strong> <span id="stats-modal-death-count">${stats.deathCount?.toLocaleString() ?? '0'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Total Tiles:</strong> ${stats.totalTiles}</p>
            <p><strong>Total Villages:</strong> <span id="stats-modal-total-villages">${stats.villagesCount?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Habitable Tiles:</strong> ${stats.habitableTiles}</p>
            <p><strong>Populated Tiles:</strong> ${stats.populatedTiles}</p>
            <p><strong>High Pop Tiles (≥${stats.threshold}):</strong> ${stats.highPopulationTiles}</p>
            <p><strong>Red Tiles:</strong> ${stats.redTiles}</p>
            ${stats.biomes ? `
            <hr class="stats-modal-separator">
            <h4>🌿 Biome Distribution</h4>
            <p><strong>🏔️ Tundra:</strong> ${stats.biomes.tundra.tiles} tiles (${stats.biomes.tundra.population.toLocaleString()} people)</p>
            <p><strong>🏜️ Desert:</strong> ${stats.biomes.desert.tiles} tiles (${stats.biomes.desert.population.toLocaleString()} people)</p>
            <p><strong>🌾 Plains:</strong> ${stats.biomes.plains.tiles} tiles (${stats.biomes.plains.population.toLocaleString()} people)</p>
            <p><strong>🌱 Grassland:</strong> ${stats.biomes.grassland.tiles} tiles (${stats.biomes.grassland.population.toLocaleString()} people)</p>
            <p><strong>⛰️ Alpine:</strong> ${stats.biomes.alpine.tiles} tiles (${stats.biomes.alpine.population.toLocaleString()} people)</p>
            ` : ''}
            <hr class="stats-modal-separator">
            <div style="margin: 24px 0;">
                <h4>Vital Rates (per 1000 people, last 100 years)</h4>
                <canvas id="vital-rates-chart" width="600" height="300"></canvas>
            </div>
        `;

        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Render the vital rates chart
        this.renderVitalRatesChart();

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });
    }

    async renderVitalRatesChart(): Promise<void> {
        try {
            const response = await fetch('/api/statistics/vital-rates/100');
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Failed to fetch vital rates');
            const chartData = result.data;

            if (!extendedWindow.Chart) {
                throw new Error('Chart.js is not loaded. Please include <script src="https://cdn.jsdelivr.net/npm/chart.js"></script> in your HTML.');
            }

            const chartCanvas = document.getElementById('vital-rates-chart') as HTMLCanvasElement | null;
            if (!chartCanvas) {
                throw new Error('Chart container not found in the DOM.');
            }
            const ctx = chartCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to get 2D context for vital rates chart.');
            }

            if (extendedWindow.vitalRatesChartInstance) {
                extendedWindow.vitalRatesChartInstance.destroy();
            }
            extendedWindow.vitalRatesChartInstance = new extendedWindow.Chart(ctx, {
                type: 'line',
                data: chartData,
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'top' },
                        title: { display: true, text: 'Birth and Death Rates per 1000 People' }
                    },
                    scales: {
                        x: { title: { display: true, text: 'Year' } },
                        y: { title: { display: true, text: 'Rate per 1000' } }
                    }
                }
            });
        } catch (err: unknown) {
            const chartContainer = document.getElementById('vital-rates-chart');
            if (chartContainer) {
                chartContainer.outerHTML = `<div style="color:red;">Failed to load vital rates chart: ${err instanceof Error ? (err as Error).message : err}</div>`;
            }
        }
    }

    connectToPopulationManager(): void {
        this.populationUnsubscribe = populationManager.subscribe((eventType: string, eventData: unknown) => {
            if (eventType === 'connected') {
                this.isConnected = eventData as boolean;
            }
            // Do NOT update currentTotalPopulation on populationUpdate anymore
        });
        populationManager.connect();
    }

    updateStatsModalPopulation(): void {
        const totalPopElement = document.getElementById('stats-modal-total-population');
        if (totalPopElement) { // Check if modal is open and element exists
            totalPopElement.textContent = this.currentTotalPopulation.toLocaleString();
        }
    }

    cleanup(): void {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        // Remove controls panel if it exists
        if (this.controlsPanel) {
            this.controlsPanel.remove();
            this.controlsPanel = null;
        }
        this.isInitialized = false;
    }
}

export default UIManager;
