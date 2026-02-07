// @ts-check
// Three.js/scene/tile helpers
import * as THREE from 'three';
import { getAppContext } from '../AppContext';

/**
 * @typedef {import('../../../types/global').TileData} TileData
 * @typedef {import('../../../types/global').RotationState} RotationState
 */

/**
 * Create and initialize the 3D scene with tiles
 * @param {number} radius - Sphere radius (e.g., 30)
 * @param {number} subdivisions - Icosahedron subdivisions (e.g., 10)
 * @param {number} tileWidthRatio - Tile padding ratio (1 = no padding, 0.9 = some padding)
 * @param {any} scene - THREE.Scene instance
 * @param {any} world - No longer used (was ECSY World instance)
 * @param {any[]} currentTiles - Array to store created THREE.Mesh objects for tiles
 * @param {Record<string, number>} terrainColors - Terrain type to color mapping
 * @param {any} TileComponent - No longer used (was ECSY Component class)
 * @param {any} backgroundSphere - Optional visual background sphere mesh
 * @param {any} hexasphere_global - window.hexasphere reference
 * @param {any} renderer - THREE.Renderer instance
 * @param {any} camera - THREE.Camera instance
 * @param {any} tilePopup - Tile popup UI element
 * @param {any} borderLines - Border lines array
 * @param {any} selectedTile - Currently selected tile
 * @param {any} borderLineMaterial - Material for border lines
 * @param {any} mousePosition - Mouse position object
 * @param {any} raycaster - THREE.Raycaster instance
 * @param {RotationState} rotation - Current rotation state
 * @param {RotationState} targetRotation - Target rotation state
 * @param {boolean} autoRotate - Auto-rotation enabled flag
 * @param {boolean} isDragging - Dragging state flag
 * @param {any} previousMousePosition - Previous mouse position
 * @param {any} initialMouseDownPosition - Initial mouse down position
 * @param {number} clickStartTime - Click start timestamp
 * @param {number} clickTolerance - Click tolerance threshold
 * @param {number} cameraDistance - Camera distance from center
 * @param {number} minCameraDistance - Minimum camera distance
 * @param {number} maxCameraDistance - Maximum camera distance
 * @param {((data: TileData[]) => void) | null} updateDashboardCallback - Dashboard update callback
 * @param {TileData[]} tileData - Tile data from server
 * @returns {TileData[]} Tile data array
 */
function createScene(
    radius,
    subdivisions,
    tileWidthRatio,
    scene,
    world,
    currentTiles,
    terrainColors,
    TileComponent,
    backgroundSphere,
    hexasphere_global,
    renderer, camera, tilePopup, borderLines, selectedTile, borderLineMaterial,
    mousePosition, raycaster, rotation, targetRotation, autoRotate, isDragging, previousMousePosition,
    initialMouseDownPosition, clickStartTime, clickTolerance, cameraDistance, minCameraDistance, maxCameraDistance,
    updateDashboardCallback,
    tileData
) {
    // 1. Clear existing tile meshes from the scene and the currentTiles array
    if (currentTiles && currentTiles.length > 0) {
        currentTiles.forEach(tileMesh => scene.remove(tileMesh));
        currentTiles.length = 0; // Reset the array
    }
    // 2. Use provided tileData to build geometry
    if (!tileData) {
        console.error('No tile data provided from server!');
        return;
    }

    // Note: Tile geometry is built by the Hexasphere module and rendered separately.
    // This function's primary role is scene initialization and lighting setup.

    // 3. Ensure basic lighting is present in the scene for MeshPhongMaterial to look good
    if (!scene.getObjectByName("ambientLight")) {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Ambient light to illuminate all objects
        ambientLight.name = "ambientLight";
        scene.add(ambientLight);
    }
    if (!scene.getObjectByName("directionalLight")) {
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7); // Directional light for highlights and shadows
        directionalLight.position.set(5, 10, 7.5).normalize(); // Set light position
        directionalLight.name = "directionalLight";
        scene.add(directionalLight);
    }
    if (typeof updateDashboardCallback === 'function') {
        updateDashboardCallback(tileData);
    }
    return tileData;
}

/**
 * Render tick/frame update
 * @param {number} lastTime - Last frame timestamp
 * @param {boolean} autoRotate - Auto-rotation enabled flag
 * @param {RotationState} targetRotation - Target rotation state
 * @param {RotationState} rotation - Current rotation state
 * @param {any} camera - THREE.Camera instance
 * @param {any} scene - THREE.Scene instance
 * @param {any} renderer - THREE.Renderer instance
 * @param {number} cameraDistance - Camera distance from center
 * @param {((time: number, rotation: RotationState, targetRotation: RotationState) => void) | null} updateCallback - Update callback
 */
function tick(lastTime, autoRotate, targetRotation, rotation, camera, scene, renderer, cameraDistance, updateCallback) {
    const time = Date.now();
    const delta = time - lastTime; if (autoRotate) {
        targetRotation.y += 0.001; // Slower, more natural rotation speed like Earth
    }

    rotation.x += (targetRotation.x - rotation.x) * 0.1;
    rotation.y += (targetRotation.y - rotation.y) * 0.1;

    // Camera and sphere rotation system:
    // - Y rotation (horizontal mouse movement) rotates around the vertical Y-axis
    // - X rotation (vertical mouse movement) changes the camera's elevation angle
    // - The sphere rotates around its Y-axis for auto-rotation (like Earth)

    // Apply sphere auto-rotation only around Y-axis (vertical axis)
    const ctx = getAppContext();
    if (ctx.hexasphere && ctx.hexasphere.mesh) {
        if (autoRotate) {
            // Auto-rotate the sphere around its own Y-axis (like Earth)
            ctx.hexasphere.mesh.rotation.y = rotation.y;
        } else {
            // When manually controlling, keep sphere orientation fixed and move camera
            ctx.hexasphere.mesh.rotation.y = 0;
        }
        ctx.hexasphere.mesh.rotation.x = 0;
        ctx.hexasphere.mesh.rotation.z = 0;
    }

    // Position camera using proper spherical coordinates for vertical axis
    // rotation.y = horizontal rotation around Y-axis (azimuth)
    // rotation.x = vertical angle (elevation/inclination)
    camera.position.x = cameraDistance * Math.sin(rotation.y) * Math.cos(rotation.x);
    camera.position.y = cameraDistance * Math.sin(rotation.x); // Y is vertical
    camera.position.z = cameraDistance * Math.cos(rotation.y) * Math.cos(rotation.x);
    camera.lookAt(scene.position); // Ensure camera is looking at the origin (0,0,0) where the scene content is.

    renderer.render(scene, camera);

    if (typeof updateCallback === 'function') {
        updateCallback(time, rotation, targetRotation);
    }
}

/**
 * Handle window resize events
 * @param {any} camera - THREE.Camera instance
 * @param {any} renderer - THREE.Renderer instance
 */
function onWindowResize(camera, renderer) {
    const width = window.innerWidth;
    const height = window.innerHeight - 10;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

module.exports = {
    createScene,
    tick,
    onWindowResize
};
