/**
 * hexaSphere.ts
 * A library for creating and manipulating geodesic spheres with hexagonal tiles
 */
import Tile from './Tile';
/**
 * Tile lookup dictionary
 */
interface TileLookup {
    [key: string]: Tile;
}
/**
 * Hexasphere class - creates a geodesic sphere with hexagonal/pentagonal tiles
 */
declare class Hexasphere {
    radius: number;
    tiles: Tile[];
    tileLookup: TileLookup;
    constructor(radius: number, numDivisions: number, hexSize: number);
    /**
     * Convert hexasphere to JSON string representation
     */
    toJson(): string;
    /**
     * Convert hexasphere to OBJ format string for 3D export
     */
    toObj(): string;
}
export default Hexasphere;
//# sourceMappingURL=HexaSphere.d.ts.map