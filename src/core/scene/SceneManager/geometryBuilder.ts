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
 * Validate and sanitize a boundary point
 * @returns THREE.Vector3 or null if invalid
 */
export function sanitizeBoundaryPoint(p: BoundaryPoint): THREE.Vector3 | null {
    const x = parseFloat(String(p.x));
    const y = parseFloat(String(p.y));
    const z = parseFloat(String(p.z));
    if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
    return new THREE.Vector3(x, y, z);
}

/**
 * Validate tile boundary and return sanitized points
 * @returns Array of Vector3 or null if invalid
 */
export function validateTileBoundary(tile: HexTile): THREE.Vector3[] | null {
    if (!tile.boundary || tile.boundary.length < 3) return null;
    const points: THREE.Vector3[] = [];
    for (const p of tile.boundary) {
        const vec = sanitizeBoundaryPoint(p);
        if (!vec) return null; // Any invalid point invalidates the tile
        points.push(vec);
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
    const estimatedVertices = tileCount * 18 * 3;
    const vertices: number[] = new Array(estimatedVertices);
    const colors: number[] = new Array(estimatedVertices);
    const indices: number[] = new Array(estimatedVertices);
    
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
        
        tileColorIndices.set(String(tile.id), {
            start: tileColorStart,
            count: tileVertexCount,
            originalColor: color.clone(),
            currentColor: color.clone(),
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
    
    // Trim arrays to actual size
    vertices.length = arrayIndex;
    colors.length = colorIndex;
    indices.length = indexArrayIndex;
    
    // Create geometry
    const geometry = new THREE.BufferGeometry();
    createBufferGeometry(geometry, vertices, colors, indices);
    
    return { hexasphere, habitableTileIds, tileColorIndices, geometry };
}

/**
 * Create buffer geometry from vertex/color/index arrays
 */
export function createBufferGeometry(
    geometry: THREE.BufferGeometry,
    vertices: number[],
    colors: number[],
    indices: number[]
): void {
    // Validate vertices array for NaN values
    const hasNaN = vertices.some(v => isNaN(v));
    if (hasNaN) {
        console.error('❌ NaN values detected in vertices array');
        const cleanVertices = vertices.filter(v => !isNaN(v));
        if (cleanVertices.length % 3 !== 0) {
            console.error('❌ Invalid vertex count after NaN removal');
            return;
        }
    }

    try {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
    } catch (error: unknown) {
        console.error('❌ Error creating buffer geometry:', error);
    }
}

/**
 * Create hexasphere mesh from geometry
 */
export function createHexasphereMesh(geometry: THREE.BufferGeometry, hexasphere: HexasphereData): THREE.Mesh {
    const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.DoubleSide
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
    
    try {
        if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
            const latLonRad = tile.centerPoint.getLatLon();
            lat = latLonRad.lat * 180 / Math.PI;
            lon = latLonRad.lon * 180 / Math.PI;
        } else {
            const r = Math.sqrt(
                tile.centerPoint.x * tile.centerPoint.x +
                tile.centerPoint.y * tile.centerPoint.y +
                tile.centerPoint.z * tile.centerPoint.z
            );
            lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
            lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
        }
    } catch (e: unknown) {
        console.warn('Could not get lat/lon for tile:', tile.id, e);
    }
    
    // Generate terrain using new system
    let terrainType;
    const y = tile.centerPoint.y;
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
