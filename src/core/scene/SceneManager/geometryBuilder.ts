// Scene Manager - Geometry Builder
// Handles tile geometry creation and validation
import * as THREE from 'three';
import { BoundaryPoint, HexTile, TileColorInfo, TileDataResponse, HexasphereData } from './types';
import { getBiomeColorCached } from './colorUtils';

/** Result from building tiles */
export interface BuildTilesResult {
    hexasphere: HexasphereData;
    habitableTileIds: (number | string)[];
    tileColorIndices: Map<string, TileColorInfo>;
    geometry: THREE.BufferGeometry;
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
 * Build Three.js geometry from server-provided tile data
 * OPTIMIZED: Pre-allocated arrays, cached colors, deduplicated validation
 */
export function buildTilesFromData(tileData: TileDataResponse): BuildTilesResult | null {
    if (!tileData || !Array.isArray(tileData.tiles)) {
        console.error('❌ Invalid tile data from server:', tileData);
        return null;
    }

    const hexasphere: HexasphereData = { tiles: tileData.tiles };
    const habitableTileIds: (number | string)[] = [];
    const tileColorIndices = new Map<string, TileColorInfo>();

    const tiles = tileData.tiles;
    const tileCount = tiles.length;

    // Estimate array sizes: avg 6 vertices per tile, 3 triangles, 3 vertices each = ~18 vertices
    // Using TypedArrays directly for better performance
    const estimatedVertices = tileCount * 18 * 3;
    const vertices = new Float32Array(estimatedVertices);
    const colors = new Float32Array(estimatedVertices);
    const indices = new Uint32Array(estimatedVertices);

    let vertexIndex = 0;
    let colorIndex = 0;
    let arrayIndex = 0;
    let indexArrayIndex = 0;

    // Build geometry from each tile using optimized loop
    for (let tileIdx = 0; tileIdx < tileCount; tileIdx++) {
        const tile = tiles[tileIdx];

        // Track habitable tiles
        if (tile.Habitable === 'yes') {
            habitableTileIds.push(tile.id);
        }

        // Use cached color lookup
        const color = getBiomeColorCached(tile);
        const tileColorStart = colorIndex;
        const boundaryLen = tile.boundary?.length || 0;
        const tileVertexCount = (boundaryLen - 2) * 3 * 3;
        const tileIdStr = String(tile.id);

        // Defer color cloning - store reference, clone only when needed
        tileColorIndices.set(tileIdStr, {
            start: tileColorStart,
            count: tileVertexCount,
            originalColor: color, // Reference, not clone (colors are shared/cached)
            currentColor: color,  // Reference initially, clone only on modification
            isHighlighted: false
        });

        // Validate and get boundary points
        const boundaryPoints = validateTileBoundary(tile);

        // Skip tiles with invalid boundary data
        if (!boundaryPoints || boundaryPoints.length < 3) {
            continue;
        }

        // Cache first point and color components for inner loop
        const p0 = boundaryPoints[0];
        const p0x = p0.x, p0y = p0.y, p0z = p0.z;
        const cr = color.r, cg = color.g, cb = color.b;
        const bLen = boundaryPoints.length;

        // Optimized triangle fan loop
        for (let i = 1; i < bLen - 1; i++) {
            const p1 = boundaryPoints[i];
            const p2 = boundaryPoints[i + 1];

            // Direct array assignment instead of push
            vertices[arrayIndex++] = p0x;
            vertices[arrayIndex++] = p0y;
            vertices[arrayIndex++] = p0z;
            vertices[arrayIndex++] = p1.x;
            vertices[arrayIndex++] = p1.y;
            vertices[arrayIndex++] = p1.z;
            vertices[arrayIndex++] = p2.x;
            vertices[arrayIndex++] = p2.y;
            vertices[arrayIndex++] = p2.z;

            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;
            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;
            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;

            indices[indexArrayIndex++] = vertexIndex;
            indices[indexArrayIndex++] = vertexIndex + 1;
            indices[indexArrayIndex++] = vertexIndex + 2;
            vertexIndex += 3;
        }
    }

    // Trim TypedArrays to actual size using subarray (creates views, no copy)
    const trimmedVertices = vertices.subarray(0, arrayIndex);
    const trimmedColors = colors.subarray(0, colorIndex);
    const trimmedIndices = indices.subarray(0, indexArrayIndex);

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    createBufferGeometry(geometry, trimmedVertices, trimmedColors, trimmedIndices);

    return { hexasphere, habitableTileIds, tileColorIndices, geometry };
}

/** Compact tile state from server */
export interface CompactTileState {
    t: string;      // terrainType
    l: boolean;     // isLand
    b: string | null; // biome
    h: boolean;     // Habitable
}

/** Interface for locally-generated Hexasphere tiles */
export interface LocalTile {
    id: number | null;
    boundary: Array<{ x: number; y: number; z: number }>;
    centerPoint: { x: number; y: number; z: number };
    terrainType: string;
    isLand: boolean | null;
    Habitable: boolean;
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

    // Reset vector pool for this build operation
    resetVec3Pool();

