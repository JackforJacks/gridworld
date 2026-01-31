// TileSelector - Tile Border Rendering
// Handles the glowing border effect around selected tiles
import * as THREE from 'three';
import { HexTile } from './types';

/** Border glow layer colors (from center outward) */
const GLOW_COLORS = [0xffff00, 0xffdd00, 0xffaa00, 0xff8800];

/** Number of glow layers */
const GLOW_LAYERS = 4;

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
                const vec = new THREE.Vector3(point.x, point.y, point.z);

                // Apply outward offset along normal
                if (offsetScale > 0) {
                    const normal = vec.clone().normalize();
                    vec.add(normal.multiplyScalar(offsetScale));
                }

                vertices.push(vec.x, vec.y, vec.z);
            }
        }

        if (vertices.length > 0) {
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

            const glowIntensity = 1 - (offset * 0.2);
            const material = new THREE.LineBasicMaterial({
                color: GLOW_COLORS[offset],
                depthTest: false,
                transparent: true,
                opacity: glowIntensity * 0.8,
                linewidth: 8 - (offset * 1.5)
            });

            borderGroup.add(new THREE.LineLoop(geometry, material));
        }
    }

    return borderGroup;
}

/**
 * Remove border from scene and clean up
 */
export function removeTileBorder(scene: THREE.Scene, borderLines: THREE.Group | null): void {
    if (borderLines) {
        scene.remove(borderLines);
    }
}
