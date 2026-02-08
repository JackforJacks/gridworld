/**
 * Point class for hexasphere geometry
 */
interface Face {
    id: number;
    isAdjacentTo(other: Face): boolean;
}
declare class Point {
    x: number;
    y: number;
    z: number;
    faces: Face[];
    constructor(x?: number, y?: number, z?: number);
    subdivide(point: Point, count: number, checkPoint: (p: Point) => Point): Point[];
    segment(point: Point, percent: number): Point;
    midpoint(point: Point, _location?: number): Point;
    project(radius: number, percent?: number): this;
    registerFace(face: Face): void;
    getOrderedFaces(): Face[];
    findCommonFace(other: Point, notThisFace: Face): Face | null;
    toJson(): {
        x: number;
        y: number;
        z: number;
    };
    toString(): string;
}
export default Point;
//# sourceMappingURL=Point.d.ts.map