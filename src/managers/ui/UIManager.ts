// UI Manager Module
// Handles UI controls, modals, and population display
// Statistics rendering delegated to StatsRenderer

import populationManager, { RustTickData } from '../population/PopulationManager';
import { getAppContext } from '../../core/AppContext';
import { getApiClient } from '../../services/api/ApiClient';
import type { Demographics, VitalStatistics } from '../../services/api/ApiClient';
import {
    generateStatsModalHTML,
    renderVitalRatesChart,
    attachStatsModalHandlers,
    type StatsData,
} from './StatsRenderer';

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

class UIManager {
    private populationUnsubscribe: (() => void) | null;
    private sceneManager: SceneManagerLike | null;
    private cameraController: CameraControllerLike | null;
    private currentTotalPopulation: number;
    private loadingIndicator: HTMLElement | null;
    private messageTimeout: ReturnType<typeof setTimeout> | null;
    private abortController: AbortController;
    private lastDisplayedPop: number = -1;

    constructor(sceneManager: SceneManagerLike | null) {
        this.populationUnsubscribe = null;
        this.sceneManager = sceneManager;
        this.cameraController = null;
        this.currentTotalPopulation = 0;
        this.loadingIndicator = null;
        this.messageTimeout = null;
        this.abortController = new AbortController();
    }

    setCameraController(controller: CameraControllerLike): void {
        this.cameraController = controller;
    }

    initialize(): void {
        this.setupHelpModal();
        this.setupPopulationDisplay();
        this.setupActionButtons();
        this.connectToPopulationManager();
    }

    // ============ Loading & Messages ============

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
        if (existingMessage) existingMessage.remove();

        const messageElement = document.createElement('div');
        messageElement.className = `message-element ${type}`;
        messageElement.textContent = message;
        document.body.appendChild(messageElement);

