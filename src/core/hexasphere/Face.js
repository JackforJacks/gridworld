import Point from './point.js';

let _faceCount = 0;

const Face = function (point1, point2, point3, register) {
    this.id = _faceCount++;

    if (register == undefined) {
        register = true;
    }

    this.points = [
        point1,
        point2,
        point3
    ];
    if (register) {
        point1.registerFace(this);
        point2.registerFace(this);
        point3.registerFace(this);
    }
};

Face.prototype.getOtherPoints = function (point1) {
    const other = [];
    for (let i = 0; i < this.points.length; i++) {
        if (this.points[i].toString() !== point1.toString()) {
            other.push(this.points[i]);
        }
    }
    return other;
}

Face.prototype.findThirdPoint = function (point1, point2) {
    for (let i = 0; i < this.points.length; i++) {
        if (this.points[i].toString() !== point1.toString() && this.points[i].toString() !== point2.toString()) {
            return this.points[i];
        }
    }
}

Face.prototype.isAdjacentTo = function (face2) {
    // adjacent if 2 of the points are the same

    let count = 0;
    for (let i = 0; i < this.points.length; i++) {
        for (let j = 0; j < face2.points.length; j++) {
            if (this.points[i].toString() == face2.points[j].toString()) {
                count++;

            }
        }
    }

    return (count == 2);
}

Face.prototype.getCentroid = function (clear) {
    if (this.centroid && !clear) {
        return this.centroid;
    }

    const x = (this.points[0].x + this.points[1].x + this.points[2].x) / 3;
    const y = (this.points[0].y + this.points[1].y + this.points[2].y) / 3;
    const z = (this.points[0].z + this.points[1].z + this.points[2].z) / 3;

    const centroid = new Point(x, y, z);

    this.centroid = centroid;

    return centroid;

}

export default Face;
