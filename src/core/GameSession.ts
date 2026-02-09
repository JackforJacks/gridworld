// GameSession - Manages the lifecycle of an active game session
// Handles starting, running, and tearing down game systems
// Extracted from GridWorldApp for single-responsibility

import * as THREE from 'three';
import { getAppContext } from './AppContext';
import CameraController from './scene/CameraController';
import InputHandler from '../components/controls/InputHandler';
import TileSelector from '../components/controls/TileSelector';
import SceneManager from './scene/SceneManager';
import UIManager from '../managers/ui/UIManager';
import CalendarManager from '../managers/calendar/CalendarManager';
import CalendarDisplay from '../components/dashboard/CalendarDisplay';
import HeapMeter from '../components/dashboard/HeapMeter';
import populationManager from '../managers/population/PopulationManager';

import type { GameConfig, AppSettings } from '../ui/MainMenu';

export class GameSession {
    private inputHandler: InputHandler | null = null;
    private tileSelector: TileSelector | null = null;
    private uiManager: UIManager | null = null;
    private calendarManager: CalendarManager | null = null;
    private calendarDisplay: CalendarDisplay | null = null;
    private heapMeter: HeapMeter | null = null;
    private gameAbortController: AbortController | null = null;

    constructor(
        private scene: THREE.Scene,
        private camera: THREE.PerspectiveCamera,
        private renderer: THREE.WebGLRenderer,
        private sceneManager: SceneManager,
        private cameraController: CameraController,
        private settings: AppSettings,
        private requestRender: () => void,
        private onReturnToMenu: () => void
    ) {}

    async start(config: GameConfig | null): Promise<void> {
        this.gameAbortController = new AbortController();
        const signal = this.gameAbortController.signal;

        // Fade out menu
        const menu = document.getElementById('main-menu');
        if (menu) {
            menu.classList.add('fade-out');
            setTimeout(() => menu.classList.add('hidden'), 500);
        }

        // Stop auto-rotate
        this.cameraController.setAutoRotate(false);

        // Show dashboard UI
        const dashboard = document.getElementById('dashboard');
        if (dashboard) dashboard.classList.remove('hidden');
        const viewModeSelector = document.getElementById('view-mode-selector');
        if (viewModeSelector) viewModeSelector.classList.remove('hidden');
        const container = document.getElementById('container');
        if (container) container.classList.add('with-dashboard');

        try {
            // Regenerate hexasphere with selected configuration
            if (config) {
                await this.sceneManager.createHexasphere(
                    null, config.subdivisions, null, true,
                    config.landWaterRatio, config.roughness
                );
                this.requestRender();
            }

            // Connect population manager
            await populationManager.connect();

            // Initialize UI manager
            this.uiManager = new UIManager(this.sceneManager);
            this.uiManager.initialize();
            getAppContext().uiManager = this.uiManager;
            this.uiManager.setCameraController(this.cameraController);

            // Initialize tile selector
            this.tileSelector = new TileSelector(
                this.scene, this.camera, this.sceneManager, this.requestRender
            );

            // Initialize input handler
            this.inputHandler = new InputHandler(
                this.renderer, this.cameraController, this.tileSelector
            );

            // View mode selector
            document.addEventListener('viewModeChange', (e: Event) => {
                const customEvent = e as CustomEvent<{ value: string; text: string }>;
                const mode = customEvent.detail.value as 'terrain' | 'biome' | 'fertility' | 'population';
                this.sceneManager.setViewMode(mode);
            }, { signal });

            // Initialize calendar
            await this.initializeCalendar();

            // Back to menu button
            const backBtn = document.getElementById('back-to-menu');
            if (backBtn) {
                backBtn.addEventListener('click', () => this.stop(), { signal });
            }

        } catch (error: unknown) {
            console.error('Failed to start game:', error);
        }
    }

    stop(): void {
        // Abort game-phase listeners
        if (this.gameAbortController) {
            this.gameAbortController.abort();
            this.gameAbortController = null;
        }

        // Close menu modal
        const modalOverlay = document.getElementById('menu-modal-overlay');
        if (modalOverlay) modalOverlay.classList.add('hidden');

        // Tear down systems
        if (this.calendarManager) {
            this.calendarManager.stop();
            this.calendarManager.destroy();
            this.calendarManager = null;
        }
        if (this.calendarDisplay) {
            this.calendarDisplay.destroy();
            this.calendarDisplay = null;
        }
        if (this.heapMeter) {
            this.heapMeter.destroy();
            this.heapMeter = null;
        }
        if (this.inputHandler) {
            this.inputHandler.destroy();
            this.inputHandler = null;
        }
        if (this.tileSelector) {
            this.tileSelector.destroy();
            this.tileSelector = null;
        }
        if (this.uiManager) {
            this.uiManager.cleanup();
            this.uiManager = null;
            getAppContext().uiManager = null;
        }

        populationManager.disconnect();

        const ctx = getAppContext();
        ctx.calendarManager = null;
        ctx.calendarDisplay = null;

        // Hide game UI
        const dashboard = document.getElementById('dashboard');
        if (dashboard) dashboard.classList.add('hidden');
        const viewModeSelector = document.getElementById('view-mode-selector');
        if (viewModeSelector) viewModeSelector.classList.add('hidden');
        const container = document.getElementById('container');
        if (container) container.classList.remove('with-dashboard');

        this.onReturnToMenu();
    }

    getHeapMeter(): HeapMeter | null {
        return this.heapMeter;
    }

    setHeapMeter(meter: HeapMeter | null): void {
        this.heapMeter = meter;
    }

    destroy(): void {
        if (this.inputHandler) this.inputHandler.destroy();
        if (this.heapMeter) this.heapMeter.destroy();
        if (this.calendarDisplay) this.calendarDisplay.destroy();
        if (this.calendarManager) this.calendarManager.destroy();
        if (this.tileSelector) this.tileSelector.destroy();
        if (this.uiManager) this.uiManager.cleanup();
        populationManager.disconnect();

        this.inputHandler = null;
        this.tileSelector = null;
        this.calendarManager = null;
        this.calendarDisplay = null;
        this.heapMeter = null;
        this.uiManager = null;
    }

    private async initializeCalendar(): Promise<void> {
        try {
            this.calendarManager = new CalendarManager();
            this.calendarDisplay = new CalendarDisplay(this.calendarManager);

            const ctx = getAppContext();
            ctx.calendarManager = this.calendarManager;
            ctx.calendarDisplay = this.calendarDisplay;

            if (this.settings.showHeapMeter) {
                this.heapMeter = new HeapMeter();
            }

            await this.calendarManager.start();
        } catch (error: unknown) {
            console.error('Failed to initialize calendar system:', error);
        }
    }
}
