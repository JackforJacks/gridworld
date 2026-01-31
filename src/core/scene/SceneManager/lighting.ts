// Scene Manager - Lighting
// Handles scene lighting setup
import * as THREE from 'three';

/** Lighting configuration */
const LIGHTING_CONFIG = {
    ambient: {
        color: 0xffffff,
        intensity: 0.3
    },
    directional: {
        color: 0xffffff,
        intensity: 0.7,
        position: { x: 10, y: 20, z: 10 }
    },
    camera: {
        color: 0xffffff,
        intensity: 1.0,
        radiusMultiplier: 0.8
    }
};

/**
 * Lighting state for the scene
 */
export interface LightingState {
    ambientLight: THREE.AmbientLight | null;
    directionalLight: THREE.DirectionalLight | null;
    cameraLight: THREE.PointLight | null;
}

/**
 * Create initial lighting state
 */
export function createLightingState(): LightingState {
    return {
        ambientLight: null,
        directionalLight: null,
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
    
    // Add ambient light if not present
    if (!state.ambientLight) {
        state.ambientLight = new THREE.AmbientLight(
            LIGHTING_CONFIG.ambient.color,
            LIGHTING_CONFIG.ambient.intensity
        );
        scene.add(state.ambientLight);
    }
    
    // Add directional light if not present
    if (!state.directionalLight) {
        state.directionalLight = new THREE.DirectionalLight(
            LIGHTING_CONFIG.directional.color,
            LIGHTING_CONFIG.directional.intensity
        );
        state.directionalLight.position.set(
            LIGHTING_CONFIG.directional.position.x,
            LIGHTING_CONFIG.directional.position.y,
            LIGHTING_CONFIG.directional.position.z
        );
        scene.add(state.directionalLight);
    }
    
    // Add camera-following point light
    const lightRadius = sphereRadius * LIGHTING_CONFIG.camera.radiusMultiplier;
    state.cameraLight = new THREE.PointLight(
        LIGHTING_CONFIG.camera.color,
        LIGHTING_CONFIG.camera.intensity,
        lightRadius
    );
    state.cameraLight.position.set(0, 0, 0);
    camera.add(state.cameraLight);
    
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
    if (state.directionalLight) {
        scene.remove(state.directionalLight);
        state.directionalLight = null;
    }
    if (state.cameraLight) {
        if (state.cameraLight.parent) {
            state.cameraLight.parent.remove(state.cameraLight);
        }
        state.cameraLight = null;
    }
}