    // Convert local tiles to HexTile format, merging server state
    const tiles: HexTile[] = hexasphere.tiles.map((localTile, idx) => {
        const tileId = localTile.id ?? idx;
        const state = tileState[String(tileId)];

        // Merge server state with local geometry
        return {
            id: tileId,
            boundary: localTile.boundary,
            centerPoint: localTile.centerPoint,
            terrainType: state?.t ?? localTile.terrainType ?? 'unknown',
            isLand: state?.l ?? localTile.isLand ?? false,
            biome: state?.b ?? localTile.biome ?? undefined,
            Habitable: state?.h ? 'yes' : (localTile.Habitable ? 'yes' : 'no'),
            population: localTile.population ?? 0
        };
    });

    const hexasphereData: HexasphereData = { tiles };
    const habitableTileIds: (number | string)[] = [];
    const tileColorIndices = new Map<string, TileColorInfo>();

    const tileCount = tiles.length;

    // Estimate array sizes: avg 6 boundary points per tile = 4 triangles = 12 vertices = 36 floats
    // Using TypedArrays directly for better performance
    const estimatedVertices = tileCount * 18 * 3;
    const vertices = new Float32Array(estimatedVertices);
    const colors = new Float32Array(estimatedVertices);
    const indices = new Uint32Array(estimatedVertices);

    let vertexIndex = 0;
    let colorIndex = 0;
    let arrayIndex = 0;
    let indexArrayIndex = 0;

    for (let tileIdx = 0; tileIdx < tileCount; tileIdx++) {
        const tile = tiles[tileIdx];

        if (tile.Habitable === 'yes') {
            habitableTileIds.push(tile.id);
        }

        const color = getBiomeColorCached(tile);
        const tileColorStart = colorIndex;
        const boundaryLen = tile.boundary?.length || 0;
        const tileVertexCount = (boundaryLen - 2) * 3 * 3;
        const tileIdStr = String(tile.id);

        // Defer color cloning - store reference, clone only when needed
        tileColorIndices.set(tileIdStr, {
            start: tileColorStart,
            count: tileVertexCount,
            originalColor: color, // Reference, not clone (colors are shared/cached)
            currentColor: color,  // Reference initially, clone only on modification
            isHighlighted: false
        });

        const boundaryPoints = validateTileBoundary(tile);
        if (!boundaryPoints || boundaryPoints.length < 3) {
            continue;
        }

        const p0 = boundaryPoints[0];
        const p0x = p0.x, p0y = p0.y, p0z = p0.z;
        const cr = color.r, cg = color.g, cb = color.b;
        const bLen = boundaryPoints.length;

        for (let i = 1; i < bLen - 1; i++) {
            const p1 = boundaryPoints[i];
            const p2 = boundaryPoints[i + 1];

            vertices[arrayIndex++] = p0x;
            vertices[arrayIndex++] = p0y;
            vertices[arrayIndex++] = p0z;
            vertices[arrayIndex++] = p1.x;
            vertices[arrayIndex++] = p1.y;
            vertices[arrayIndex++] = p1.z;
            vertices[arrayIndex++] = p2.x;
            vertices[arrayIndex++] = p2.y;
            vertices[arrayIndex++] = p2.z;

            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;
            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;
            colors[colorIndex++] = cr;
            colors[colorIndex++] = cg;
            colors[colorIndex++] = cb;

            indices[indexArrayIndex++] = vertexIndex;
            indices[indexArrayIndex++] = vertexIndex + 1;
            indices[indexArrayIndex++] = vertexIndex + 2;
            vertexIndex += 3;
        }
    }

    // Trim TypedArrays to actual size using subarray (creates views, no copy)
    const trimmedVertices = vertices.subarray(0, arrayIndex);
    const trimmedColors = colors.subarray(0, colorIndex);
    const trimmedIndices = indices.subarray(0, indexArrayIndex);

    const geometry = new THREE.BufferGeometry();
    createBufferGeometry(geometry, trimmedVertices, trimmedColors, trimmedIndices);

    return { hexasphere: hexasphereData, habitableTileIds, tileColorIndices, geometry };
}

/**
 * Create buffer geometry from vertex/color/index arrays
 * Accepts both regular arrays and TypedArrays
 */
export function createBufferGeometry(
    geometry: THREE.BufferGeometry,
    vertices: number[] | Float32Array,
    colors: number[] | Float32Array,
    indices: number[] | Uint32Array
): void {
    try {
        // Use BufferAttribute directly for TypedArrays (faster)
        if (vertices instanceof Float32Array) {
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        } else {
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        }

        if (colors instanceof Float32Array) {
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        } else {
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        }

        if (indices instanceof Uint32Array) {
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        } else {
            geometry.setIndex(indices);
        }

        geometry.computeVertexNormals();
    } catch (error: unknown) {
        console.error('❌ Error creating buffer geometry:', error);
    }
}

/**
 * Create hexasphere mesh from geometry
 * Uses MeshPhongMaterial with vertex colors - responds to Three.js lights
 */
export function createHexasphereMesh(geometry: THREE.BufferGeometry, hexasphere: HexasphereData): THREE.Mesh {
    // Use standard Phong material with vertex colors - works with Three.js lighting system
    const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        shininess: 10  // Low shininess for matte planet look
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

    // Normalize centerPoint to {x, y, z} format
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

    // Generate terrain using new system
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
