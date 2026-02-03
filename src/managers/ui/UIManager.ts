// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

import populationManager from '../population/PopulationManager';
import { getAppContext } from '../../core/AppContext';
import { getApiClient } from '../../services/api/ApiClient';

// Interface for SceneManager to avoid circular dependencies
interface SceneManagerLike {
    getPopulationStats(): Record<string, unknown>;
    regenerateTiles(): Promise<void>;
    searchTile(tileId: number | string): { x: number; y: number; z: number } | null;
}

// Interface for CameraController to avoid circular dependencies
interface CameraControllerLike {
    lookAtPoint(point: { x: number; y: number; z: number }): void;
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
    totalBirthCount?: number;
    totalDeathCount?: number;
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
    totalBirthCount?: number;
    totalDeathCount?: number;
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

// ============ HTML Template Helpers ============

/** Format a number for display, with fallback */
function fmt(value: number | undefined, fallback = 'N/A'): string {
    return value !== undefined ? value.toLocaleString() : fallback;
}

/** Format a percentage for display */
function fmtPct(value: number | undefined, fallback = '0.00'): string {
    return value !== undefined ? value.toFixed(2) : fallback;
}

/** Format a decimal for display */
function fmtDec(value: number | undefined, decimals = 1, fallback = '0.0'): string {
    return value !== undefined ? value.toFixed(decimals) : fallback;
}

/** Create a stat row HTML */
function statRow(label: string, value: string, id?: string): string {
    const idAttr = id ? ` id="${id}"` : '';
    return `<p><strong>${label}:</strong> <span${idAttr}>${value}</span></p>`;
}

/** Merge API stats into stats object */
function mergeApiStats(stats: StatsData, popData: PopulationApiStats): void {
    const keys: (keyof PopulationApiStats)[] = [
        'male', 'female', 'minors', 'working_age', 'elderly', 'bachelors',
        'birthRate', 'deathRate', 'birthCount', 'deathCount',
        'totalBirthCount', 'totalDeathCount',
        'totalFamilies', 'pregnantFamilies', 'familiesWithChildren',
        'avgChildrenPerFamily', 'totalPopulation', 'villagesCount',
        'totalTiles'  // Use server's tile count (more accurate after world restart)
    ];
    for (const key of keys) {
        if (popData[key] !== undefined) {
            (stats as Record<string, number>)[key] = Number(popData[key]);
        }
    }
    // Also update populatedTiles from server data if available
    if (popData.totalTiles !== undefined) {
        stats.populatedTiles = Number(popData.totalTiles);
    }
}

class UIManager {
    private controlsPanel: HTMLElement | null;
    private toggleHelpButton: HTMLElement | null;
    private isInitialized: boolean;
    private populationUnsubscribe: (() => void) | null;
    private sceneManager: SceneManagerLike | null;
    private cameraController: CameraControllerLike | null;
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
        this.cameraController = null;
        this.currentTotalPopulation = 0; // Store current total population
        this.isConnected = false; // Store connection status
        this.loadingIndicator = null; // Store loading indicator element
        this.messageTimeout = null; // Store message timeout
    }

    /** Set the camera controller for tile search functionality */
    setCameraController(controller: CameraControllerLike): void {
        this.cameraController = controller;
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
        const tileSearchInput = document.getElementById('tile-search-input') as HTMLInputElement | null;
        const tileSearchBtn = document.getElementById('tile-search-btn');

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

        // Tile search functionality
        const handleTileSearch = () => {
            if (tileSearchInput) {
                const tileId = tileSearchInput.value.trim();
                if (tileId) {
                    this.handleSearchTile(tileId);
                }
            }
        };

        if (tileSearchBtn) {
            tileSearchBtn.addEventListener('click', handleTileSearch);
        }

        if (tileSearchInput) {
            tileSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    handleTileSearch();
                }
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
            const result = await getApiClient().saveGame();

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
            const result = await getApiClient().syncGame();

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

        // Use SceneManager's regenerateTiles which handles confirmation and in-place refresh
        try {
            await this.sceneManager.regenerateTiles();
        } catch (error: unknown) {
            console.error("❌ Error during world restart:", error);
        }
    }

