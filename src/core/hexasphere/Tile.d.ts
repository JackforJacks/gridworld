/**
 * Tile class for hexasphere geometry
 */
import Point from './Point';
import Face from './Face';
/**
 * Tile class
 */
declare class Tile {
    centerPoint: Point;
    faces: Face[];
    population: number;
    id: number | null;
    latitude: number | null;
    longitude: number | null;
    terrainType: string;
    terrain?: string;
    boundary: Point[];
    neighborIds: string[];
    neighbors: Tile[];
    constructor(centerPoint: Point, hexSize?: number);
    getLatLon(radius: number, boundaryNum?: number): {
        lat: number;
        lon: number;
    };
    scaledBoundary(scale: number): Point[];
    toJson(): {
        centerPoint: ReturnType<Point['toJson']>;
        boundary: ReturnType<Point['toJson']>[];
    };
    toString(): string;
    setProperties(id: number, latitude: number, longitude: number, terrainType: string): void;
    getProperties(): {
        id: number | null;
        latitude: number | null;
        longitude: number | null;
        terrainType: string;
        population: number;
    };
}
export default Tile;
//# sourceMappingURL=Tile.d.ts.map