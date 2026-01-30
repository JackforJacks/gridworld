/**
 * Point class for hexasphere geometry
 */

interface Face {
    id: number;
    isAdjacentTo(other: Face): boolean;
}

class Point {
    public x: number;
    public y: number;
    public z: number;
    public faces: Face[];

    constructor(x?: number, y?: number, z?: number) {
        if (x !== undefined && y !== undefined && z !== undefined) {
            this.x = isNaN(x) ? 0 : parseFloat(parseFloat(String(x)).toFixed(3));
            this.y = isNaN(y) ? 0 : parseFloat(parseFloat(String(y)).toFixed(3));
            this.z = isNaN(z) ? 0 : parseFloat(parseFloat(String(z)).toFixed(3));
        } else {
            this.x = 0;
            this.y = 0;
            this.z = 0;
        }
        this.faces = [];
    }

    subdivide(point: Point, count: number, checkPoint: (p: Point) => Point): Point[] {
        const segments: Point[] = [];
        segments.push(this);

        for (let i = 1; i < count; i++) {
            let np = new Point(
                this.x * (1 - (i / count)) + point.x * (i / count),
                this.y * (1 - (i / count)) + point.y * (i / count),
                this.z * (1 - (i / count)) + point.z * (i / count)
            );
            np = checkPoint(np);
            segments.push(np);
        }

        segments.push(point);
        return segments;
    }

    segment(point: Point, percent: number): Point {
        percent = Math.max(0.01, Math.min(1, percent));

        const x = point.x * (1 - percent) + this.x * percent;
        const y = point.y * (1 - percent) + this.y * percent;
        const z = point.z * (1 - percent) + this.z * percent;

        return new Point(x, y, z);
    }

    midpoint(point: Point, _location?: number): Point {
        return this.segment(point, 0.5);
    }

    project(radius: number, percent: number = 1.0): this {
        percent = Math.max(0, Math.min(1, percent));

        const mag = Math.sqrt(Math.pow(this.x, 2) + Math.pow(this.y, 2) + Math.pow(this.z, 2));
        const ratio = radius / mag;

        this.x = this.x * ratio * percent;
        this.y = this.y * ratio * percent;
        this.z = this.z * ratio * percent;
        return this;
    }

    registerFace(face: Face): void {
        this.faces.push(face);
    }

    getOrderedFaces(): Face[] {
        const workingArray = this.faces.slice();
        const ret: Face[] = [];

        let i = 0;
        while (i < this.faces.length) {
            if (i === 0) {
                ret.push(workingArray[i]!);
                workingArray.splice(i, 1);
            } else {
                let hit = false;
                let j = 0;
                while (j < workingArray.length && !hit) {
                    if (workingArray[j]!.isAdjacentTo(ret[i - 1]!)) {
                        hit = true;
                        ret.push(workingArray[j]!);
                        workingArray.splice(j, 1);
                    }
                    j++;
                }
            }
            i++;
        }

        return ret;
    }

    findCommonFace(other: Point, notThisFace: Face): Face | null {
        for (let i = 0; i < this.faces.length; i++) {
            for (let j = 0; j < other.faces.length; j++) {
                if (this.faces[i]!.id === other.faces[j]!.id && this.faces[i]!.id !== notThisFace.id) {
                    return this.faces[i]!;
                }
            }
        }
        return null;
    }

    toJson(): { x: number; y: number; z: number } {
        return {
            x: this.x,
            y: this.y,
            z: this.z
        };
    }

    toString(): string {
        return `${this.x},${this.y},${this.z}`;
    }
}

export default Point;
