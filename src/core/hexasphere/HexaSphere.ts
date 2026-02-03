/**
 * hexaSphere.ts
 * A library for creating and manipulating geodesic spheres with hexagonal tiles
 */

import Tile from './Tile';
import Face from './Face';
import Point from './Point';

/**
 * Point lookup dictionary
 */
interface PointLookup {
    [key: string]: Point;
}

/**
 * Tile lookup dictionary
 */
interface TileLookup {
    [key: string]: Tile;
}

/**
 * Vertex index map for OBJ export
 */
interface VertexIndexMap {
    [key: string]: number;
}

/**
 * JSON representation of the hexasphere
 */
interface HexasphereJson {
    radius: number;
    tiles: ReturnType<Tile['toJson']>[];
}

/**
 * Hexasphere class - creates a geodesic sphere with hexagonal/pentagonal tiles
 */
class Hexasphere {
    public radius: number;
    public tiles: Tile[];
    public tileLookup: TileLookup;

    constructor(radius: number, numDivisions: number, hexSize: number) {
        this.radius = radius;
        this.tiles = [];
        this.tileLookup = {};

        const tao = 1.61803399;
        const corners: Point[] = [
            new Point(1000, tao * 1000, 0),
            new Point(-1000, tao * 1000, 0),
            new Point(1000, -tao * 1000, 0),
            new Point(-1000, -tao * 1000, 0),
            new Point(0, 1000, tao * 1000),
            new Point(0, -1000, tao * 1000),
            new Point(0, 1000, -tao * 1000),
            new Point(0, -1000, -tao * 1000),
            new Point(tao * 1000, 0, 1000),
            new Point(-tao * 1000, 0, 1000),
            new Point(tao * 1000, 0, -1000),
            new Point(-tao * 1000, 0, -1000)
        ];

        let points: PointLookup = {};

        for (let i = 0; i < corners.length; i++) {
            points[corners[i]!.toString()] = corners[i]!;
        }

        let faces: Face[] = [
            new Face(corners[0]!, corners[1]!, corners[4]!, false),
            new Face(corners[1]!, corners[9]!, corners[4]!, false),
            new Face(corners[4]!, corners[9]!, corners[5]!, false),
            new Face(corners[5]!, corners[9]!, corners[3]!, false),
            new Face(corners[2]!, corners[3]!, corners[7]!, false),
            new Face(corners[3]!, corners[2]!, corners[5]!, false),
            new Face(corners[7]!, corners[10]!, corners[2]!, false),
            new Face(corners[0]!, corners[8]!, corners[10]!, false),
            new Face(corners[0]!, corners[4]!, corners[8]!, false),
            new Face(corners[8]!, corners[2]!, corners[10]!, false),
            new Face(corners[8]!, corners[4]!, corners[5]!, false),
            new Face(corners[8]!, corners[5]!, corners[2]!, false),
            new Face(corners[1]!, corners[0]!, corners[6]!, false),
            new Face(corners[11]!, corners[1]!, corners[6]!, false),
            new Face(corners[3]!, corners[9]!, corners[11]!, false),
            new Face(corners[6]!, corners[10]!, corners[7]!, false),
            new Face(corners[3]!, corners[11]!, corners[7]!, false),
            new Face(corners[11]!, corners[6]!, corners[7]!, false),
            new Face(corners[6]!, corners[0]!, corners[10]!, false),
            new Face(corners[9]!, corners[1]!, corners[11]!, false)
        ];

        const getPointIfExists = (point: Point): Point => {
            const key = point.toString();
            if (points[key]) {
                return points[key]!;
            } else {
                points[key] = point;
                return point;
            }
        };

        let newFaces: Face[] = [];

        for (let f = 0; f < faces.length; f++) {
            const face = faces[f]!;
            let prev: Point[] | null = null;
            let bottom: Point[] = [face.points[0]!];
            const left: Point[] = face.points[0]!.subdivide(face.points[1]!, numDivisions, getPointIfExists);
            const right: Point[] = face.points[0]!.subdivide(face.points[2]!, numDivisions, getPointIfExists);
            for (let i = 1; i <= numDivisions; i++) {
                prev = bottom;
                bottom = left[i]!.subdivide(right[i]!, i, getPointIfExists);
                for (let j = 0; j < i; j++) {
                    let nf = new Face(prev[j]!, bottom[j]!, bottom[j + 1]!);
                    newFaces.push(nf);

                    if (j > 0) {
                        nf = new Face(prev[j - 1]!, prev[j]!, bottom[j]!);
                        newFaces.push(nf);
                    }
                }
            }
        }

        faces = newFaces;

        let newPoints: PointLookup = {};
        for (const p in points) {
            const np = points[p]!.project(radius);
            newPoints[np.toString()] = np;
        }

        points = newPoints;

        // create tiles and store in a lookup for references
        for (const p in points) {
            const newTile = new Tile(points[p]!, hexSize);
            this.tiles.push(newTile);
            this.tileLookup[newTile.toString()] = newTile;
        }

        // resolve neighbor references now that all have been created
        for (let t = 0; t < this.tiles.length; t++) {
            const tile = this.tiles[t]!;
            tile.neighbors = tile.neighborIds.map((item: string) => this.tileLookup[item]!);
        }

        // --- Server-side tile property initialization ---
        for (let idx = 0; idx < this.tiles.length; idx++) {
            const tile = this.tiles[idx]!;
            // Calculate lat/lon from centerPoint
            let lat = 0, lon = 0;
            try {
                const r = Math.sqrt(tile.centerPoint.x * tile.centerPoint.x + tile.centerPoint.y * tile.centerPoint.y + tile.centerPoint.z * tile.centerPoint.z);
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            } catch (_e: unknown) {
                // fallback: leave as 0
            }

            // Assign terrain type
            let terrainType: string;
            const x = tile.centerPoint.x;
            const y = tile.centerPoint.y;
            const z = tile.centerPoint.z;

            const noise1 = Math.sin(x * 0.01 + z * 0.01) * Math.cos(y * 0.01);
            const noise2 = Math.sin(x * 0.02 - z * 0.02) * Math.cos(y * 0.015);
            const noise3 = Math.sin(x * 0.005 + y * 0.005 + z * 0.005);

            // Use position-based deterministic noise instead of Math.random()
            // This ensures terrain is always consistent for the same tile position
            const positionNoise = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
            const deterministicNoise = (positionNoise - Math.floor(positionNoise)) * 0.3 - 0.15;

            const elevation = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2) + deterministicNoise;

            const continentNoise = Math.sin(x * 0.003) * Math.cos(z * 0.003) +
                Math.sin(y * 0.004) * 0.5;

            const waterThreshold = 0.0 + continentNoise * 0.2;
            const isWater = elevation < waterThreshold;

            if (isWater) {
                terrainType = 'ocean';
            } else {
                const landElevation = elevation - waterThreshold;

                if (landElevation > 0.3) {
                    terrainType = 'mountains';
                } else if (landElevation > 0.15) {
                    terrainType = 'hills';
                } else {
                    terrainType = 'flats';
                }
            }

            const Habitable = terrainType === 'flats' || terrainType === 'hills';
            const isWaterFinal = terrainType === 'ocean';

            tile.setProperties(idx, lat, lon, !isWaterFinal, terrainType, Habitable);
        }
    }

    /**
     * Convert hexasphere to JSON string representation
     */
    toJson(): string {
        const data: HexasphereJson = {
            radius: this.radius,
            tiles: this.tiles.map((tile) => tile.toJson())
        };
        return JSON.stringify(data);
    }

    /**
     * Convert hexasphere to OBJ format string for 3D export
     */
    toObj(): string {
        const objV: Point[] = [];
        const objF: number[][] = [];
        let objText = "# vertices \n";
        const vertexIndexMap: VertexIndexMap = {};

        for (let i = 0; i < this.tiles.length; i++) {
            const t = this.tiles[i]!;

            const F: number[] = [];
            for (let j = 0; j < t.boundary.length; j++) {
                const boundaryKey = t.boundary[j]!.toString();
                let index = vertexIndexMap[boundaryKey];
                if (index === undefined) {
                    objV.push(t.boundary[j]!);
                    index = objV.length;
                    vertexIndexMap[boundaryKey] = index;
                }
                F.push(index);
            }

            objF.push(F);
        }

        for (let i = 0; i < objV.length; i++) {
            objText += 'v ' + objV[i]!.x + ' ' + objV[i]!.y + ' ' + objV[i]!.z + '\n';
        }

        objText += '\n# faces\n';
        for (let i = 0; i < objF.length; i++) {
            const face = objF[i]!;
            let faceString = 'f';
            for (let j = 0; j < face.length; j++) {
                faceString = faceString + ' ' + face[j];
            }
            objText += faceString + '\n';
        }

        return objText;
    }
}

// Expose Hexasphere globally for browser access
if (typeof window !== 'undefined') {
    (window as Window & { Hexasphere?: typeof Hexasphere }).Hexasphere = Hexasphere;
}

export default Hexasphere;
