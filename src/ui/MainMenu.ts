// MainMenu - Handles main menu buttons, options modal, and new game setup
// Extracted from GridWorldApp for single-responsibility

import { setStarsAnimation } from '../core/renderer/BackgroundStars';
import HeapMeter from '../components/dashboard/HeapMeter';
import { invoke } from '@tauri-apps/api/core';

export interface GameConfig {
    subdivisions: number;
    landWaterRatio: number;
    roughness: number;
    precipitation: number;
}

export interface AppSettings {
    showHeapMeter: boolean;
    animateBackgroundStars: boolean;
}

export class MainMenu {
    constructor(
        private settings: AppSettings,
        private onStartGame: (config: GameConfig) => void,
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
                    if (btnLoadGame) showButton(btnLoadGame);
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
            btnLoadGame.addEventListener('click', () => {
                const loadButton = document.getElementById('load-game');
                if (loadButton) loadButton.click();
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
                const config: GameConfig = {
                    subdivisions: parseInt(formData.get('worldSize') as string),
                    landWaterRatio: parseInt(formData.get('landWaterRatio') as string),
                    roughness: parseInt(formData.get('roughness') as string),
                    precipitation: parseInt(formData.get('precipitation') as string),
                };

                if (modal) modal.classList.add('hidden');
                this.onStartGame(config);
            });
        }
    }
}