    handleSearchTile(tileId: string): void {
        if (!this.sceneManager) {
            console.error("SceneManager not available for tile search.");
            return;
        }

        const id = parseInt(tileId, 10);
        if (isNaN(id) || id < 0) {
            console.warn('Invalid tile ID:', tileId);
            return;
        }

        const tileCenter = this.sceneManager.searchTile(id);

        if (!tileCenter) {
            console.warn(`Tile ${id} not found`);
            return;
        }

        // Point camera at the tile
        if (this.cameraController) {
            this.cameraController.lookAtPoint(tileCenter);
        }
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
        const ctx = getAppContext();
        if (!ctx.sceneManager) {
            this.showMessage('Scene manager not available', 'error');
            return;
        }

        try {
            this.showLoadingIndicator('Loading statistics...');

            // Get tile stats from sceneManager
            const stats = (ctx.sceneManager.getPopulationStats?.() ?? {}) as StatsData;

            // Fetch and merge demographic stats from backend API
            const popData = await populationManager.makeApiRequest<PopulationApiStats>('/stats', 'GET');
            if (popData) {
                mergeApiStats(stats, popData);
            }

            this.currentTotalPopulation = stats.totalPopulation ?? 0;
            const growthStats = populationManager.getGrowthStats();
            this.hideLoadingIndicator();
            this.showStatsModal(stats, growthStats);
        } catch (error: unknown) {
            this.hideLoadingIndicator();
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    showStatsModal(stats: StatsData, _growthStats: GrowthStats): void {
        // Remove existing modal if any
        document.getElementById('stats-modal-overlay')?.remove();

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'stats-modal-overlay';
        overlay.className = 'stats-modal-overlay';
        overlay.innerHTML = this.generateStatsModalHTML(stats);
        document.body.appendChild(overlay);

        // Attach event handlers
        this.attachStatsModalHandlers(overlay);

        // Render the vital rates chart
        this.renderVitalRatesChart();
    }

    /** Generate stats modal HTML content */
    private generateStatsModalHTML(stats: StatsData): string {
        const SEP = '<hr class="stats-modal-separator">';

        // Biome section
        const biomeSection = stats.biomes ? `
            ${SEP}
            <h4>🌿 Biome Distribution</h4>
            ${this.biomeRow('🏔️ Tundra', stats.biomes.tundra)}
            ${this.biomeRow('🏜️ Desert', stats.biomes.desert)}
            ${this.biomeRow('🌾 Plains', stats.biomes.plains)}
            ${this.biomeRow('🌱 Grassland', stats.biomes.grassland)}
            ${this.biomeRow('⛰️ Alpine', stats.biomes.alpine)}
        ` : '';

        return `
            <div class="stats-modal">
                <div class="stats-modal-header">
                    <h3>📊 Population Statistics</h3>
                    <button class="stats-modal-refresh" style="margin-right:8px">⟳ Refresh</button>
                    <button class="stats-modal-close">&times;</button>
                </div>
                <div class="stats-modal-content">
                    ${statRow('Total Population', fmt(stats.totalPopulation), 'stats-modal-total-population')}
                    ${statRow('Male Population', fmt(stats.male), 'stats-modal-male-population')}
                    ${statRow('Female Population', fmt(stats.female), 'stats-modal-female-population')}
                    ${statRow('Minors (under 16)', fmt(stats.minors), 'stats-modal-minors')}
                    ${statRow('Working Age (16-60)', fmt(stats.working_age), 'stats-modal-working-age')}
                    ${statRow('Elderly (over 60)', fmt(stats.elderly), 'stats-modal-elderly')}
                    ${statRow('Bachelors', fmt(stats.bachelors), 'stats-modal-bachelors')}
                    ${SEP}
                    ${statRow('Total Families', fmt(stats.totalFamilies, '0'), 'stats-modal-total-families')}
                    ${statRow('Pregnant Families', fmt(stats.pregnantFamilies, '0'), 'stats-modal-pregnant-families')}
                    ${statRow('Families with Children', fmt(stats.familiesWithChildren, '0'), 'stats-modal-families-with-children')}
                    ${statRow('Avg. Children per Family', fmtDec(stats.avgChildrenPerFamily), 'stats-modal-avg-children')}
                    ${SEP}
                    ${statRow('Birth Rate', fmtPct(stats.birthRate) + ' %', 'stats-modal-birth-rate')}
                    ${statRow('Death Rate', fmtPct(stats.deathRate) + ' %', 'stats-modal-death-rate')}
                    ${statRow('Total Births', fmt(stats.totalBirthCount, '0'), 'stats-modal-birth-count')}
                    ${statRow('Total Deaths', fmt(stats.totalDeathCount, '0'), 'stats-modal-death-count')}
                    ${SEP}
                    ${statRow('Total Tiles', String(stats.totalTiles ?? 'N/A'))}
                    ${statRow('Total Villages', fmt(stats.villagesCount, '0'), 'stats-modal-total-villages')}
                    ${statRow('Habitable Tiles', String(stats.habitableTiles ?? 'N/A'))}
                    ${statRow('Populated Tiles', String(stats.populatedTiles ?? 'N/A'))}
                    ${statRow(`High Pop Tiles (≥${stats.threshold ?? 0})`, String(stats.highPopulationTiles ?? 'N/A'))}
                    ${statRow('Red Tiles', String(stats.redTiles ?? 'N/A'))}
                    ${biomeSection}
                    ${SEP}
                    <div style="margin: 24px 0;">
                        <h4>Vital Rates (per 1000 people, last 100 years)</h4>
                        <canvas id="vital-rates-chart" width="600" height="300"></canvas>
                    </div>
                </div>
            </div>
        `;
    }

    /** Generate biome row HTML */
    private biomeRow(label: string, biome: { tiles: number; population: number }): string {
        return `<p><strong>${label}:</strong> ${biome.tiles} tiles (${biome.population.toLocaleString()} people)</p>`;
    }

    /** Attach event handlers to stats modal */
    private attachStatsModalHandlers(overlay: HTMLElement): void {
        const refreshBtn = overlay.querySelector('.stats-modal-refresh') as HTMLButtonElement;
        const closeBtn = overlay.querySelector('.stats-modal-close');

        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                refreshBtn.disabled = true;
                refreshBtn.textContent = 'Refreshing...';
                await this.handleShowStats();
            };
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => overlay.remove());
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
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
