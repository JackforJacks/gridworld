// Scene Manager - Tile Overlays
// Merged overlay system - all population overlays in single BufferGeometry (1 draw call)
import * as THREE from 'three';
import { BoundaryPoint, HexTile, AnyPoint } from './types';
import { normalizePoint } from './geometryBuilder';

/** Overlay configuration */
const OVERLAY_CONFIG = {
    color: 0xffff00,  // Bright yellow for populated tiles
    opacity: 0.4,
    renderOrder: 10
};

/** Flash overlay configuration */
const FLASH_CONFIG = {
    color: 0xff0000,  // Bright red for flashing
    opacity: 1.0,     // Fully opaque to cover entire tile
    renderOrder: 100, // High render order to be on top
    duration: 5000,   // 5 seconds
    blinkInterval: 200, // Blink every 200ms
    scale: 1,      // Scale outward for thick visible border
    heightOffset: 1 // Raise slightly above tile surface for visibility
};

/**
 * Merged overlay mesh data
 */
interface MergedOverlayData {
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    tileIndices: Map<string, { start: number; count: number }>;
}

/**
 * Create a flash overlay for a tile (bright red border outline only)
 */
export function createFlashOverlay(tile: HexTile): THREE.Line | null {
    // Build border line from tile boundary - scaled inward to stay inside tile
    // Then offset outward from center (radially) to raise above surface
    const center = normalizePoint(tile.centerPoint);
    const boundaryPoints = tile.boundary.map((p: AnyPoint) => {
        const pt = normalizePoint(p);
        const scale = FLASH_CONFIG.scale;
        // First scale inward from center
        const sx = center.x + (pt.x - center.x) * scale;
        const sy = center.y + (pt.y - center.y) * scale;
        const sz = center.z + (pt.z - center.z) * scale;
        // Then offset radially outward to raise above surface
        const heightScale = FLASH_CONFIG.heightOffset;
        return new THREE.Vector3(sx * heightScale, sy * heightScale, sz * heightScale);
    });

    if (boundaryPoints.length < 3) return null;

    // Close the loop by adding first point at the end
    const closedPoints = [...boundaryPoints, boundaryPoints[0]];

    const geometry = new THREE.BufferGeometry().setFromPoints(closedPoints);

    const material = new THREE.LineBasicMaterial({
        color: FLASH_CONFIG.color,
        linewidth: 3, // Note: linewidth > 1 only works on some systems
        depthWrite: true,
        depthTest: true
    });

    const borderLine = new THREE.Line(geometry, material);
    borderLine.renderOrder = FLASH_CONFIG.renderOrder;

    return borderLine;
}

/**
 * Builds merged overlay geometry from multiple tiles
 * Returns single BufferGeometry containing all tile overlays
 */
function buildMergedOverlayGeometry(tiles: HexTile[]): THREE.BufferGeometry | null {
    if (tiles.length === 0) return null;

    const allVertices: number[] = [];
    const tileIndices = new Map<string, { start: number; count: number }>();

    for (const tile of tiles) {
        const center = normalizePoint(tile.centerPoint);
        const boundaryPoints = tile.boundary.map((p: AnyPoint) => {
            const pt = normalizePoint(p);
            const scale = 1.0;
            const x = center.x + (pt.x - center.x) * scale;
            const y = center.y + (pt.y - center.y) * scale;
            const z = center.z + (pt.z - center.z) * scale;
            return new THREE.Vector3(x, y, z);
        });

        if (boundaryPoints.length < 3) continue;

        const startIndex = allVertices.length / 3;
        let triangleCount = 0;

        // Triangle fan triangulation for this tile
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            const p0 = boundaryPoints[0];
            const p1 = boundaryPoints[i];
            const p2 = boundaryPoints[i + 1];
            allVertices.push(p0.x, p0.y, p0.z);
            allVertices.push(p1.x, p1.y, p1.z);
            allVertices.push(p2.x, p2.y, p2.z);
            triangleCount++;
        }

        tileIndices.set(String(tile.id), {
            start: startIndex,
            count: triangleCount * 3
        });
    }

    if (allVertices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(allVertices, 3));
    geometry.computeVertexNormals();

    // Store tile indices for potential future use
    (geometry as unknown as { userData: { tileIndices: Map<string, { start: number; count: number }> } }).userData = { tileIndices };

    return geometry;
}

/**
 * Manages tile overlay state with merged geometry (single draw call)
 */
