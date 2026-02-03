// TileSelector - Tile Border Rendering
// Handles the glowing border effect around selected tiles
import * as THREE from 'three';
import { HexTile } from './types';

/** Border glow layer colors (from center outward) */
const GLOW_COLORS = [0xffff00, 0xffdd00, 0xffaa00, 0xff8800];

/** Number of glow layers */
const GLOW_LAYERS = 4;

// Cached vectors to avoid allocations in loops
const _vec = new THREE.Vector3();
const _normal = new THREE.Vector3();

// Cached materials (reused across border creations)
const cachedMaterials: THREE.LineBasicMaterial[] = GLOW_COLORS.map((color, offset) => {
    const glowIntensity = 1 - (offset * 0.2);
    return new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: glowIntensity * 0.8,
        linewidth: 8 - (offset * 1.5)
    });
});

/**
 * Create a glowing border around a tile
 */
export function createTileBorder(tile: HexTile): THREE.Group {
    const borderGroup = new THREE.Group();

    for (let offset = 0; offset < GLOW_LAYERS; offset++) {
        const geometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        const offsetScale = offset * 0.004;

        // Create continuous line loop around tile boundary
        const boundaryLen = tile.boundary.length;
        for (let i = 0; i <= boundaryLen; i++) {
            const point = tile.boundary[i % boundaryLen];

            if (point && !isNaN(point.x) && !isNaN(point.y) && !isNaN(point.z)) {
                // Reuse cached vector instead of creating new one
                _vec.set(point.x, point.y, point.z);

                // Apply outward offset along normal
                if (offsetScale > 0) {
                    _normal.copy(_vec).normalize().multiplyScalar(offsetScale);
                    _vec.add(_normal);
                }

                vertices.push(_vec.x, _vec.y, _vec.z);
            }
        }

        if (vertices.length > 0) {
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            // Reuse cached material instead of creating new one per border
            borderGroup.add(new THREE.LineLoop(geometry, cachedMaterials[offset]));
        }
    }

    return borderGroup;
}

/**
 * Remove border from scene and clean up
 */
export function removeTileBorder(scene: THREE.Scene, borderLines: THREE.Group | null): void {
    if (borderLines) {
        // Dispose geometries to prevent memory leaks (materials are cached and reused)
        borderLines.traverse((child) => {
            if (child instanceof THREE.LineLoop) {
                child.geometry.dispose();
            }
        });
        scene.remove(borderLines);
    }
}
