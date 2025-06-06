/**
 * hexaSphere.js
 * A library for creating and manipulating geodesic spheres with hexagonal tiles
 */

// Import dependencies
import Tile from './Tile.js';
import Face from './Face.js';
import Point from './point.js';

const Hexasphere = function (radius, numDivisions, hexSize) {

    this.radius = radius;
    const tao = 1.61803399;
    const corners = [
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

    let points = {};

    for (let i = 0; i < corners.length; i++) {
        points[corners[i]] = corners[i];
    }

    let faces = [
        new Face(corners[0], corners[1], corners[4], false),
        new Face(corners[1], corners[9], corners[4], false),
        new Face(corners[4], corners[9], corners[5], false),
        new Face(corners[5], corners[9], corners[3], false),
        new Face(corners[2], corners[3], corners[7], false),
        new Face(corners[3], corners[2], corners[5], false),
        new Face(corners[7], corners[10], corners[2], false),
        new Face(corners[0], corners[8], corners[10], false),
        new Face(corners[0], corners[4], corners[8], false),
        new Face(corners[8], corners[2], corners[10], false),
        new Face(corners[8], corners[4], corners[5], false),
        new Face(corners[8], corners[5], corners[2], false),
        new Face(corners[1], corners[0], corners[6], false),
        new Face(corners[11], corners[1], corners[6], false),
        new Face(corners[3], corners[9], corners[11], false),
        new Face(corners[6], corners[10], corners[7], false),
        new Face(corners[3], corners[11], corners[7], false),
        new Face(corners[11], corners[6], corners[7], false),
        new Face(corners[6], corners[0], corners[10], false),
        new Face(corners[9], corners[1], corners[11], false)
    ];

    const getPointIfExists = function (point) {
        if (points[point]) {
            // console.log("EXISTING!");
            return points[point];
        } else {
            // console.log("NOT EXISTING!");
            points[point] = point;
            return point;
        }
    };


    let newFaces = [];

    for (let f = 0; f < faces.length; f++) {
        // console.log("-0---");
        let prev = null;
        let bottom = [faces[f].points[0]];
        const left = faces[f].points[0].subdivide(faces[f].points[1], numDivisions, getPointIfExists);
        const right = faces[f].points[0].subdivide(faces[f].points[2], numDivisions, getPointIfExists);
        for (let i = 1; i <= numDivisions; i++) {
            prev = bottom;
            bottom = left[i].subdivide(right[i], i, getPointIfExists);
            for (let j = 0; j < i; j++) {
                let nf = new Face(prev[j], bottom[j], bottom[j + 1]);
                newFaces.push(nf);

                if (j > 0) {
                    nf = new Face(prev[j - 1], prev[j], bottom[j]);
                    newFaces.push(nf);
                }
            }
        }
    }

    faces = newFaces;

    let newPoints = {};
    for (let p in points) {
        const np = points[p].project(radius);
        newPoints[np] = np;
    }

    points = newPoints;

    this.tiles = [];
    this.tileLookup = {};

    // create tiles and store in a lookup for references
    for (let p in points) {
        const newTile = new Tile(points[p], hexSize);
        this.tiles.push(newTile);
        this.tileLookup[newTile.toString()] = newTile;
    }

    // resolve neighbor references now that all have been created
    for (let t in this.tiles) {
        const _this = this;
        this.tiles[t].neighbors = this.tiles[t].neighborIds.map(function (item) { return _this.tileLookup[item] });
    }

    // --- Server-side tile property initialization ---
    // Mimic client logic: assign id, lat, lon, isLand, terrainType, Habitable
    for (let idx = 0; idx < this.tiles.length; idx++) {
        const tile = this.tiles[idx];
        // Calculate lat/lon from centerPoint
        let lat = 0, lon = 0;
        try {
            const r = Math.sqrt(tile.centerPoint.x * tile.centerPoint.x + tile.centerPoint.y * tile.centerPoint.y + tile.centerPoint.z * tile.centerPoint.z);
            lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
            lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
        } catch (e) {
            // fallback: leave as 0
        }

        // Assign terrain type using new system: ocean, flats, hills, mountains
        let terrainType;
        const x = tile.centerPoint.x;
        const y = tile.centerPoint.y;
        const z = tile.centerPoint.z;
        const absLat = Math.abs(lat);

        // Check if this is a pentagon tile (5 boundary points instead of 6)
        // const isPentagon = tile.boundary.length === 5;

        // Pentagon constraint: all pentagons must be mountains
        // if (isPentagon) {
        //     terrainType = 'mountains';
        // } else {
        // Regular terrain generation for all tiles
        const noise1 = Math.sin(x * 0.01 + z * 0.01) * Math.cos(y * 0.01);
        const noise2 = Math.sin(x * 0.02 - z * 0.02) * Math.cos(y * 0.015);
        const noise3 = Math.sin(x * 0.005 + y * 0.005 + z * 0.005);

        // Combine noise functions to create elevation
        const elevation = (noise1 * 0.5 + noise2 * 0.3 + noise3 * 0.2) +
            Math.random() * 0.3 - 0.15; // Add some randomness

        // Create continent-like patterns using larger-scale noise
        const continentNoise = Math.sin(x * 0.003) * Math.cos(z * 0.003) +
            Math.sin(y * 0.004) * 0.5;

        // Determine if it's water or land
        // Use elevation combined with continent patterns for realistic distribution
        // Adjusted to ensure at least 60% ocean coverage
        const waterThreshold = 0.0 + continentNoise * 0.2;
        const isWater = elevation < waterThreshold;

        if (isWater) {
            terrainType = 'ocean';
        } else {
            // Land types based on elevation above water level
            const landElevation = elevation - waterThreshold;

            if (landElevation > 0.3) {
                terrainType = 'mountains';
            } else if (landElevation > 0.15) {
                terrainType = 'hills';
            } else {
                terrainType = 'flats';
            }
        }

        // Determine if tile is Habitable
        // Only flats and hills are habitable
        const Habitable = (terrainType === 'flats' || terrainType === 'hills') ? 'yes' : 'no';

        // Determine if it's water or land based on terrain type
        const isWaterFinal = (terrainType === 'ocean');

        // Set all properties directly on the tile object
        tile.setProperties(idx, lat, lon, !isWaterFinal, terrainType, Habitable);
    }
};

Hexasphere.prototype.toJson = function () {

    return JSON.stringify({
        radius: this.radius,
        tiles: this.tiles.map(function (tile) { return tile.toJson() })
    });
}

Hexasphere.prototype.toObj = function () {

    let objV = [];
    let objF = [];
    let objText = "# vertices \n";
    let vertexIndexMap = {};

    for (let i = 0; i < this.tiles.length; i++) {
        const t = this.tiles[i];

        const F = []
        for (let j = 0; j < t.boundary.length; j++) {
            let index = vertexIndexMap[t.boundary[j]];
            if (index == undefined) {
                objV.push(t.boundary[j]);
                index = objV.length;
                vertexIndexMap[t.boundary[j]] = index;
            }
            F.push(index)
        }

        objF.push(F);
    }

    for (let i = 0; i < objV.length; i++) {
        objText += 'v ' + objV[i].x + ' ' + objV[i].y + ' ' + objV[i].z + '\n';
    }

    objText += '\n# faces\n';
    for (let i = 0; i < objF.length; i++) {
        let faceString = 'f';
        for (let j = 0; j < objF[i].length; j++) {
            faceString = faceString + ' ' + objF[i][j];
        }
        objText += faceString + '\n';
    }

    return objText;
}

// Expose Hexasphere globally for browser access if in a browser environment
if (typeof window !== 'undefined') {
    window.Hexasphere = Hexasphere;
}

// Export for CommonJS environments
export default Hexasphere;

// Export for ES modules
if (typeof exports !== 'undefined') {
    exports.default = Hexasphere;
}
