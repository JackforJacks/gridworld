// Input Handler Module
// Centralizes all input event handling (mouse, keyboard, touch)

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
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        const canvas = this.renderer.domElement;

        // Mouse events
        canvas.addEventListener('mousedown', this.onMouseDown.bind(this), { passive: false });
        canvas.addEventListener('mousemove', this.onMouseMove.bind(this), { passive: true });
        canvas.addEventListener('mouseup', this.onMouseUp.bind(this), { passive: false });
        canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));

        // Wheel events
        window.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // Keyboard events
        window.addEventListener('keydown', this.onKeyDown.bind(this), { passive: false });

        // Window events
        window.addEventListener('resize', this.onResize.bind(this), false);
    }

    private onMouseDown(event: MouseEvent): void {
        // If the click is on the info panel, do nothing.
        const tileInfoPanel = document.getElementById('tileInfoPanel');
        if (tileInfoPanel && tileInfoPanel.contains(event.target as Node)) {
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
