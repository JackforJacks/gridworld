// MainMenu - Handles main menu buttons, options modal, and new game setup
// Extracted from GridWorldApp for single-responsibility

import { setStarsAnimation } from '../core/renderer/BackgroundStars';
import HeapMeter from '../components/dashboard/HeapMeter';
import { invoke } from '@tauri-apps/api/core';
import { getApiClient } from '../services/api/ApiClient';
import type { WorldConfig } from '../services/api/ApiClient';

export interface GameConfig {
    name: string;
    subdivisions: number;
    landWaterRatio: number;
    roughness: number;
    precipitation: number;
    populationTilePercent: number;
    populationMin: number;
    populationMax: number;
}

export interface AppSettings {
    showHeapMeter: boolean;
    animateBackgroundStars: boolean;
}

export class MainMenu {
    constructor(
        private settings: AppSettings,
        private onStartGame: (config: GameConfig) => void,
        private onLoadGame: (worldConfig: WorldConfig) => void,
        private getHeapMeter: () => HeapMeter | null,
        private setHeapMeter: (meter: HeapMeter | null) => void
    ) {}

    setup(): void {
        this.setupButtons();
        this.setupNewGameModal();
        this.setupOptionsModal();
    }

    private setupButtons(): void {
        const btnSingleplayer = document.getElementById('btn-singleplayer');
        const btnNewGame = document.getElementById('btn-new-game');
        const btnLoadGame = document.getElementById('btn-load-game');
        const btnMultiplayer = document.getElementById('btn-multiplayer');
        const btnStore = document.getElementById('btn-store');
        const btnExit = document.getElementById('btn-exit');

        let submenuExpanded = false;

        const hideButton = (btn: HTMLElement) => {
            btn.style.display = 'block';
            btn.classList.add('hidden');
            setTimeout(() => {
                if (btn.classList.contains('hidden')) {
                    btn.style.display = 'none';
                }
            }, 300);
        };

        const showButton = (btn: HTMLElement) => {
            btn.style.display = 'block';
            requestAnimationFrame(() => {
                btn.classList.remove('hidden');
            });
        };

        if (btnSingleplayer) {
            btnSingleplayer.addEventListener('click', () => {
                submenuExpanded = !submenuExpanded;
                if (submenuExpanded) {
                    if (btnNewGame) showButton(btnNewGame);
                    if (btnLoadGame) {
                        showButton(btnLoadGame);
                        // Re-check save existence every time submenu opens
                        (btnLoadGame as HTMLButtonElement).disabled = true;
                        getApiClient().checkSaveExists('saves/world.bin').then(exists => {
                            (btnLoadGame as HTMLButtonElement).disabled = !exists;
                        }).catch(() => {});
                    }
                    if (btnMultiplayer) hideButton(btnMultiplayer);
                    if (btnStore) hideButton(btnStore);
                } else {
                    if (btnNewGame) hideButton(btnNewGame);
                    if (btnLoadGame) hideButton(btnLoadGame);
                    if (btnMultiplayer) showButton(btnMultiplayer);
                    if (btnStore) showButton(btnStore);
                }
            });
        }

        if (btnNewGame) {
            btnNewGame.addEventListener('click', () => {
                const modal = document.getElementById('new-game-setup-modal');
                if (modal) modal.classList.remove('hidden');
            });
        }

        if (btnLoadGame) {
            // Starts disabled; re-checked each time submenu opens
            (btnLoadGame as HTMLButtonElement).disabled = true;

            btnLoadGame.addEventListener('click', async () => {
                (btnLoadGame as HTMLButtonElement).disabled = true;
                try {
                    const result = await getApiClient().loadWorld('saves/world.bin');
                    this.onLoadGame(result.world_config);
                } catch (err) {
                    console.error('Load failed:', err);
                    (btnLoadGame as HTMLButtonElement).disabled = false;
                }
            });
        }

        if (btnExit) {
            btnExit.addEventListener('click', async () => {
                try {
                    await invoke('exit_app');
                } catch { /* fallback: do nothing */ }
            });
        }
    }

    private setupOptionsModal(): void {
        const btnOptions = document.getElementById('btn-options');
        const optionsOverlay = document.getElementById('options-modal-overlay');
        const optionsClose = optionsOverlay?.querySelector('.options-modal-close');

        if (btnOptions) {
            btnOptions.addEventListener('click', () => {
                if (optionsOverlay) optionsOverlay.classList.remove('hidden');
            });
        }

        if (optionsClose) {
            optionsClose.addEventListener('click', () => {
                if (optionsOverlay) optionsOverlay.classList.add('hidden');
            });
        }

        // Stars animation checkbox
        const animateStarsCheckbox = document.getElementById('option-animate-stars') as HTMLInputElement;
        if (animateStarsCheckbox) {
            animateStarsCheckbox.checked = this.settings.animateBackgroundStars;
            animateStarsCheckbox.addEventListener('change', () => {
                this.settings.animateBackgroundStars = animateStarsCheckbox.checked;
                setStarsAnimation(this.settings.animateBackgroundStars);
            });
        }

        // Memory consumption checkbox
        const showMemoryCheckbox = document.getElementById('option-show-memory') as HTMLInputElement;
        if (showMemoryCheckbox) {
            showMemoryCheckbox.checked = this.settings.showHeapMeter;
            showMemoryCheckbox.addEventListener('change', () => {
                this.settings.showHeapMeter = showMemoryCheckbox.checked;
                if (showMemoryCheckbox.checked) {
                    if (!this.getHeapMeter()) {
                        this.setHeapMeter(new HeapMeter());
                    }
                } else {
                    const meter = this.getHeapMeter();
                    if (meter) {
                        meter.destroy();
                        this.setHeapMeter(null);
                    }
                }
            });
        }
    }

    private setupNewGameModal(): void {
        const modal = document.getElementById('new-game-setup-modal');
        const form = document.getElementById('new-game-form') as HTMLFormElement;
        const closeBtn = document.getElementById('new-game-setup-close');
        const cancelBtn = document.getElementById('new-game-cancel');

        // Enable scrolling without native scrollbar (overflow:hidden + JS wheel)
        const scrollContainer = modal?.querySelector('.form-section') as HTMLElement | null;
        if (scrollContainer) {
            scrollContainer.addEventListener('wheel', (e) => {
                e.preventDefault();
                scrollContainer.scrollTop += e.deltaY;
            }, { passive: false });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (modal) modal.classList.add('hidden');
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                if (modal) modal.classList.add('hidden');
            });
        }

        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const formData = new FormData(form);
                const density = formData.get('populationDensity') as string;
                const populationPresets: Record<string, { tilePercent: number; min: number; max: number }> = {
                    sparse:   { tilePercent: 20, min: 500,  max: 3000 },
                    moderate: { tilePercent: 40, min: 1500, max: 8000 },
                    heavy:    { tilePercent: 80, min: 3000, max: 10000 },
                };
                const pop = populationPresets[density] ?? populationPresets.moderate;
                const config: GameConfig = {
                    name: (formData.get('worldName') as string) || 'New World',
                    subdivisions: parseInt(formData.get('worldSize') as string),
                    landWaterRatio: parseInt(formData.get('landWaterRatio') as string),
                    roughness: parseInt(formData.get('roughness') as string),
                    precipitation: parseInt(formData.get('precipitation') as string),
                    populationTilePercent: pop.tilePercent,
                    populationMin: pop.min,
                    populationMax: pop.max,
                };

                if (modal) modal.classList.add('hidden');
                this.onStartGame(config);
            });
        }
    }
}
