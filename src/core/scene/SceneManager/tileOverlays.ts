// Scene Manager - Tile Overlays
// Pre-built overlay system: geometry built once, visibility toggled via per-vertex alpha.
// Zero runtime geometry allocation. Single draw call for all overlays.
import * as THREE from 'three';
import { HexTile, AnyPoint } from './types';
import { normalizePoint } from './geometryBuilder';

/** Overlay configuration */
const OVERLAY_CONFIG = {
    color: 0xffff00,  // Bright yellow for populated tiles
    opacity: 0.3,
    renderOrder: 10,
    offset: 0.015     // Radial offset above sphere surface
};

/** Flash overlay configuration */
const FLASH_CONFIG = {
    color: 0xff0000,
    opacity: 1.0,
    renderOrder: 100,
    duration: 5000,
    blinkInterval: 200,
    scale: 1,
    heightOffset: 1
};

/** Border configuration */
const BORDER_CONFIG = {
    color: 0x000000,
    opacity: 0.15,
    lineWidth: 1,
    renderOrder: 5,
    offset: 0.002
};

// Overlay ShaderMaterial: uses per-vertex alpha to show/hide individual tiles
const overlayVertexShader = `
    attribute float alpha;
    varying float vAlpha;
    void main() {
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const overlayFragmentShader = `
    uniform vec3 color;
    uniform float baseOpacity;
    varying float vAlpha;
    void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(color, baseOpacity * vAlpha);
    }
