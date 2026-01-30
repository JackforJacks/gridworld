/**
 * Tile class for hexasphere geometry
 */
import Point from './Point';
import Face from './Face';

/**
 * Vector3D interface
 */
interface Vector3D {
    x: number;
    y: number;
    z: number;
}

/**
 * Calculate vector between two points
 */
function vector(p1: Vector3D, p2: Vector3D): Vector3D {
    return {
        x: p2.x - p1.x,
        y: p2.y - p1.y,
        z: p2.z - p1.z
    };
}

/**
 * Calculate surface normal for a triangle
 * Based on: https://www.khronos.org/opengl/wiki/Calculating_a_Surface_Normal
 */
function calculateSurfaceNormal(p1: Vector3D, p2: Vector3D, p3: Vector3D): Vector3D {
    const U = vector(p1, p2);
    const V = vector(p1, p3);

    return {
        x: U.y * V.z - U.z * V.y,
        y: U.z * V.x - U.x * V.z,
        z: U.x * V.y - U.y * V.x
    };
}

/**
 * Check if vector points away from origin
 */
function pointingAwayFromOrigin(p: Vector3D, v: Vector3D): boolean {
    return ((p.x * v.x) >= 0) && ((p.y * v.y) >= 0) && ((p.z * v.z) >= 0);
}

/**
 * Tile class
 */
class Tile {
    public centerPoint: Point;
    public faces: Face[];
    public population: number;
    public Habitable: boolean;
    public id: number | null;
    public latitude: number | null;
    public longitude: number | null;
    public isLand: boolean | null;
    public terrainType: string;
    public terrain?: string;
    public boundary: Point[];
    public neighborIds: string[];
    public neighbors: Tile[];

    constructor(centerPoint: Point, hexSize: number = 1) {
        hexSize = Math.max(0.01, Math.min(1.0, hexSize));

        this.centerPoint = centerPoint;
        this.faces = centerPoint.getOrderedFaces() as Face[];
        this.population = 0;
        this.Habitable = false;
        this.id = null;
        this.latitude = null;
        this.longitude = null;
        this.isLand = null;
        this.terrainType = "unknown";
        this.boundary = [];
        this.neighborIds = [];
        this.neighbors = [];

        const neighborHash: { [key: string]: number } = {};

        for (let f = 0; f < this.faces.length; f++) {
            const face = this.faces[f]!;
            // build boundary
            this.boundary.push(face.getCentroid().segment(this.centerPoint, hexSize));

            // get neighboring tiles
            const otherPoints = face.getOtherPoints(this.centerPoint);
            for (let o = 0; o < 2; o++) {
                neighborHash[otherPoints[o]!.toString()] = 1;
            }
        }

        this.neighborIds = Object.keys(neighborHash);

        // Fix face orientation
        if (this.boundary.length >= 4) {
            const normal = calculateSurfaceNormal(
                this.boundary[1]!,
                this.boundary[2]!,
                this.boundary[3]!
            );

            if (!pointingAwayFromOrigin(this.centerPoint, normal)) {
                this.boundary.reverse();
            }
        }
    }

    getLatLon(radius: number, boundaryNum?: number): { lat: number; lon: number } {
        let point: Point = this.centerPoint;
        if (typeof boundaryNum === "number" && boundaryNum < this.boundary.length) {
            point = this.boundary[boundaryNum]!;
        }
        const phi = Math.acos(point.y / radius);
        const theta = (Math.atan2(point.x, point.z) + Math.PI + Math.PI / 2) % (Math.PI * 2) - Math.PI;
        return {
            lat: 180 * phi / Math.PI - 90,
            lon: 180 * theta / Math.PI
        };
    }

    scaledBoundary(scale: number): Point[] {
        scale = Math.max(0, Math.min(1, scale));
        const ret: Point[] = [];
        for (let i = 0; i < this.boundary.length; i++) {
            ret.push(this.centerPoint.segment(this.boundary[i]!, 1 - scale));
        }
        return ret;
    }

    toJson(): { centerPoint: ReturnType<Point['toJson']>; boundary: ReturnType<Point['toJson']>[] } {
        return {
            centerPoint: this.centerPoint.toJson(),
            boundary: this.boundary.map(point => point.toJson())
        };
    }

    toString(): string {
        return this.centerPoint.toString();
    }

    setProperties(
        id: number,
        latitude: number,
        longitude: number,
        isLand: boolean,
        terrainType: string,
        Habitable: boolean
    ): void {
        this.id = id;
        this.latitude = latitude;
        this.longitude = longitude;
        this.isLand = isLand;
        this.terrainType = terrainType;
        this.Habitable = Habitable;
        this.terrain = terrainType;
    }

    getProperties(): {
        id: number | null;
        latitude: number | null;
        longitude: number | null;
        isLand: boolean | null;
        terrainType: string;
        Habitable: boolean;
        population: number;
    } {
        return {
            id: this.id,
            latitude: this.latitude,
            longitude: this.longitude,
            isLand: this.isLand,
            terrainType: this.terrainType,
            Habitable: this.Habitable,
            population: this.population
        };
    }
}

export default Tile;
