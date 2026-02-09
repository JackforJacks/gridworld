// Input Handler Module
// Centralizes all input event handling (mouse, keyboard, touch)
// Optimized with proper event listener cleanup

import * as THREE from 'three';

/** Interface representing 2D coordinates */
interface Position {
    x: number;
    y: number;
}

/** Interface for tracking mouse state during interactions */
interface MouseState {
    isDragging: boolean;
    previousPosition: Position;
    initialPosition: Position;
    clickStartTime: number;
}

/** Interface for camera controller dependency */
interface CameraControllerLike {
    handleMouseDrag(deltaX: number, deltaY: number): void;
    zoom(delta: number): void;
    handleKeyboard(key: string): void;
    handleResize(width: number, height: number): void;
}

/** Interface for tile selector dependency */
interface TileSelectorLike {
    hideInfoPanel(): void;
    handleClick(event: MouseEvent): void;
}

class InputHandler {
    private renderer: THREE.WebGLRenderer;
    private cameraController: CameraControllerLike;
    private tileSelector: TileSelectorLike | null;
    private mouseState: MouseState;
    private clickTolerance: number;

    // Store bound event handlers so they can be removed properly
    private boundOnMouseDown: (event: MouseEvent) => void;
    private boundOnMouseMove: (event: MouseEvent) => void;
    private boundOnMouseUp: (event: MouseEvent) => void;
    private boundOnMouseLeave: (event: MouseEvent) => void;
    private boundOnWheel: (event: WheelEvent) => void;
    private boundOnKeyDown: (event: KeyboardEvent) => void;
    private boundOnResize: () => void;

    constructor(
        renderer: THREE.WebGLRenderer,
        cameraController: CameraControllerLike,
        tileSelector: TileSelectorLike | null
    ) {
        this.renderer = renderer;
        this.cameraController = cameraController;
        this.tileSelector = tileSelector;

        this.mouseState = {
            isDragging: false,
            previousPosition: { x: 0, y: 0 },
            initialPosition: { x: 0, y: 0 },
            clickStartTime: 0
        };

        this.clickTolerance = 5;

        // Pre-bind event handlers so we can remove them later
        this.boundOnMouseDown = this.onMouseDown.bind(this);
        this.boundOnMouseMove = this.onMouseMove.bind(this);
        this.boundOnMouseUp = this.onMouseUp.bind(this);
        this.boundOnMouseLeave = this.onMouseLeave.bind(this);
        this.boundOnWheel = this.onWheel.bind(this);
        this.boundOnKeyDown = this.onKeyDown.bind(this);
        this.boundOnResize = this.onResize.bind(this);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        const canvas = this.renderer.domElement;

        // Mouse events - use stored bound handlers
        canvas.addEventListener('mousedown', this.boundOnMouseDown, { passive: false });
        canvas.addEventListener('mousemove', this.boundOnMouseMove, { passive: true });
        canvas.addEventListener('mouseup', this.boundOnMouseUp, { passive: false });
        canvas.addEventListener('mouseleave', this.boundOnMouseLeave);

        // Wheel events
        window.addEventListener('wheel', this.boundOnWheel, { passive: false });

        // Keyboard events
        window.addEventListener('keydown', this.boundOnKeyDown, { passive: false });

        // Window events
        window.addEventListener('resize', this.boundOnResize, false);
    }

    /**
     * Clean up all event listeners to prevent memory leaks
     */
    destroy(): void {
        const canvas = this.renderer.domElement;

        // Remove all event listeners using the stored bound handlers
        canvas.removeEventListener('mousedown', this.boundOnMouseDown);
        canvas.removeEventListener('mousemove', this.boundOnMouseMove);
        canvas.removeEventListener('mouseup', this.boundOnMouseUp);
        canvas.removeEventListener('mouseleave', this.boundOnMouseLeave);

        window.removeEventListener('wheel', this.boundOnWheel);
        window.removeEventListener('keydown', this.boundOnKeyDown);
        window.removeEventListener('resize', this.boundOnResize);

        // Clear references to help GC
        this.tileSelector = null;
        this.cameraController = undefined!;
        this.renderer = undefined!;
    }

    private onMouseDown(event: MouseEvent): void {
        // Ignore clicks on UI overlays (dashboard, info panel, modals)
        const target = event.target as Node;
        const tileInfoPanel = document.getElementById('tileInfoPanel');
        const dashboard = document.getElementById('dashboard');
        if ((tileInfoPanel && tileInfoPanel.contains(target)) ||
            (dashboard && dashboard.contains(target))) {
            return;
        }

        event.preventDefault();

        this.mouseState.isDragging = true;
        this.mouseState.previousPosition.x = event.clientX;
        this.mouseState.previousPosition.y = event.clientY;
        this.mouseState.initialPosition.x = event.clientX;
        this.mouseState.initialPosition.y = event.clientY;
        this.mouseState.clickStartTime = Date.now();
    }

    private onMouseMove(event: MouseEvent): void {
        if (!this.mouseState.isDragging) return;

        const deltaX = event.clientX - this.mouseState.previousPosition.x;
        const deltaY = event.clientY - this.mouseState.previousPosition.y;

        this.cameraController.handleMouseDrag(deltaX, deltaY);

        this.mouseState.previousPosition.x = event.clientX;
        this.mouseState.previousPosition.y = event.clientY;

        // Hide tile info panel during dragging
        if (this.tileSelector) {
            this.tileSelector.hideInfoPanel();
        }
    }

    private onMouseUp(event: MouseEvent): void {
        if (!this.mouseState.isDragging) return;

        event.preventDefault();

        const clickDuration = Date.now() - this.mouseState.clickStartTime;
        const clickDistance = Math.sqrt(
            Math.pow(event.clientX - this.mouseState.initialPosition.x, 2) +
            Math.pow(event.clientY - this.mouseState.initialPosition.y, 2)
        );

        // If it was a quick click with minimal movement, treat it as tile selection
        if (clickDuration < 200 && clickDistance < this.clickTolerance) {
            if (this.tileSelector) {
                this.tileSelector.handleClick(event);
            }
        }

        this.mouseState.isDragging = false;
    }

    private onMouseLeave(_event: MouseEvent): void {
        if (this.mouseState.isDragging) {
            this.mouseState.isDragging = false;
        }
    }

    private onWheel(event: WheelEvent): void {
        event.preventDefault();
        const delta = event.deltaY * 0.1;
        this.cameraController.zoom(delta);
    }

    private onKeyDown(event: KeyboardEvent): void {
        // Check if user is typing in an input field
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
        }

        event.preventDefault();
        this.cameraController.handleKeyboard(event.key);
    }

    private onResize(): void {
        const width = window.innerWidth;
        const height = window.innerHeight - 10;

        this.renderer.setSize(width, height);
        this.cameraController.handleResize(width, height);
    }

    /** Public method to set tile selector reference */
    public setTileSelector(tileSelector: TileSelectorLike | null): void {
        this.tileSelector = tileSelector;
    }
}

export default InputHandler;
