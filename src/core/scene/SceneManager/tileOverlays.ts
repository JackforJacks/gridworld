// Scene Manager - Tile Overlays
// Handles population overlay meshes on tiles
import * as THREE from 'three';
import { BoundaryPoint, HexTile } from './types';

/** Overlay configuration */
const OVERLAY_CONFIG = {
    color: 0xff0000,
    opacity: 0.15,
    renderOrder: 10
};

/**
 * Create an overlay mesh for a tile
 */
export function createTileOverlay(tile: HexTile): THREE.Mesh | null {
    // Build overlay geometry from tile boundary
    const boundaryPoints = tile.boundary.map((p: BoundaryPoint) => {
        const center = tile.centerPoint;
        const scale = 1.0; // Same size as tile
        const x = center.x + (p.x - center.x) * scale;
        const y = center.y + (p.y - center.y) * scale;
        const z = center.z + (p.z - center.z) * scale;
        return new THREE.Vector3(x, y, z);
    });
    
    if (boundaryPoints.length < 3) return null;
    
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    
    // Triangle fan triangulation
    for (let i = 1; i < boundaryPoints.length - 1; i++) {
        const p0 = boundaryPoints[0];
        const p1 = boundaryPoints[i];
        const p2 = boundaryPoints[i + 1];
        vertices.push(p0.x, p0.y, p0.z);
        vertices.push(p1.x, p1.y, p1.z);
        vertices.push(p2.x, p2.y, p2.z);
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    
    const material = new THREE.MeshBasicMaterial({
        color: OVERLAY_CONFIG.color,
        transparent: true,
        opacity: OVERLAY_CONFIG.opacity,
        depthWrite: true
    });
    
    const overlayMesh = new THREE.Mesh(geometry, material);
    overlayMesh.renderOrder = OVERLAY_CONFIG.renderOrder;
    
    return overlayMesh;
}

/**
 * Dispose of an overlay mesh properly
 */
export function disposeOverlay(overlay: THREE.Mesh): void {
    overlay.geometry.dispose();
    (overlay.material as THREE.Material).dispose();
}

/**
 * Manages tile overlay state
 */
export class TileOverlayManager {
    private scene: THREE.Scene;
    private overlays: Map<string, THREE.Mesh> = new Map();
    
    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }
    
    /**
     * Add overlay for a tile
     */
    add(tile: HexTile): void {
        const tileId = String(tile.id);
        
        // Remove existing overlay first
        this.remove(tileId);
        
        const overlay = createTileOverlay(tile);
        if (overlay) {
            this.scene.add(overlay);
            this.overlays.set(tileId, overlay);
        }
    }
    
    /**
     * Remove overlay for a tile
     */
    remove(tileId: string): void {
        const overlay = this.overlays.get(tileId);
        if (overlay) {
            this.scene.remove(overlay);
            disposeOverlay(overlay);
            this.overlays.delete(tileId);
        }
    }
    
    /**
     * Check if tile has an overlay
     */
    has(tileId: string): boolean {
        return this.overlays.has(tileId);
    }
    
    /**
     * Clear all overlays
     */
    clear(): void {
        this.overlays.forEach((overlay, _tileId) => {
            this.scene.remove(overlay);
            disposeOverlay(overlay);
        });
        this.overlays.clear();
    }
    
    /**
     * Get overlay count
     */
    get size(): number {
        return this.overlays.size;
    }
}
