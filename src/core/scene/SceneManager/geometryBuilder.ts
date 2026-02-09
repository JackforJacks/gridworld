// Scene Manager - Geometry Builder
// Handles tile geometry creation and validation
// Modern Three.js patterns: indexed geometry with per-tile fan dedup, Uint16 indices
import * as THREE from 'three';
import { BoundaryPoint, HexTile, TileColorInfo, TileDataResponse, HexasphereData } from './types';
import { getBiomeColorCached } from './colorUtils';
import { isHabitable } from '../../../utils/tileUtils';

/** Mapping from tile ID to vertex index range */
export interface TileVertexRange {
    startIndex: number;  // First vertex index for this tile
    count: number;       // Number of vertices (boundary.length)
}

/** Result from building tiles */
export interface BuildTilesResult {
    hexasphere: HexasphereData;
    habitableTileIds: (number | string)[];
    tileColorIndices: Map<string, TileColorInfo>;
    geometry: THREE.BufferGeometry;
    tileVertexRanges: Map<string, TileVertexRange>;
}

/**
 * Normalize a point (array or object) to {x, y, z} format
 * Handles both object {x,y,z} and array [x,y,z] formats
 */
export function normalizePoint(p: BoundaryPoint | number[]): { x: number; y: number; z: number } {
    if (Array.isArray(p)) {
        return { x: p[0], y: p[1], z: p[2] };
    }
    return { x: parseFloat(String(p.x)), y: parseFloat(String(p.y)), z: parseFloat(String(p.z)) };
}

/**
 * Validate and sanitize a boundary point
 * Handles both object {x,y,z} and array [x,y,z] formats
 * @returns THREE.Vector3 or null if invalid
 */
export function sanitizeBoundaryPoint(p: BoundaryPoint | number[]): THREE.Vector3 | null {
    const { x, y, z } = normalizePoint(p);
    if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
    return new THREE.Vector3(x, y, z);
}

// Reusable Vector3 pool to avoid allocations during tile building
const vec3Pool: THREE.Vector3[] = [];
let vec3PoolIndex = 0;

function getPooledVector3(x: number, y: number, z: number): THREE.Vector3 {
    if (vec3PoolIndex >= vec3Pool.length) {
        vec3Pool.push(new THREE.Vector3());
    }
    return vec3Pool[vec3PoolIndex++].set(x, y, z);
}

function resetVec3Pool(): void {
    vec3PoolIndex = 0;
    // Trim pool if it grew too large
    if (vec3Pool.length > 100) {
        vec3Pool.length = 100;
    }
}

/**
 * Validate tile boundary and return sanitized points
 * Uses pooled Vector3 objects - caller must copy values if needed beyond current frame
 * @returns Array of Vector3 or null if invalid
 */
export function validateTileBoundary(tile: HexTile): THREE.Vector3[] | null {
    if (!tile.boundary || tile.boundary.length < 3) return null;
    const points: THREE.Vector3[] = [];
    for (const p of tile.boundary) {
        const { x, y, z } = normalizePoint(p);
        if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
        points.push(getPooledVector3(x, y, z));
    }
    return points.length >= 3 ? points : null;
}

/**
 * Build indexed geometry from tiles using per-tile fan deduplication.
 * Each tile's boundary vertices are stored once; triangle fan indices reference them.
 * Reduces vertex count by ~50% compared to non-indexed triangle lists.
 */
