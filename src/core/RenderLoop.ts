// RenderLoop - Manages the RAF render loop with visibility handling
// Extracted from GridWorldApp for single-responsibility

import * as THREE from 'three';
import { getAppContext } from './AppContext';
import type CameraController from './scene/CameraController';
import type SceneManager from './scene/SceneManager';

export class RenderLoop {
    private rafId: number | null = null;
    private isAnimating = false;
    private isVisible = true;
    private visibilityHandler: (() => void) | null = null;
    private needsRender = true;
    private lastTime = Date.now();

    private sceneManager: SceneManager | null = null;
    private cameraController: CameraController | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private renderer: THREE.WebGLRenderer | null = null;

    setDependencies(
        sceneManager: SceneManager,
        cameraController: CameraController,
        camera: THREE.PerspectiveCamera,
        renderer: THREE.WebGLRenderer
    ): void {
        this.sceneManager = sceneManager;
        this.cameraController = cameraController;
        this.camera = camera;
        this.renderer = renderer;
    }

    requestRender(): void {
        this.needsRender = true;
    }

    start(): void {
        if (this.isAnimating) return;

        this.isAnimating = true;
        this.isVisible = !document.hidden;

        if (!this.visibilityHandler) {
            this.visibilityHandler = () => {
                if (document.hidden) {
                    this.pause();
                } else {
                    this.resume();
                }
            };
            document.addEventListener('visibilitychange', this.visibilityHandler);
        }

        this.scheduleFrame();
    }

    stop(): void {
        this.isAnimating = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    private pause(): void {
        this.isVisible = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private resume(): void {
        if (!this.isVisible && this.isAnimating) {
            this.isVisible = true;
            this.lastTime = Date.now();
            this.scheduleFrame();
        }
    }

    private scheduleFrame(): void {
        const loop = (timestamp: number): void => {
            if (!this.isAnimating || !this.isVisible) return;

            const currentTime = Date.now();
            this.renderFrame(timestamp, currentTime);
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    private renderFrame(timestamp: number, currentTime: number): void {
        const deltaTime = currentTime - this.lastTime;

        let cameraMoved = false;
        if (this.cameraController) {
            cameraMoved = this.cameraController.animate();
        }

        if (this.camera) {
            this.camera.updateMatrixWorld();
        }

        const shouldRender = this.needsRender ||
            cameraMoved ||
            (this.cameraController?.isAutoRotating() ?? false);

        if (shouldRender && this.sceneManager && this.camera) {
            this.sceneManager.updateCameraLight(this.camera);
            this.sceneManager.render(this.camera);
            this.needsRender = false;
        }

        if (getAppContext().debug && timestamp % 60 < 1) {
            this.logDebugStats(deltaTime);
        }

        this.lastTime = currentTime;
    }

    private logDebugStats(deltaTime: number): void {
        if (!this.renderer || !this.sceneManager) return;
        const fps = Math.round(1000 / deltaTime);
        console.debug('Stats:', {
            FPS: fps,
            Triangles: this.renderer.info.render.triangles,
            'Draw Calls': this.renderer.info.render.calls,
            Tiles: this.sceneManager.getCurrentTiles().length
        });
    }
}
