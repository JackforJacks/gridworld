// Scene Manager - Tile Overlays
// Handles population overlay meshes on tiles
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
 * Create an overlay mesh for a tile
 */
export function createTileOverlay(tile: HexTile): THREE.Mesh | null {
    // Build overlay geometry from tile boundary
    const center = normalizePoint(tile.centerPoint);
    const boundaryPoints = tile.boundary.map((p: AnyPoint) => {
        const pt = normalizePoint(p);
        const scale = 1.0; // Same size as tile
        const x = center.x + (pt.x - center.x) * scale;
        const y = center.y + (pt.y - center.y) * scale;
        const z = center.z + (pt.z - center.z) * scale;
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
 * Dispose of an overlay (mesh or line) properly
 */
export function disposeOverlay(overlay: THREE.Mesh | THREE.Line): void {
    overlay.geometry.dispose();
    (overlay.material as THREE.Material).dispose();
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
 * Manages tile overlay state
 */
export class TileOverlayManager {
    private scene: THREE.Scene;
    private overlays: Map<string, THREE.Mesh> = new Map();
    private flashOverlays: Map<string, THREE.Line> = new Map();
    private flashTimers: Map<string, { timeout: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> }> = new Map();

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
            disposeOverlay(flashOverlay);
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
