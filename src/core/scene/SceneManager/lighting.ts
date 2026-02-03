// Scene Manager - Lighting
// Handles scene lighting setup
import * as THREE from 'three';

/** Lighting configuration */
const LIGHTING_CONFIG = {
    ambient: {
        color: 0xffffff,
        intensity: 0.15  // Subtle fill light
    },
    camera: {
        color: 0xffffff,
        intensity: 1.2  // Main light source - reduced
    }
};

/**
 * Lighting state for the scene
 */
export interface LightingState {
    ambientLight: THREE.AmbientLight | null;
    cameraLight: THREE.DirectionalLight | null;
}

/**
 * Create initial lighting state
 */
export function createLightingState(): LightingState {
    return {
        ambientLight: null,
        cameraLight: null
    };
}

/**
 * Add lighting to the scene
 */
export function addLighting(
    scene: THREE.Scene,
    camera: THREE.Camera,
    state: LightingState,
    sphereRadius: number = 30
): LightingState {
    // Remove existing camera light
    if (state.cameraLight) {
        if (state.cameraLight.parent) {
            state.cameraLight.parent.remove(state.cameraLight);
        }
        state.cameraLight = null;
    }

    // Add ambient light if not present (subtle fill light)
    if (!state.ambientLight) {
        state.ambientLight = new THREE.AmbientLight(
            LIGHTING_CONFIG.ambient.color,
            LIGHTING_CONFIG.ambient.intensity
        );
        scene.add(state.ambientLight);
    }

    // Add camera-following directional light (main light source)
    // DirectionalLight shines from its position toward the target (default 0,0,0)
    state.cameraLight = new THREE.DirectionalLight(
        LIGHTING_CONFIG.camera.color,
        LIGHTING_CONFIG.camera.intensity
    );
    // Position light at camera position, pointing toward origin (sphere center)
    state.cameraLight.position.set(0, 0, 1);  // In front of camera in local space
    state.cameraLight.target.position.set(0, 0, 0);  // Point toward origin
    camera.add(state.cameraLight);  // Light moves with camera
    camera.add(state.cameraLight.target);  // Target also needs to be child of camera

    // Ensure camera is in scene
    if (!scene.children.includes(camera)) {
        scene.add(camera);
    }

    return state;
}

/**
 * Update camera light (currently no-op, reserved for future use)
 */
export function updateCameraLight(_camera: THREE.Camera, _state: LightingState): void {
    // Reserved for dynamic camera light updates
}

/**
 * Dispose of all lights
 */
export function disposeLighting(scene: THREE.Scene, state: LightingState): void {
    if (state.ambientLight) {
        scene.remove(state.ambientLight);
        state.ambientLight = null;
    }
    if (state.cameraLight) {
        if (state.cameraLight.parent) {
            state.cameraLight.parent.remove(state.cameraLight);
        }
        state.cameraLight = null;
    }
}