export class TileOverlayManager {
    private scene: THREE.Scene;
    private mergedOverlay: MergedOverlayData | null = null;
    private flashOverlays: Map<string, THREE.Line> = new Map();
    private flashTimers: Map<string, { timeout: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> }> = new Map();
    private tileIds: Set<string> = new Set();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    /**
     * Rebuild merged overlay with all populated tiles
     * Call this after population changes instead of individual add/remove
     */
    rebuild(tiles: HexTile[]): void {
        // Dispose old merged overlay
        if (this.mergedOverlay) {
            this.scene.remove(this.mergedOverlay.mesh);
            this.mergedOverlay.geometry.dispose();
            (this.mergedOverlay.mesh.material as THREE.Material).dispose();
            this.mergedOverlay = null;
        }

        if (tiles.length === 0) return;

        // Build new merged geometry
        const geometry = buildMergedOverlayGeometry(tiles);
        if (!geometry) return;

        const material = new THREE.MeshBasicMaterial({
            color: OVERLAY_CONFIG.color,
            transparent: true,
            opacity: OVERLAY_CONFIG.opacity,
            depthWrite: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = OVERLAY_CONFIG.renderOrder;

        this.scene.add(mesh);

        this.mergedOverlay = {
            mesh,
            geometry,
            tileIndices: (geometry as unknown as { userData: { tileIndices: Map<string, { start: number; count: number }> } }).userData.tileIndices
        };

        // Track tile IDs
        this.tileIds.clear();
        for (const tile of tiles) {
            this.tileIds.add(String(tile.id));
        }
    }

    /**
     * Legacy: Add overlay for a tile (no-op in merged system - use rebuild)
     * Kept for API compatibility
     */
    add(_tile: HexTile): void {
        // Merged system requires rebuild() - individual add not supported
    }

    /**
     * Legacy: Remove overlay for a tile (no-op in merged system - use rebuild)
     * Kept for API compatibility
     */
    remove(_tileId: string): void {
        // Merged system requires rebuild() - individual remove not supported
    }

    /**
     * Check if tile has an overlay
     */
    has(tileId: string): boolean {
        return this.tileIds.has(tileId);
    }

    /**
     * Clear all overlays
     */
    clear(): void {
        if (this.mergedOverlay) {
            this.scene.remove(this.mergedOverlay.mesh);
            this.mergedOverlay.geometry.dispose();
            (this.mergedOverlay.mesh.material as THREE.Material).dispose();
            this.mergedOverlay = null;
        }
        this.tileIds.clear();
    }

    /**
     * Get overlay count
     */
    get size(): number {
        return this.tileIds.size;
    }

    /**
     * Flash a tile in bright red for 5 seconds with blinking effect
     */
    flashTile(tile: HexTile): void {
        const tileId = String(tile.id);

        // Clear any existing flash for this tile
        this.stopFlash(tileId);

        const flashOverlay = createFlashOverlay(tile);
        if (!flashOverlay) return;

        this.scene.add(flashOverlay);
        this.flashOverlays.set(tileId, flashOverlay);

        // Blink effect - toggle visibility
        let visible = true;
        const interval = setInterval(() => {
            visible = !visible;
            flashOverlay.visible = visible;
        }, FLASH_CONFIG.blinkInterval);

        // Remove after duration
        const timeout = setTimeout(() => {
            this.stopFlash(tileId);
        }, FLASH_CONFIG.duration);

        this.flashTimers.set(tileId, { timeout, interval });

        console.log(`🔴 Flashing tile ${tileId} for ${FLASH_CONFIG.duration / 1000} seconds`);
    }

    /**
     * Stop flashing a tile
     */
    private stopFlash(tileId: string): void {
        const timers = this.flashTimers.get(tileId);
        if (timers) {
            clearTimeout(timers.timeout);
            clearInterval(timers.interval);
            this.flashTimers.delete(tileId);
        }

        const flashOverlay = this.flashOverlays.get(tileId);
        if (flashOverlay) {
            this.scene.remove(flashOverlay);
            flashOverlay.geometry.dispose();
            (flashOverlay.material as THREE.Material).dispose();
            this.flashOverlays.delete(tileId);
        }
    }

    /**
     * Clear all overlays and flashes
     */
    clearAll(): void {
        this.clear();
        this.flashTimers.forEach((timers, tileId) => {
            this.stopFlash(tileId);
        });
    }
}
