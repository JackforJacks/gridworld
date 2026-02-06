// Camera Controller Module
// Handles camera movement, zoom, and rotation logic

import * as THREE from 'three';

interface RotationState {
    x: number;
    y: number;
}

class CameraController {
    private camera: THREE.PerspectiveCamera;
    private distance: number;
    private minDistance: number;
    private maxDistance: number;
    private rotation: RotationState;
    private targetRotation: RotationState;
    private autoRotate: boolean;
    private rotationSpeed: number;

    // Cached vectors to avoid allocations in render loop
    private static readonly AXIS_X = new THREE.Vector3(1, 0, 0);
    private static readonly AXIS_Y = new THREE.Vector3(0, 1, 0);

    // Render-on-demand callback
    private onChange: (() => void) | null = null;
    // Track previous rotation to detect actual movement
    private previousRotation: RotationState;

    constructor(camera: THREE.PerspectiveCamera, onChange?: (() => void) | null, initialDistance: number = 160) {
        this.camera = camera;
        this.onChange = onChange || null;
        this.distance = initialDistance;
        this.minDistance = 55;
        this.maxDistance = 200;

        this.rotation = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.previousRotation = { x: 0, y: 0 };
        this.autoRotate = false;
        this.rotationSpeed = 0.003;
    }

    // Update camera position based on current rotation and distance
    updatePosition(): void {
        this.camera.position.set(0, 0, this.distance);
        this.camera.lookAt(0, 0, 0);

        // Apply rotations using cached axis vectors (zero allocations)
        this.camera.position.applyAxisAngle(CameraController.AXIS_X, this.rotation.x);
        this.camera.position.applyAxisAngle(CameraController.AXIS_Y, this.rotation.y);
        this.camera.lookAt(0, 0, 0);
    }

    // Animate camera movements
    // Returns true if camera actually moved (for render-on-demand)
    animate(): boolean {
        // Smooth rotation transitions
        this.rotation.x += (this.targetRotation.x - this.rotation.x) * 0.1;
        this.rotation.y += (this.targetRotation.y - this.rotation.y) * 0.1;

        // Auto-rotate if enabled
        if (this.autoRotate) {
            this.targetRotation.y += 0.005;
        }

        // Check if rotation changed significantly
        const dx = this.rotation.x - this.previousRotation.x;
        const dy = this.rotation.y - this.previousRotation.y;
        const moved = Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001;

        if (moved) {
            if (this.onChange) this.onChange();
            this.previousRotation.x = this.rotation.x;
            this.previousRotation.y = this.rotation.y;
        }

        this.updatePosition();
        return moved;
    }

    // Check if auto-rotate is enabled
    isAutoRotating(): boolean {
        return this.autoRotate;
    }

    // Handle mouse movement (for orbit controls)
    handleMouseMove(deltaX: number, deltaY: number): void {
        this.targetRotation.y -= deltaX * this.rotationSpeed;
        this.targetRotation.x += deltaY * this.rotationSpeed;
        this.targetRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetRotation.x));
        this.autoRotate = false;
        if (this.onChange) this.onChange();
    }

    // Alias for compatibility with InputHandler
    handleMouseDrag(deltaX: number, deltaY: number): void {
        this.handleMouseMove(deltaX, deltaY);
    }

    // Handle zoom
    zoom(delta: number): void {
        const oldDistance = this.distance;
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + delta));
        if (this.onChange && this.distance !== oldDistance) this.onChange();
        this.updatePosition();
    }

    // Reset camera to default position
    reset(): void {
        this.targetRotation.x = 0;
        this.targetRotation.y = 0;
        this.distance = 160;
        this.autoRotate = true;
        this.updatePosition();
    }

    /**
     * Smoothly rotate camera to look at a specific point on the sphere
     * Calculates the rotation angles needed to center the point in view
     */
    lookAtPoint(point: { x: number; y: number; z: number }): void {
        // Convert point to spherical coordinates to get rotation angles
        // The point is on the sphere surface, we need to rotate camera to face it
        const normalized = new THREE.Vector3(point.x, point.y, point.z).normalize();

        // Calculate target rotation angles
        // Y rotation (horizontal): atan2 of x and z
        const targetY = Math.atan2(normalized.x, normalized.z);

        // X rotation (vertical): asin of y (latitude)
        const targetX = -Math.asin(normalized.y);

        // Set target rotations for smooth animation
        this.targetRotation.y = targetY;
        this.targetRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetX));

        // Stop auto-rotate so user can see the tile
        this.autoRotate = false;
    }

    // Handle keyboard controls
    handleKeyboard(key: string, step: number = 0.1, zoomStep: number = 2): void {
        switch (key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.targetRotation.x -= step;
                this.targetRotation.x = Math.max(-Math.PI / 2, this.targetRotation.x);
                this.autoRotate = false;
                break;

            case 's':
            case 'arrowdown':
                this.targetRotation.x += step;
                this.targetRotation.x = Math.min(Math.PI / 2, this.targetRotation.x);
                this.autoRotate = false;
                break;

            case 'a':
            case 'arrowleft':
                this.targetRotation.y -= step;
                this.autoRotate = false;
                break;

            case 'd':
            case 'arrowright':
                this.targetRotation.y += step;
                this.autoRotate = false;
                break;

            case '=':
            case '+':
                this.zoom(-zoomStep);
                break;

            case '-':
            case '_':
                this.zoom(zoomStep);
                break;

            // 'r' key removed - was conflicting with user preferences
            // case 'r':
            //     this.reset();
            //     break;

            case 'c':
                this.distance = 160;
                this.targetRotation.x = 0;
                this.targetRotation.y = 0;
                this.updatePosition();
                break;
        }
    }

    // Handle window resize
    handleResize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}

export default CameraController;
