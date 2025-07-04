// Camera Controller Module
// Handles camera movement, zoom, and rotation logic

class CameraController {
    constructor(camera, initialDistance = 160) {
        this.camera = camera;
        this.distance = initialDistance;
        this.minDistance = 55;  // Increased to prevent bumping inside sphere
        this.maxDistance = 200; // Increased for more zoom out range

        this.rotation = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.autoRotate = false;
        this.rotationSpeed = 0.003;
    }

    // Update camera position based on current rotation and distance
    updatePosition() {
        this.camera.position.set(0, 0, this.distance);
        this.camera.lookAt(0, 0, 0);

        // Apply rotations
        this.camera.position.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.rotation.x);
        this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y);
        this.camera.lookAt(0, 0, 0);
    }

    // Animate camera movements
    animate() {
        // Smooth rotation transitions
        this.rotation.x += (this.targetRotation.x - this.rotation.x) * 0.1;
        this.rotation.y += (this.targetRotation.y - this.rotation.y) * 0.1;

        // Auto-rotate if enabled
        if (this.autoRotate) {
            this.targetRotation.y += 0.005;
        }

        this.updatePosition();
    }

    // Handle mouse movement (for orbit controls)
    handleMouseMove(deltaX, deltaY) {
        this.targetRotation.y -= deltaX * this.rotationSpeed;
        this.targetRotation.x += deltaY * this.rotationSpeed;
        this.targetRotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.targetRotation.x));
        this.autoRotate = false;
    }

    // Alias for compatibility with InputHandler
    handleMouseDrag(deltaX, deltaY) {
        this.handleMouseMove(deltaX, deltaY);
    }

    // Handle zoom
    zoom(delta) {
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + delta));
        this.updatePosition();
    }

    // Reset camera to default position
    reset() {
        this.targetRotation.x = 0;
        this.targetRotation.y = 0;
        this.distance = 160;
        this.autoRotate = true;
        this.updatePosition();
    }

    // Handle keyboard controls
    handleKeyboard(key, step = 0.1, zoomStep = 2) {
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

            case 'r':
                this.reset();
                break;

            case 'c':
                this.distance = 160;
                this.targetRotation.x = 0;
                this.targetRotation.y = 0;
                this.updatePosition();
                break;
        }
    }

    // Handle window resize
    handleResize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }
}

export default CameraController;
