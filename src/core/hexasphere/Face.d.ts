/**
 * Face class for hexasphere geometry
 */
import Point from './Point';
declare class Face {
    id: number;
    points: Point[];
    centroid?: Point;
    constructor(point1: Point, point2: Point, point3: Point, register?: boolean);
    getOtherPoints(point1: Point): Point[];
    findThirdPoint(point1: Point, point2: Point): Point | undefined;
    isAdjacentTo(face2: Face): boolean;
    getCentroid(clear?: boolean): Point;
}
export default Face;
//# sourceMappingURL=Face.d.ts.map