        setTimeout(() => messageElement.classList.add('visible'), 10);
        this.messageTimeout = setTimeout(() => {
            messageElement.classList.remove('visible');
            setTimeout(() => {
                if (messageElement.parentNode) messageElement.remove();
            }, 300);
        }, duration);
    }

    // ============ Modal Setup ============

    private setupModal(buttonId: string, overlayId: string, closeSelector: string): void {
        const btn = document.getElementById(buttonId);
        const overlay = document.getElementById(overlayId);
        const closeBtn = overlay?.querySelector(closeSelector);
        const signal = this.abortController.signal;

        if (!btn || !overlay) return;

        const open = () => overlay.classList.remove('hidden');
        const close = () => overlay.classList.add('hidden');

        btn.addEventListener('click', () => {
            overlay.classList.contains('hidden') ? open() : close();
        }, { signal });

        closeBtn?.addEventListener('click', close, { signal });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        }, { signal });
    }

    private setupHelpModal(): void {
        this.setupModal('toggle-help', 'help-modal-overlay', '.help-modal-close');
    }

    // ============ Population Display ============

    private setupPopulationDisplay(): void {
        const oldPanel = document.getElementById('population-panel');
        if (oldPanel) oldPanel.remove();
    }

    private connectToPopulationManager(): void {
        this.populationUnsubscribe = populationManager.subscribe((eventType: string, eventData: unknown) => {
            if (eventType === 'rustPopulation') {
                const rustData = eventData as RustTickData;
                this.currentTotalPopulation = rustData.population;
                this.updatePopulationDisplay(rustData);
            }
        });

        const initialPopulation = populationManager.getTotalPopulation();
        this.currentTotalPopulation = initialPopulation;
        const popEl = document.getElementById('pop-value');
        if (popEl) popEl.textContent = initialPopulation.toLocaleString();
    }

    private updatePopulationDisplay(data: RustTickData): void {
        if (data.population === this.lastDisplayedPop) return;
        this.lastDisplayedPop = data.population;

        const popEl = document.getElementById('pop-value');
        if (popEl) popEl.textContent = data.population.toLocaleString();

        const totalPopElement = document.getElementById('stats-modal-total-population');
        if (totalPopElement) totalPopElement.textContent = this.currentTotalPopulation.toLocaleString();
    }

    // ============ Action Buttons ============

    private setupActionButtons(): void {
        const signal = this.abortController.signal;

        const resetBtn = document.getElementById('reset-data');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const menuOverlay = document.getElementById('menu-modal-overlay');
                if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
                    menuOverlay.classList.add('hidden');
                }
                this.handleResetData();
            }, { signal });
        }

        const statsBtn = document.getElementById('show-stats');
        if (statsBtn) {
            statsBtn.addEventListener('click', () => this.handleShowStats(), { signal });
        }

        const saveBtn = document.getElementById('save-game');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.handleSaveGame(), { signal });
        }

        const loadBtn = document.getElementById('load-game');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => this.handleLoadGame(), { signal });
        }

        this.setupTileSearchModal();
        this.setupMenuModal();
    }

    // ============ Tile Search ============

    private setupTileSearchModal(): void {
        const modal = document.getElementById('tile-search-modal');
        const input = document.getElementById('tile-search-input') as HTMLInputElement | null;
        const btn = document.getElementById('tile-search-btn');
        const signal = this.abortController.signal;
        if (!modal || !input) return;

        const doSearch = () => {
            const tileId = input.value.trim();
            if (tileId) {
                this.handleSearchTile(tileId);
                input.value = '';
                modal.classList.add('hidden');
            }
        };

        btn?.addEventListener('click', doSearch, { signal });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
            else if (e.key === 'Escape') modal.classList.add('hidden');
        }, { signal });
    }

    private setupMenuModal(): void {
        this.setupModal('menu-btn', 'menu-modal-overlay', '.menu-modal-close');

        const menuOverlay = document.getElementById('menu-modal-overlay');
        const searchModal = document.getElementById('tile-search-modal');
        const searchInput = document.getElementById('tile-search-input') as HTMLInputElement | null;
        const signal = this.abortController.signal;

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;

            if (e.key === 'Escape' && menuOverlay) {
                if (searchModal && !searchModal.classList.contains('hidden')) {
                    searchModal.classList.add('hidden');
                    return;
                }
                menuOverlay.classList.contains('hidden')
                    ? menuOverlay.classList.remove('hidden')
                    : menuOverlay.classList.add('hidden');
            }

            if (e.key === 'f' && searchModal && searchInput) {
                if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
                if (searchModal.classList.contains('hidden')) {
                    searchModal.classList.remove('hidden');
                    searchInput.value = '';
                    searchInput.focus();
                } else {
                    searchModal.classList.add('hidden');
                }
            }
        }, { signal });
    }

    // ============ Action Handlers ============

    private handleSearchTile(tileId: string): void {
        if (!this.sceneManager) return;

        const id = parseInt(tileId, 10);
        if (isNaN(id) || id < 0) return;

        const tileCenter = this.sceneManager.searchTile(id);
        if (tileCenter && this.cameraController) {
            this.cameraController.lookAtPoint(tileCenter);
        }
    }

    private async handleResetData(): Promise<void> {
        if (!this.sceneManager) return;
        try {
            await this.sceneManager.regenerateTiles();
        } catch (error: unknown) {
            console.error("Error during world restart:", error);
        }
    }

    private async handleSaveGame(): Promise<void> {
        const saveButton = document.getElementById('save-game') as HTMLButtonElement | null;
        if (!saveButton?.disabled === false) return;

        const originalText = saveButton!.innerHTML;
        saveButton!.disabled = true;
        saveButton!.classList.add('saving');
        saveButton!.innerHTML = '\u23F3 Saving...';

        try {
            await getApiClient().saveWorld('saves/world.bin');
            saveButton!.classList.remove('saving');
            saveButton!.classList.add('saved');
            saveButton!.innerHTML = '\u2705 Saved!';
            setTimeout(() => {
                saveButton!.innerHTML = originalText;
                saveButton!.classList.remove('saved');
                saveButton!.disabled = false;
            }, 2000);
        } catch (error: unknown) {
            console.error('Save failed:', error);
            saveButton!.classList.remove('saving');
            saveButton!.innerHTML = '\u274C Failed';
            setTimeout(() => {
                saveButton!.innerHTML = originalText;
                saveButton!.disabled = false;
            }, 2000);
        }
    }

    private async handleLoadGame(): Promise<void> {
        const loadButton = document.getElementById('load-game') as HTMLButtonElement | null;
        if (!loadButton || loadButton.disabled) return;

        const originalText = loadButton.innerHTML;
        loadButton.disabled = true;
        loadButton.classList.add('loading');
        loadButton.innerHTML = '\u23F3 Loading...';

        try {
            await getApiClient().loadWorld('saves/world.bin');

            if (this.sceneManager) {
                await this.sceneManager.createHexasphere();
                const ctx = getAppContext();
                if (ctx.calendarManager?.initialize) {
                    await ctx.calendarManager.initialize();
                }
            }

            loadButton.classList.remove('loading');
            loadButton.classList.add('loaded');
            loadButton.innerHTML = '\u2705 Loaded!';
            setTimeout(() => {
                loadButton.innerHTML = originalText;
                loadButton.classList.remove('loaded');
                loadButton.disabled = false;
            }, 2000);
        } catch (error: unknown) {
            console.error('Load failed:', error);
            loadButton.classList.remove('loading');
            loadButton.classList.add('error');
            loadButton.innerHTML = '\u274C Load Failed';
            setTimeout(() => {
                loadButton.innerHTML = originalText;
                loadButton.classList.remove('error');
                loadButton.disabled = false;
            }, 3000);
        }
    }

    // ============ Statistics ============

    private async handleShowStats(): Promise<void> {
        const ctx = getAppContext();
        if (!ctx.sceneManager) {
            this.showMessage('Scene manager not available', 'error');
            return;
        }

        try {
            this.showLoadingIndicator('Loading statistics...');

            const stats = (ctx.sceneManager.getPopulationStats?.() ?? {}) as StatsData;

            let demographics: Demographics | null = null;
            try {
                demographics = await getApiClient().getDemographics();
                this.currentTotalPopulation = demographics.population;
                stats.totalPopulation = demographics.population;
            } catch {
                this.currentTotalPopulation = stats.totalPopulation ?? 0;
            }

            let vitalStats: VitalStatistics | null = null;
            try {
                vitalStats = await getApiClient().getRecentStatistics(100);
            } catch { /* not critical */ }

            this.hideLoadingIndicator();

            // Remove existing modal
            document.getElementById('stats-modal-overlay')?.remove();

            // Create and show new modal
            const overlay = document.createElement('div');
            overlay.id = 'stats-modal-overlay';
            overlay.className = 'stats-modal-overlay';
            overlay.innerHTML = generateStatsModalHTML(stats, demographics, vitalStats);
            document.body.appendChild(overlay);

            attachStatsModalHandlers(overlay);

            // Render chart
            if (vitalStats) {
                try {
                    await renderVitalRatesChart(vitalStats);
                } catch (err: unknown) {
                    const chartContainer = document.getElementById('vital-rates-chart');
                    if (chartContainer) {
                        chartContainer.outerHTML = `<div style="color:red;">Failed to load chart: ${err instanceof Error ? err.message : err}</div>`;
                    }
                }
            }
        } catch (error: unknown) {
            this.hideLoadingIndicator();
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    // ============ Cleanup ============

    cleanup(): void {
        this.abortController.abort();
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
    }
}

export default UIManager;