`;

/**
 * Spatial hash key for edge deduplication
 */
const PRECISION = 1000;
function vertexKey(x: number, y: number, z: number): string {
    return `${Math.round(x * PRECISION)},${Math.round(y * PRECISION)},${Math.round(z * PRECISION)}`;
}

/**
 * Create a flash overlay for a tile (bright red border outline)
 */
export function createFlashOverlay(tile: HexTile): THREE.Line | null {
    const center = normalizePoint(tile.centerPoint);
    const boundaryPoints = tile.boundary.map((p: AnyPoint) => {
        const pt = normalizePoint(p);
        const scale = FLASH_CONFIG.scale;
        const sx = center.x + (pt.x - center.x) * scale;
        const sy = center.y + (pt.y - center.y) * scale;
        const sz = center.z + (pt.z - center.z) * scale;
        const heightScale = FLASH_CONFIG.heightOffset;
        return new THREE.Vector3(sx * heightScale, sy * heightScale, sz * heightScale);
    });

    if (boundaryPoints.length < 3) return null;

    const closedPoints = [...boundaryPoints, boundaryPoints[0]];
    const geometry = new THREE.BufferGeometry().setFromPoints(closedPoints);

    const material = new THREE.LineBasicMaterial({
        color: FLASH_CONFIG.color,
        linewidth: 3,
        depthWrite: true,
        depthTest: true
    });

    const borderLine = new THREE.Line(geometry, material);
    borderLine.renderOrder = FLASH_CONFIG.renderOrder;
    return borderLine;
}

/**
 * Builds deduplicated border geometry for all tiles.
 * Shared edges between adjacent tiles are drawn only once.
 */
export function buildMergedBorderGeometry(tiles: HexTile[]): THREE.BufferGeometry | null {
    if (tiles.length === 0) return null;

    const edgeSet = new Set<string>();
    const allPoints: number[] = [];

    for (const tile of tiles) {
        const boundary = tile.boundary.map((p: AnyPoint) => normalizePoint(p));
        if (boundary.length < 3) continue;

        for (let i = 0; i < boundary.length; i++) {
            const a = boundary[i];
            const b = boundary[(i + 1) % boundary.length];

            // Canonical edge key (smaller vertex key first) to deduplicate shared edges
            const keyA = vertexKey(a.x, a.y, a.z);
            const keyB = vertexKey(b.x, b.y, b.z);
            const edgeKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;

            if (edgeSet.has(edgeKey)) continue;
            edgeSet.add(edgeKey);

            // Offset outward to prevent z-fighting
            const nAx = a.x, nAy = a.y, nAz = a.z;
            const nBx = b.x, nBy = b.y, nBz = b.z;
            const lenA = Math.sqrt(nAx * nAx + nAy * nAy + nAz * nAz);
            const lenB = Math.sqrt(nBx * nBx + nBy * nBy + nBz * nBz);
            const offA = BORDER_CONFIG.offset / lenA;
            const offB = BORDER_CONFIG.offset / lenB;

            allPoints.push(
                nAx + nAx * offA, nAy + nAy * offA, nAz + nAz * offA,
                nBx + nBx * offB, nBy + nBy * offB, nBz + nBz * offB
            );
        }
    }

    if (allPoints.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(allPoints, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

/**
 * Builds pre-built overlay geometry for all habitable tiles.
 * Per-vertex alpha attribute controls visibility (0.0 = hidden, 1.0 = visible).
 * Uses indexed triangle fan per tile for vertex efficiency.
 */
function buildPrebuiltOverlayGeometry(
    habitableTiles: HexTile[]
): {
    geometry: THREE.BufferGeometry;
    tileAlphaRanges: Map<string, { start: number; count: number }>;
} | null {
    if (habitableTiles.length === 0) return null;

    // Phase 1: count totals
    let totalVertices = 0;
    let totalTriangles = 0;
    for (const tile of habitableTiles) {
        const bLen = tile.boundary?.length || 0;
        if (bLen >= 3) {
            totalVertices += bLen;
            totalTriangles += bLen - 2;
        }
    }

    if (totalVertices === 0) return null;

    // Phase 2: allocate
    const positions = new Float32Array(totalVertices * 3);
    const alphas = new Float32Array(totalVertices); // per-vertex alpha, all 0.0 initially
    const useUint16 = totalVertices < 65535;
    const indices = useUint16
        ? new Uint16Array(totalTriangles * 3)
        : new Uint32Array(totalTriangles * 3);

    const tileAlphaRanges = new Map<string, { start: number; count: number }>();

    // Phase 3: fill
    let posIdx = 0;
    let alphaIdx = 0;
    let idxIdx = 0;
    let baseVertex = 0;

    for (const tile of habitableTiles) {
        const boundary = tile.boundary.map((p: AnyPoint) => normalizePoint(p));
        if (boundary.length < 3) continue;

        const tileId = String(tile.id);
        const alphaStart = alphaIdx;
        const bLen = boundary.length;

        // Write each boundary vertex once, offset outward
        for (let i = 0; i < bLen; i++) {
            const pt = boundary[i];
            const len = Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z);
            const off = OVERLAY_CONFIG.offset / len;
            positions[posIdx++] = pt.x + pt.x * off;
            positions[posIdx++] = pt.y + pt.y * off;
            positions[posIdx++] = pt.z + pt.z * off;
            alphas[alphaIdx++] = 0.0; // invisible by default
        }

        // Triangle fan indices
        for (let i = 1; i < bLen - 1; i++) {
            indices[idxIdx++] = baseVertex;
            indices[idxIdx++] = baseVertex + i;
            indices[idxIdx++] = baseVertex + i + 1;
        }

        tileAlphaRanges.set(tileId, { start: alphaStart, count: bLen });
        baseVertex += bLen;
    }

    // Trim and build geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, posIdx), 3));

    const alphaAttr = new THREE.BufferAttribute(alphas.subarray(0, alphaIdx), 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage); // will be updated at runtime
    geometry.setAttribute('alpha', alphaAttr);

    geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, idxIdx), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    return { geometry, tileAlphaRanges };
}

/**
 * Manages tile overlay state with pre-built geometry.
 * Overlays are built once; visibility is toggled via per-vertex alpha (zero GPU allocation at runtime).
 */
export class TileOverlayManager {
    private scene: THREE.Scene;
    private overlayMesh: THREE.Mesh | null = null;
    private overlayGeometry: THREE.BufferGeometry | null = null;
    private overlayMaterial: THREE.ShaderMaterial | null = null;
    private tileAlphaRanges: Map<string, { start: number; count: number }> = new Map();
    private visibleTileIds: Set<string> = new Set();

    private borderLines: THREE.LineSegments | null = null;
    private borderMaterial: THREE.LineBasicMaterial | null = null;
    private flashOverlays: Map<string, THREE.Line> = new Map();
    private flashMaterial: THREE.LineBasicMaterial | null = null;
    private flashTimers: Map<string, { timeout: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> }> = new Map();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    /**
     * Build overlay geometry once for all habitable tiles.
     * Call after hexasphere is built. No runtime geometry allocation needed after this.
     */
    initOverlays(habitableTiles: HexTile[]): void {
        // Dispose previous if exists
        this.disposeOverlays();

        const result = buildPrebuiltOverlayGeometry(habitableTiles);
        if (!result) return;

        this.overlayGeometry = result.geometry;
        this.tileAlphaRanges = result.tileAlphaRanges;

        this.overlayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(OVERLAY_CONFIG.color) },
                baseOpacity: { value: OVERLAY_CONFIG.opacity }
            },
            vertexShader: overlayVertexShader,
            fragmentShader: overlayFragmentShader,
            transparent: true,
            depthWrite: false,
            side: THREE.FrontSide
        });

        this.overlayMesh = new THREE.Mesh(this.overlayGeometry, this.overlayMaterial);
        this.overlayMesh.renderOrder = OVERLAY_CONFIG.renderOrder;
        this.scene.add(this.overlayMesh);
    }

    /**
     * Batch update overlay visibility for all tiles.
     * Sets alpha=1 for populated tiles, alpha=0 for others. Single needsUpdate.
     */
    updateVisibility(populatedTileIds: Set<string>): void {
        if (!this.overlayGeometry) return;

        // Skip if nothing changed
        if (populatedTileIds.size === this.visibleTileIds.size) {
            let same = true;
            for (const id of populatedTileIds) {
                if (!this.visibleTileIds.has(id)) { same = false; break; }
            }
            if (same) return;
        }

        const alphaAttr = this.overlayGeometry.getAttribute('alpha') as THREE.BufferAttribute;
        const alphaArray = alphaAttr.array as Float32Array;

        // Hide tiles that are no longer populated
        for (const id of this.visibleTileIds) {
            if (!populatedTileIds.has(id)) {
                const range = this.tileAlphaRanges.get(id);
                if (range) {
                    for (let i = range.start; i < range.start + range.count; i++) {
                        alphaArray[i] = 0.0;
                    }
                }
            }
        }

        // Show newly populated tiles
        for (const id of populatedTileIds) {
            if (!this.visibleTileIds.has(id)) {
                const range = this.tileAlphaRanges.get(id);
                if (range) {
                    for (let i = range.start; i < range.start + range.count; i++) {
                        alphaArray[i] = 1.0;
                    }
                }
            }
        }

        alphaAttr.needsUpdate = true;
        this.visibleTileIds = new Set(populatedTileIds);
    }

    /**
     * Hide all overlays (set all alpha to 0)
     */
    hideAll(): void {
        if (!this.overlayGeometry || this.visibleTileIds.size === 0) return;

        const alphaAttr = this.overlayGeometry.getAttribute('alpha') as THREE.BufferAttribute;
        const alphaArray = alphaAttr.array as Float32Array;
        alphaArray.fill(0.0);
        alphaAttr.needsUpdate = true;
        this.visibleTileIds.clear();
    }

    /**
     * Check if tile has a visible overlay
     */
    has(tileId: string): boolean {
        return this.visibleTileIds.has(tileId);
    }

    /**
     * Get visible overlay count
     */
    get size(): number {
        return this.visibleTileIds.size;
    }

    /**
     * Create deduplicated borders for all tiles. Call once when tiles are created.
     */
    createBorders(tiles: HexTile[]): void {
        this.clearBorders();

        const geometry = buildMergedBorderGeometry(tiles);
        if (!geometry) return;

        this.borderMaterial = new THREE.LineBasicMaterial({
            color: BORDER_CONFIG.color,
            transparent: true,
            opacity: BORDER_CONFIG.opacity,
            depthWrite: false
        });

        this.borderLines = new THREE.LineSegments(geometry, this.borderMaterial);
        this.borderLines.renderOrder = BORDER_CONFIG.renderOrder;
        this.scene.add(this.borderLines);
    }

    /**
     * Clear borders
     */
    clearBorders(): void {
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines.geometry.dispose();
            this.borderLines = null;
        }
        if (this.borderMaterial) {
            this.borderMaterial.dispose();
            this.borderMaterial = null;
        }
    }

    /**
     * Dispose overlay geometry and material
     */
    private disposeOverlays(): void {
        if (this.overlayMesh) {
            this.scene.remove(this.overlayMesh);
            this.overlayMesh = null;
        }
        if (this.overlayGeometry) {
            this.overlayGeometry.dispose();
            this.overlayGeometry = null;
        }
        if (this.overlayMaterial) {
            this.overlayMaterial.dispose();
            this.overlayMaterial = null;
        }
        this.tileAlphaRanges.clear();
        this.visibleTileIds.clear();
    }

    /**
     * Clear all overlays and dispose all GPU resources
     */
    clear(): void {
        this.disposeOverlays();
        this.clearBorders();
    }

    /**
     * Flash a tile in bright red for 5 seconds with blinking effect
     */
    flashTile(tile: HexTile): void {
        const tileId = String(tile.id);
        this.stopFlash(tileId);

        const flashOverlay = createFlashOverlay(tile);
        if (!flashOverlay) return;

        this.scene.add(flashOverlay);
        this.flashOverlays.set(tileId, flashOverlay);

        let visible = true;
        const interval = setInterval(() => {
            visible = !visible;
            flashOverlay.visible = visible;
        }, FLASH_CONFIG.blinkInterval);

        const timeout = setTimeout(() => {
            this.stopFlash(tileId);
        }, FLASH_CONFIG.duration);

        this.flashTimers.set(tileId, { timeout, interval });
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
        this.flashTimers.forEach((_timers, tileId) => {
            this.stopFlash(tileId);
        });
    }
}