function buildIndexedGeometry(
    tiles: HexTile[],
    tileColorIndices: Map<string, TileColorInfo>,
    habitableTileIds: (number | string)[],
    tileVertexRanges: Map<string, TileVertexRange>
): THREE.BufferGeometry {
    // Phase 1: Count totals for pre-allocation
    let totalVertices = 0;
    let totalTriangles = 0;
    for (const tile of tiles) {
        const bLen = tile.boundary?.length || 0;
        if (bLen >= 3) {
            totalVertices += bLen;           // each boundary point stored once per tile
            totalTriangles += bLen - 2;      // triangle fan: N-2 triangles
        }
    }

    // Phase 2: Allocate TypedArrays
    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);
    // Use Uint16Array when possible (< 65535 vertices), otherwise Uint32Array
    const useUint16 = totalVertices < 65535;
    const indices = useUint16
        ? new Uint16Array(totalTriangles * 3)
        : new Uint32Array(totalTriangles * 3);

    // Phase 3: Fill arrays
    let posIdx = 0;
    let colIdx = 0;
    let idxIdx = 0;
    let baseVertex = 0;

    for (const tile of tiles) {
        // Track habitable tiles (derived from terrainType + biome)
        if (isHabitable(tile.terrainType || 'unknown', tile.biome)) {
            habitableTileIds.push(tile.id);
        }

        const color = getBiomeColorCached(tile);
        const tileIdStr = String(tile.id);

        tileColorIndices.set(tileIdStr, {
            originalColor: color,
            currentColor: color,
            isHighlighted: false
        });

        const boundaryPoints = validateTileBoundary(tile);
        if (!boundaryPoints || boundaryPoints.length < 3) continue;

        const cr = color.r, cg = color.g, cb = color.b;
        const bLen = boundaryPoints.length;

        // Write each boundary vertex ONCE (fan dedup)
        for (let i = 0; i < bLen; i++) {
            const p = boundaryPoints[i];
            positions[posIdx++] = p.x;
            positions[posIdx++] = p.y;
            positions[posIdx++] = p.z;
            colors[colIdx++] = cr;
            colors[colIdx++] = cg;
            colors[colIdx++] = cb;
        }

        // Triangle fan indices referencing unique vertices
        for (let i = 1; i < bLen - 1; i++) {
            indices[idxIdx++] = baseVertex;         // fan center
            indices[idxIdx++] = baseVertex + i;
            indices[idxIdx++] = baseVertex + i + 1;
        }

        // Track tile-to-vertex mapping for view mode color updates
        tileVertexRanges.set(tileIdStr, {
            startIndex: baseVertex,
            count: bLen
        });

        baseVertex += bLen;
    }

    // Trim to actual size
    const trimmedPositions = positions.subarray(0, posIdx);
    const trimmedColors = colors.subarray(0, colIdx);
    const trimmedIndices = indices.subarray(0, idxIdx);

    // Build geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(trimmedPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(trimmedColors, 3));
    geometry.setIndex(new THREE.BufferAttribute(trimmedIndices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const uniqueVerts = posIdx / 3;
    const triCount = idxIdx / 3;
    console.log(`[Geometry] ${tiles.length} tiles → ${uniqueVerts} vertices, ${triCount} triangles (${useUint16 ? 'Uint16' : 'Uint32'} indices)`);

    return geometry;
}

/**
 * Build Three.js geometry from server-provided tile data
 */
export function buildTilesFromData(tileData: TileDataResponse): BuildTilesResult | null {
    if (!tileData || !Array.isArray(tileData.tiles)) {
        console.error('❌ Invalid tile data from server:', tileData);
        return null;
    }

    resetVec3Pool();

    const hexasphere: HexasphereData = { tiles: tileData.tiles };
    const habitableTileIds: (number | string)[] = [];
    const tileColorIndices = new Map<string, TileColorInfo>();
    const tileVertexRanges = new Map<string, TileVertexRange>();

    const geometry = buildIndexedGeometry(tileData.tiles, tileColorIndices, habitableTileIds, tileVertexRanges);

    return { hexasphere, habitableTileIds, tileColorIndices, geometry, tileVertexRanges };
}

/** Compact tile state from server */
export interface CompactTileState {
    t: string;        // terrainType
    b: string | null; // biome
    f: number;        // fertility
}

/** Interface for locally-generated Hexasphere tiles */
export interface LocalTile {
    id: number | null;
    boundary: Array<{ x: number; y: number; z: number }>;
    centerPoint: { x: number; y: number; z: number };
    terrainType: string;
    biome?: string;
    population?: number;
}

/** Interface for local Hexasphere */
export interface LocalHexasphere {
    radius: number;
    tiles: LocalTile[];
}

/**
 * Build Three.js geometry from locally-generated hexasphere + server tile state
 * This is faster than fetching full geometry from server
 */
export function buildTilesFromLocalHexasphere(
    hexasphere: LocalHexasphere,
    tileState: Record<string, CompactTileState>
): BuildTilesResult | null {
    if (!hexasphere || !Array.isArray(hexasphere.tiles)) {
        console.error('❌ Invalid local hexasphere:', hexasphere);
        return null;
    }

    resetVec3Pool();

    // Convert local tiles to HexTile format, merging server state
    const tiles: HexTile[] = hexasphere.tiles.map((localTile, idx) => {
        const tileId = localTile.id ?? idx;
        const state = tileState[String(tileId)];

        const terrainType = state?.t ?? localTile.terrainType ?? 'unknown';
        const biome = state?.b ?? localTile.biome ?? undefined;
        const fertility = state?.f ?? 0;

        return {
            id: tileId,
            boundary: localTile.boundary,
            centerPoint: localTile.centerPoint,
            terrainType,
            biome,
            fertility,
            population: localTile.population ?? 0
        };
    });

    const hexasphereData: HexasphereData = { tiles };
    const habitableTileIds: (number | string)[] = [];
    const tileColorIndices = new Map<string, TileColorInfo>();
    const tileVertexRanges = new Map<string, TileVertexRange>();

    const geometry = buildIndexedGeometry(tiles, tileColorIndices, habitableTileIds, tileVertexRanges);

    return { hexasphere: hexasphereData, habitableTileIds, tileColorIndices, geometry, tileVertexRanges };
}

/**
 * Create hexasphere mesh from geometry
 * Uses MeshPhongMaterial with vertex colors - responds to Three.js lights
 */
export function createHexasphereMesh(geometry: THREE.BufferGeometry, hexasphere: HexasphereData): THREE.Mesh {
    const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        shininess: 10
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { hexasphere };
    return mesh;
}

/**
 * Calculate tile properties (terrain type, lat/lon)
 */
export function calculateTileProperties(tile: HexTile): { terrainType: string; lat: number; lon: number } {
    let lat = 0, lon = 0;

    const cp = normalizePoint(tile.centerPoint);

    try {
        if (tile.centerPoint && typeof (tile.centerPoint as { getLatLon?: () => { lat: number; lon: number } }).getLatLon === 'function') {
            const latLonRad = (tile.centerPoint as { getLatLon: () => { lat: number; lon: number } }).getLatLon();
            lat = latLonRad.lat * 180 / Math.PI;
            lon = latLonRad.lon * 180 / Math.PI;
        } else {
            const r = Math.sqrt(cp.x * cp.x + cp.y * cp.y + cp.z * cp.z);
            lat = Math.asin(cp.y / r) * 180 / Math.PI;
            lon = Math.atan2(cp.z, cp.x) * 180 / Math.PI;
        }
    } catch (e: unknown) {
        console.warn('Could not get lat/lon for tile:', tile.id, e);
    }

    let terrainType;
    const y = cp.y;
    const isWater = y < -0.1;

    if (isWater) {
        terrainType = 'ocean';
    } else {
        const altitude = y + Math.random() * 0.2 - 0.1;
        if (altitude > 0.6) {
            terrainType = 'mountains';
        } else if (altitude > 0.2) {
            terrainType = 'hills';
        } else {
            terrainType = 'flats';
        }
    }

    return { terrainType, lat, lon };
}
