// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

import populationManager, { RustTickData } from '../population/PopulationManager';
import { getAppContext } from '../../core/AppContext';
import { getApiClient } from '../../services/api/ApiClient';
import type { Demographics, VitalStatistics } from '../../services/api/ApiClient';

// Interface for SceneManager to avoid circular dependencies
interface SceneManagerLike {
    getPopulationStats(): Record<string, unknown>;
    regenerateTiles(): Promise<void>;
    createHexasphere(): Promise<void>;
    searchTile(tileId: number | string): { x: number; y: number; z: number } | null;
}

// Interface for CameraController to avoid circular dependencies
interface CameraControllerLike {
    lookAtPoint(point: { x: number; y: number; z: number }): void;
}

// Interface for stats data (from SceneManager.getPopulationStats)
interface StatsData {
    totalPopulation?: number;
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

/** Create a stat row HTML */
function statRow(label: string, value: string, id?: string): string {
    const idAttr = id ? ` id="${id}"` : '';
    return `<p><strong>${label}:</strong> <span${idAttr}>${value}</span></p>`;
}

class UIManager {
    private populationUnsubscribe: (() => void) | null;
    private sceneManager: SceneManagerLike | null;
    private cameraController: CameraControllerLike | null;
    private currentTotalPopulation: number;
    private loadingIndicator: HTMLElement | null;
    private messageTimeout: ReturnType<typeof setTimeout> | null;
    private gameKeyHandler: ((e: KeyboardEvent) => void) | null;

    constructor(sceneManager: SceneManagerLike | null) {
        this.populationUnsubscribe = null;
        this.sceneManager = sceneManager;
        this.cameraController = null;
        this.currentTotalPopulation = 0;
        this.loadingIndicator = null;
        this.messageTimeout = null;
        this.gameKeyHandler = null;
    }

    /** Set the camera controller for tile search functionality */
    setCameraController(controller: CameraControllerLike): void {
        this.cameraController = controller;
    }

    initialize(): void {
        this.setupControlsPanel();
        this.setupPopulationDisplay();
        this.setupResetButtons();
        this.connectToPopulationManager();
    }

    getContainer(): HTMLElement {
        return document.getElementById('container') || document.body;
    }

