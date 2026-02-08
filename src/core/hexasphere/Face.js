"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/**
 * Face class for hexasphere geometry
 */
const Point_1 = tslib_1.__importDefault(require("./Point"));
let _faceCount = 0;
class Face {
    constructor(point1, point2, point3, register = true) {
        this.id = _faceCount++;
        this.points = [point1, point2, point3];
        if (register) {
            point1.registerFace(this);
            point2.registerFace(this);
            point3.registerFace(this);
        }
    }
    getOtherPoints(point1) {
        const other = [];
        for (let i = 0; i < this.points.length; i++) {
            if (this.points[i].toString() !== point1.toString()) {
                other.push(this.points[i]);
            }
        }
        return other;
    }
    findThirdPoint(point1, point2) {
        for (let i = 0; i < this.points.length; i++) {
            if (this.points[i].toString() !== point1.toString() &&
                this.points[i].toString() !== point2.toString()) {
                return this.points[i];
            }
        }
        return undefined;
    }
    isAdjacentTo(face2) {
        let count = 0;
        for (let i = 0; i < this.points.length; i++) {
            for (let j = 0; j < face2.points.length; j++) {
                if (this.points[i].toString() === face2.points[j].toString()) {
                    count++;
                }
            }
        }
        return count === 2;
    }
    getCentroid(clear) {
        if (this.centroid && !clear) {
            return this.centroid;
        }
        const x = (this.points[0].x + this.points[1].x + this.points[2].x) / 3;
        const y = (this.points[0].y + this.points[1].y + this.points[2].y) / 3;
        const z = (this.points[0].z + this.points[1].z + this.points[2].z) / 3;
        this.centroid = new Point_1.default(x, y, z);
        return this.centroid;
    }
}
exports.default = Face;
//# sourceMappingURL=Face.js.map