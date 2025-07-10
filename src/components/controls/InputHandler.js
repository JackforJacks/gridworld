// Input Handler Module
// Centralizes all input event handling (mouse, keyboard, touch)

class InputHandler {
    constructor(renderer, cameraController, tileSelector) {
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

    setupEventListeners() {
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

    onMouseDown(event) {
        // If the click is on the info panel, do nothing.
        const tileInfoPanel = document.getElementById('tileInfoPanel');
        if (tileInfoPanel && tileInfoPanel.contains(event.target)) {
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

    onMouseMove(event) {
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

    onMouseUp(event) {
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

    onMouseLeave(event) {
        if (this.mouseState.isDragging) {
            this.mouseState.isDragging = false;
        }
    }

    onWheel(event) {
        event.preventDefault();
        const delta = event.deltaY * 0.1;
        this.cameraController.zoom(delta);
    }

    onKeyDown(event) {
        // Check if user is typing in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        event.preventDefault();
        this.cameraController.handleKeyboard(event.key);
    }

    onResize() {
        const width = window.innerWidth;
        const height = window.innerHeight - 10;
        
        this.renderer.setSize(width, height);
        this.cameraController.handleResize(width, height);
    }

    // Public method to set tile selector reference
    setTileSelector(tileSelector) {
        this.tileSelector = tileSelector;
    }
}

export default InputHandler;