    showLoadingIndicator(message: string = 'Loading...'): void {
        this.hideLoadingIndicator();
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
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }
        const existingMessage = document.querySelector('.message-element');
        if (existingMessage) {
            existingMessage.remove();
        }
        const messageElement = document.createElement('div');
        messageElement.className = `message-element ${type}`;
        messageElement.textContent = message;
        document.body.appendChild(messageElement);
        setTimeout(() => {
            messageElement.classList.add('visible');
        }, 10);
        this.messageTimeout = setTimeout(() => {
            messageElement.classList.remove('visible');
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 300);
        }, duration);
    }

    setupControlsPanel(): void {
        this.setupHelpModal();
    }

    /**
     * Setup a modal with toggle button, close button, and backdrop click.
     * Pauses/resumes calendar when opening/closing.
     */
    private setupModal(buttonId: string, overlayId: string, closeSelector: string): void {
        const btn = document.getElementById(buttonId);
        const overlay = document.getElementById(overlayId);
        const closeBtn = overlay?.querySelector(closeSelector);

        if (!btn || !overlay) return;

        const open = () => {
            overlay.classList.remove('hidden');
        };

        const close = () => {
            overlay.classList.add('hidden');
        };

        btn.addEventListener('click', () => {
            if (overlay.classList.contains('hidden')) {
                open();
            } else {
                close();
            }
        });

        closeBtn?.addEventListener('click', close);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    }

    private setupHelpModal(): void {
        this.setupModal('toggle-help', 'help-modal-overlay', '.help-modal-close');
    }

    setupPopulationDisplay(): void {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;
        const oldPanel = document.getElementById('population-panel');
        if (oldPanel) oldPanel.remove();
    }

    setupResetButtons(): void {
        const resetDataButton = document.getElementById('reset-data');
        const showStatsButton = document.getElementById('show-stats');
        const saveGameButton = document.getElementById('save-game');
        const loadGameButton = document.getElementById('load-game');

        if (resetDataButton) {
            resetDataButton.addEventListener('click', () => {
                const menuOverlay = document.getElementById('menu-modal-overlay');
                if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
                    menuOverlay.classList.add('hidden');
                }
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

        this.setupTileSearchModal();
        this.setupMenuModal();
    }

    private setupTileSearchModal(): void {
        const modal = document.getElementById('tile-search-modal');
        const input = document.getElementById('tile-search-input') as HTMLInputElement | null;
        const btn = document.getElementById('tile-search-btn');
        if (!modal || !input) return;

        const doSearch = () => {
            const tileId = input.value.trim();
            if (tileId) {
                this.handleSearchTile(tileId);
                input.value = '';
                modal.classList.add('hidden');
            }
        };

        btn?.addEventListener('click', doSearch);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                doSearch();
            } else if (e.key === 'Escape') {
                modal.classList.add('hidden');
            }
        });
    }

    private setupMenuModal(): void {
        this.setupModal('menu-btn', 'menu-modal-overlay', '.menu-modal-close');

        const menuOverlay = document.getElementById('menu-modal-overlay');
        const searchModal = document.getElementById('tile-search-modal');
        const searchInput = document.getElementById('tile-search-input') as HTMLInputElement | null;

        this.gameKeyHandler = (e: KeyboardEvent) => {
            // Don't handle keys when typing in an input
            if (e.target instanceof HTMLInputElement) return;

            if (e.key === 'Escape' && menuOverlay) {
                // Close search modal if open
                if (searchModal && !searchModal.classList.contains('hidden')) {
                    searchModal.classList.add('hidden');
                    return;
                }
                // Toggle menu modal
                if (menuOverlay.classList.contains('hidden')) {
                    menuOverlay.classList.remove('hidden');
                } else {
                    menuOverlay.classList.add('hidden');
                }
            }

            if (e.key === 'f' && searchModal && searchInput) {
                // Don't open if menu modal is showing
                if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;

                if (searchModal.classList.contains('hidden')) {
                    searchModal.classList.remove('hidden');
                    searchInput.value = '';
                    searchInput.focus();
                } else {
                    searchModal.classList.add('hidden');
                }
            }
        };
        window.addEventListener('keydown', this.gameKeyHandler);
    }

    async handleSaveGame(): Promise<void> {
        const saveButton = document.getElementById('save-game') as HTMLButtonElement | null;
        if (!saveButton) return;
        if (saveButton.disabled) return;

        const originalText = saveButton.innerHTML;
        saveButton.disabled = true;
        saveButton.classList.add('saving');
        saveButton.innerHTML = '⏳ Saving...';

        try {
            await getApiClient().saveWorld('saves/world.bin');

            saveButton.classList.remove('saving');
            saveButton.classList.add('saved');
            saveButton.innerHTML = '✅ Saved!';

            setTimeout(() => {
                saveButton.innerHTML = originalText;
                saveButton.classList.remove('saved');
                saveButton.disabled = false;
            }, 2000);
        } catch (error: unknown) {
            console.error('Save failed:', error);
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
        if (loadButton.disabled) return;

        const originalText = loadButton.innerHTML;
        loadButton.disabled = true;
        loadButton.classList.add('loading');
        loadButton.innerHTML = '⏳ Loading...';

        try {
            await getApiClient().loadWorld('saves/world.bin');

            // Regenerate the world with loaded seed (no page reload)
            if (this.sceneManager) {
                await this.sceneManager.createHexasphere();

                const ctx = getAppContext();
                if (ctx.calendarManager?.initialize) {
                    await ctx.calendarManager.initialize();
                }
            }

            loadButton.classList.remove('loading');
            loadButton.classList.add('loaded');
            loadButton.innerHTML = '✅ Loaded!';

            setTimeout(() => {
                loadButton.innerHTML = originalText;
                loadButton.classList.remove('loaded');
                loadButton.disabled = false;
            }, 2000);
        } catch (error: unknown) {
            console.error('Load failed:', error);
            loadButton.classList.remove('loading');
            loadButton.classList.add('error');
            loadButton.innerHTML = '❌ Load Failed';

            setTimeout(() => {
                loadButton.innerHTML = originalText;
                loadButton.classList.remove('error');
                loadButton.disabled = false;
            }, 3000);
        }
    }

    async handleResetData(): Promise<void> {
        if (!this.sceneManager) {
            console.error("SceneManager not available in UIManager for reset.");
            return;
        }

        try {
            await this.sceneManager.regenerateTiles();
        } catch (error: unknown) {
            console.error("Error during world restart:", error);
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

        if (this.cameraController) {
            this.cameraController.lookAtPoint(tileCenter);
        }
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

            // Fetch demographics from Rust
            let demographics: Demographics | null = null;
            try {
                demographics = await getApiClient().getDemographics();
                this.currentTotalPopulation = demographics.population;
                stats.totalPopulation = demographics.population;
            } catch (e) {
                this.currentTotalPopulation = stats.totalPopulation ?? 0;
            }

            // Fetch vital statistics
            let vitalStats: VitalStatistics | null = null;
            try {
                vitalStats = await getApiClient().getRecentStatistics(100);
            } catch {
                // Vital stats not critical
            }

            this.hideLoadingIndicator();
            this.showStatsModal(stats, demographics, vitalStats);
        } catch (error: unknown) {
            this.hideLoadingIndicator();
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    showStatsModal(stats: StatsData, demographics?: Demographics | null, vitalStats?: VitalStatistics | null): void {
        document.getElementById('stats-modal-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'stats-modal-overlay';
        overlay.className = 'stats-modal-overlay';
        overlay.innerHTML = this.generateStatsModalHTML(stats, demographics, vitalStats);
        document.body.appendChild(overlay);

        this.attachStatsModalHandlers(overlay);
        this.renderVitalRatesChart();
    }

    /** Generate stats modal HTML content */
    private generateStatsModalHTML(stats: StatsData, demographics?: Demographics | null, vitalStats?: VitalStatistics | null): string {
        const SEP = '<hr class="stats-modal-separator">';

        // Biome section
        const biomeSection = stats.biomes ? `
            ${SEP}
            <h4>Biome Distribution</h4>
            ${this.biomeRow('Tundra', stats.biomes.tundra)}
            ${this.biomeRow('Desert', stats.biomes.desert)}
            ${this.biomeRow('Plains', stats.biomes.plains)}
            ${this.biomeRow('Grassland', stats.biomes.grassland)}
            ${this.biomeRow('Alpine', stats.biomes.alpine)}
        ` : '';

        // Demographics section (from Rust ECS)
        const demoSection = demographics ? (() => {
            const d = demographics;
            const sexRatio = d.females > 0 ? (d.males / d.females).toFixed(2) : 'N/A';
            const partnerPct = d.population > 0 ? ((d.partnered / d.population) * 100).toFixed(1) : '0.0';
            const brackets = [
                { label: '0-4', count: d.age_brackets[0] },
                { label: '5-14', count: d.age_brackets[1] },
                { label: '15-29', count: d.age_brackets[2] },
                { label: '30-49', count: d.age_brackets[3] },
                { label: '50-69', count: d.age_brackets[4] },
                { label: '70-89', count: d.age_brackets[5] },
                { label: '90+', count: d.age_brackets[6] },
            ];
            const maxCount = Math.max(...brackets.map(b => b.count), 1);
            const barRows = brackets.map(b => {
                const pct = d.population > 0 ? ((b.count / d.population) * 100).toFixed(1) : '0.0';
                const barWidth = Math.round((b.count / maxCount) * 100);
                return `<div style="display:flex;align-items:center;margin:2px 0;gap:6px;">
                    <span style="width:40px;text-align:right;font-size:0.85em;color:#aaa;">${b.label}</span>
                    <div style="flex:1;background:#333;border-radius:3px;overflow:hidden;height:16px;">
                        <div style="width:${barWidth}%;background:linear-gradient(90deg,#4a90d9,#67b8e3);height:100%;border-radius:3px;"></div>
                    </div>
                    <span style="width:80px;font-size:0.85em;color:#ccc;">${b.count.toLocaleString()} (${pct}%)</span>
                </div>`;
            }).join('');

            return `
                ${SEP}
                <h4>Demographics</h4>
                ${statRow('Population', d.population.toLocaleString())}
                ${statRow('Males / Females', `${d.males.toLocaleString()} / ${d.females.toLocaleString()} (ratio: ${sexRatio})`)}
                ${statRow('Partnered', `${d.partnered.toLocaleString()} (${partnerPct}%)`)}
                ${statRow('Single', d.single.toLocaleString())}
                ${statRow('Pregnant', (d.pregnant ?? 0).toLocaleString())}
                ${statRow('Average Age', d.average_age.toFixed(1) + ' years')}
                <div style="margin-top:8px;">
                    <strong>Age Distribution:</strong>
                    <div style="margin-top:4px;">${barRows}</div>
                </div>
            `;
        })() : '';

        // Vital statistics section
        const vitalSection = vitalStats ? `
            ${SEP}
            ${statRow('Birth Rate', fmtPct(vitalStats.birth_rate) + ' per 1000')}
            ${statRow('Death Rate', fmtPct(vitalStats.death_rate) + ' per 1000')}
            ${statRow('Marriage Rate', fmtPct(vitalStats.marriage_rate) + ' per 1000')}
            ${statRow('Total Births', fmt(vitalStats.total_births, '0'))}
            ${statRow('Total Deaths', fmt(vitalStats.total_deaths, '0'))}
            ${statRow('Total Marriages', fmt(vitalStats.total_marriages, '0'))}
        ` : '';

        return `
            <div class="stats-modal">
                <div class="stats-modal-header">
                    <h3>Population Statistics</h3>
                    <button class="stats-modal-close">&times;</button>
                </div>
                <div class="stats-modal-content">
                    ${statRow('Total Population', fmt(stats.totalPopulation), 'stats-modal-total-population')}
                    ${SEP}
                    ${statRow('Total Tiles', String(stats.totalTiles ?? 'N/A'))}
                    ${statRow('Habitable Tiles', String(stats.habitableTiles ?? 'N/A'))}
                    ${statRow('Populated Tiles', String(stats.populatedTiles ?? 'N/A'))}
                    ${statRow('High Pop Tiles (>=' + (stats.threshold ?? 0) + ')', String(stats.highPopulationTiles ?? 'N/A'))}
                    ${statRow('Red Tiles', String(stats.redTiles ?? 'N/A'))}
                    ${biomeSection}
                    ${demoSection}
                    ${vitalSection}
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
        const closeBtn = overlay.querySelector('.stats-modal-close');

        const closeStats = () => {
            overlay.remove();
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', closeStats);
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeStats();
        });
    }

    async renderVitalRatesChart(): Promise<void> {
        try {
            // Get vital statistics from Rust for chart data
            const vitalStats = await getApiClient().getRecentStatistics(100);

            if (!extendedWindow.Chart) {
                throw new Error('Chart.js is not loaded.');
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

            // Build simple chart data from vital statistics
            const chartData = {
                labels: ['Recent'],
                datasets: [
                    {
                        label: 'Birth Rate',
                        data: [vitalStats.birth_rate],
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1,
                    },
                    {
                        label: 'Death Rate',
                        data: [vitalStats.death_rate],
                        borderColor: 'rgb(255, 99, 132)',
                        tension: 0.1,
                    },
                ],
            };

            extendedWindow.vitalRatesChartInstance = new extendedWindow.Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'top' },
                        title: { display: true, text: 'Birth and Death Rates per 1000 People' }
                    },
                    scales: {
                        y: { title: { display: true, text: 'Rate per 1000' } }
                    }
                }
            });
        } catch (err: unknown) {
            const chartContainer = document.getElementById('vital-rates-chart');
            if (chartContainer) {
                chartContainer.outerHTML = `<div style="color:red;">Failed to load vital rates chart: ${err instanceof Error ? err.message : err}</div>`;
            }
        }
    }

    connectToPopulationManager(): void {
        this.populationUnsubscribe = populationManager.subscribe((eventType: string, eventData: unknown) => {
            if (eventType === 'rustPopulation') {
                const rustData = eventData as RustTickData;
                this.currentTotalPopulation = rustData.population;
                this.updatePopulationDisplay(rustData);
            }
        });

        // Fetch initial population (in case connect() was already called)
        const initialPopulation = populationManager.getTotalPopulation();
        this.currentTotalPopulation = initialPopulation;
        const popEl = document.getElementById('pop-value');
        if (popEl) {
            popEl.textContent = initialPopulation.toLocaleString();
        }
    }

    // Update the population display in real-time
    private lastDisplayedPop: number = -1;

    updatePopulationDisplay(data: RustTickData): void {
        if (data.population === this.lastDisplayedPop) return;
        this.lastDisplayedPop = data.population;

        const popEl = document.getElementById('pop-value');
        if (popEl) {
            popEl.textContent = data.population.toLocaleString();
        }
        this.updateStatsModalPopulation();
    }

    updateStatsModalPopulation(): void {
        const totalPopElement = document.getElementById('stats-modal-total-population');
        if (totalPopElement) {
            totalPopElement.textContent = this.currentTotalPopulation.toLocaleString();
        }
    }

    cleanup(): void {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        if (this.gameKeyHandler) {
            window.removeEventListener('keydown', this.gameKeyHandler);
            this.gameKeyHandler = null;
        }
    }
}

export default UIManager;
