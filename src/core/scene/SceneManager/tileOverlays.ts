// Scene Manager - Tile Overlays
// Merged overlay system - all population overlays in single BufferGeometry (1 draw call)
import * as THREE from 'three';
import { BoundaryPoint, HexTile, AnyPoint } from './types';
import { normalizePoint } from './geometryBuilder';

/** Overlay configuration */
const OVERLAY_CONFIG = {
    color: 0xffff00,  // Bright yellow for populated tiles
    opacity: 0.3,
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
            return new THREE.Vector3(pt.x, pt.y, pt.z);
        });

        // Offset all points outward from sphere origin so overlay sits on top of tile
        const offset = 0.015;
        for (const bp of boundaryPoints) {
            const normal = bp.clone().normalize();
            bp.add(normal.multiplyScalar(offset));
        }

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

/** Border configuration */
const BORDER_CONFIG = {
    color: 0x000000,  // Black borders
    opacity: 0.15,    // Very transparent - barely visible
    lineWidth: 1,     // Minimum width
    renderOrder: 5,   // Below overlays but above tiles
    offset: 0.002     // Minimal offset to prevent z-fighting
};

/**
 * Builds merged border geometry for all tiles
 * Creates thin black lines along tile boundaries
 */
export function buildMergedBorderGeometry(tiles: HexTile[]): THREE.BufferGeometry | null {
    if (tiles.length === 0) return null;

    const allPoints: number[] = [];

    for (const tile of tiles) {
        const boundaryPoints = tile.boundary.map((p: AnyPoint) => {
            const pt = normalizePoint(p);
            // Offset slightly outward to prevent z-fighting with tile surface
            const normal = new THREE.Vector3(pt.x, pt.y, pt.z).normalize();
            return new THREE.Vector3(
                pt.x + normal.x * BORDER_CONFIG.offset,
                pt.y + normal.y * BORDER_CONFIG.offset,
                pt.z + normal.z * BORDER_CONFIG.offset
            );
        });

        if (boundaryPoints.length < 3) continue;

        // Create line loop for this tile (each edge is a line segment)
        for (let i = 0; i < boundaryPoints.length; i++) {
            const current = boundaryPoints[i];
            const next = boundaryPoints[(i + 1) % boundaryPoints.length];
            
            // Add line segment: current -> next
            allPoints.push(current.x, current.y, current.z);
            allPoints.push(next.x, next.y, next.z);
        }
    }

    if (allPoints.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPoints, 3));

    return geometry;
}

/**
 * Manages tile overlay state with merged geometry (single draw call)
 */
export class TileOverlayManager {
    private scene: THREE.Scene;
    private mergedOverlay: MergedOverlayData | null = null;
    private overlayMaterial: THREE.MeshBasicMaterial | null = null;
    private overlayMesh: THREE.Mesh | null = null;
    private borderLines: THREE.LineSegments | null = null;
    private flashOverlays: Map<string, THREE.Line> = new Map();
    private flashTimers: Map<string, { timeout: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> }> = new Map();
    private tileIds: Set<string> = new Set();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        // Create material once and reuse
        this.overlayMaterial = new THREE.MeshBasicMaterial({
            color: OVERLAY_CONFIG.color,
            transparent: true,
            opacity: OVERLAY_CONFIG.opacity,
            depthWrite: false
        });
    }

    /**
     * Create thin black borders for all tiles
     * Call once when tiles are created
     */
    createBorders(tiles: HexTile[]): void {
        // Dispose old borders
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines.geometry.dispose();
            (this.borderLines.material as THREE.Material).dispose();
            this.borderLines = null;
        }

        const geometry = buildMergedBorderGeometry(tiles);
        if (!geometry) return;

        const material = new THREE.LineBasicMaterial({
            color: BORDER_CONFIG.color,
            transparent: true,
            opacity: BORDER_CONFIG.opacity,
            depthWrite: false
        });

        this.borderLines = new THREE.LineSegments(geometry, material);
        this.borderLines.renderOrder = BORDER_CONFIG.renderOrder;
        this.scene.add(this.borderLines);
    }

    /**
     * Clear borders (call when tiles are cleared)
     */
    clearBorders(): void {
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines.geometry.dispose();
            (this.borderLines.material as THREE.Material).dispose();
            this.borderLines = null;
        }
    }

    /**
     * Rebuild merged overlay with all populated tiles
     * Skips rebuild if the set of populated tiles hasn't changed.
     * Reuses material and mesh object to avoid GPU memory churn.
     */
    rebuild(tiles: HexTile[]): void {
        // Build new tile ID set and check if anything changed
        const newTileIds = new Set<string>();
        for (const tile of tiles) {
            newTileIds.add(String(tile.id));
        }

        // Skip rebuild if populated tile set is identical
        if (newTileIds.size === this.tileIds.size) {
            let same = true;
            for (const id of newTileIds) {
                if (!this.tileIds.has(id)) { same = false; break; }
            }
            if (same) return;
        }

        // Dispose old geometry only (keep material and mesh for reuse)
        if (this.mergedOverlay) {
            // Clear tileIndices Map and userData to release references for GC
            this.mergedOverlay.tileIndices.clear();
            (this.mergedOverlay.geometry as unknown as { userData: unknown }).userData = null;
            this.mergedOverlay.geometry.dispose();
            this.mergedOverlay = null;
        }

        this.tileIds = newTileIds;

        if (tiles.length === 0) {
            // Hide mesh if no tiles
            if (this.overlayMesh) this.overlayMesh.visible = false;
            return;
        }

        // Build new merged geometry
        const geometry = buildMergedOverlayGeometry(tiles);
        if (!geometry) {
            if (this.overlayMesh) this.overlayMesh.visible = false;
            return;
        }

        if (this.overlayMesh) {
            // Reuse existing mesh — just swap geometry
            this.overlayMesh.geometry = geometry;
            this.overlayMesh.visible = true;
        } else {
            // First time: create mesh and add to scene
            this.overlayMesh = new THREE.Mesh(geometry, this.overlayMaterial!);
            this.overlayMesh.renderOrder = OVERLAY_CONFIG.renderOrder;
            this.scene.add(this.overlayMesh);
        }

        this.mergedOverlay = {
            mesh: this.overlayMesh,
            geometry,
            tileIndices: (geometry as unknown as { userData: { tileIndices: Map<string, { start: number; count: number }> } }).userData.tileIndices
        };
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
     * Clear all overlays and dispose all GPU resources
     */
    clear(): void {
        if (this.mergedOverlay) {
            this.mergedOverlay.tileIndices.clear();
            (this.mergedOverlay.geometry as unknown as { userData: unknown }).userData = null;
            this.mergedOverlay.geometry.dispose();
            this.mergedOverlay = null;
        }
        if (this.overlayMesh) {
            this.scene.remove(this.overlayMesh);
            this.overlayMesh = null;
        }
        if (this.overlayMaterial) {
            this.overlayMaterial.dispose();
            this.overlayMaterial = null;
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
