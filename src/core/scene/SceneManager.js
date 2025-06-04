// Scene Manager Module
// Handles scene creation, tile generation, and rendering
import { terrainColors, isLand } from '../../utils/index.js';
import Hexasphere from '../hexasphere/HexaSphere.js';
import populationManager from '../../managers/population/PopulationManager.js';

class SceneManager {
    constructor() {
        this.scene = null;
        this.renderer = null;
        this.hexasphere = null;
        this.currentTiles = [];
        this.cameraLight = null;
        this.ambientLight = null;
        this.directionalLight = null;
        this.populationUnsubscribe = null;
        this.tileColorIndices = new Map();
        this.hexasphereMesh = null;
        this.habitableTileIds = [];
        this.sphereRadius = 30; // Store the current sphere radius for border calculations
    }

    initialize(width, height) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);
        this.scene = new THREE.Scene();
        this.populationUnsubscribe = populationManager.subscribe((eventType, data) => {
            if (eventType === 'populationUpdate') {
                this.updateTilePopulations();
                this.checkPopulationThresholds();
            }
        });
        return { scene: this.scene, renderer: this.renderer };
    } async createHexasphere(radius = null, subdivisions = null, tileWidthRatio = null) {
        this.clearTiles();

        // If no parameters provided, fetch defaults from server config
        if (radius === null || subdivisions === null || tileWidthRatio === null) {
            try {
                const configResponse = await fetch('/api/config');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    radius = radius ?? config.hexasphere.radius;
                    subdivisions = subdivisions ?? config.hexasphere.subdivisions;
                    tileWidthRatio = tileWidthRatio ?? config.hexasphere.tileWidthRatio;
                }
            } catch (error) {
                console.warn('Failed to fetch config from server, using fallback defaults:', error);
                // Fallback to hardcoded defaults if server config is unavailable
                radius = radius ?? 30;
                subdivisions = subdivisions ?? 3;
                tileWidthRatio = tileWidthRatio ?? 1;
            }
        }

        // Instead of generating tiles locally, fetch from server
        await this.fetchAndBuildTiles(radius, subdivisions, tileWidthRatio);
    }    // Fetch tile data from the server and build geometry
    async fetchAndBuildTiles(radius, subdivisions, tileWidthRatio) {
        try {
            // Store the radius for use in border calculations
            this.sphereRadius = radius;

            // Fetch tile data from the server
            const response = await fetch(`/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}`);
            if (!response.ok) throw new Error(`Failed to fetch tiles: ${response.status}`);
            const tileData = await response.json();
            this.buildTilesFromData(tileData);
        } catch (error) {
            console.error('❌ Error fetching tile data from server:', error);
        }
    }

    // Build Three.js geometry from server-provided tile data
    buildTilesFromData(tileData) {
        console.log('[SceneManager] buildTilesFromData received:', tileData);
        // tileData is expected to be an array of tile objects with all necessary properties
        if (!tileData || !Array.isArray(tileData.tiles)) {
            console.error('❌ Invalid tile data from server:', tileData);
            return;
        }
        // Set up a pseudo-hexasphere object to keep compatibility with rest of code
        this.hexasphere = { tiles: tileData.tiles };
        window.hexasphere = this.hexasphere;
        this.habitableTileIds = [];
        this.tileColorIndices.clear();
        const hexasphereGeometry = new THREE.BufferGeometry();
        const vertices = [], colors = [], indices = [];
        let vertexIndex = 0, colorIndex = 0;
        // Build geometry from each tile
        this.hexasphere.tiles.forEach((tile, idx) => {
            // Use tile properties from server
            if (tile.Habitable === 'yes') this.habitableTileIds.push(tile.id);
            const color = this.getTerrainColor(tile.terrainType);
            const tileColorStart = colorIndex;
            const tileVertexCount = (tile.boundary.length - 2) * 3 * 3;
            this.tileColorIndices.set(tile.id, {
                start: tileColorStart,
                count: tileVertexCount,
                originalColor: color.clone(),
                currentColor: color.clone(),
                isHighlighted: false
            });
            // Build geometry (fan triangulation)
            const boundaryPoints = tile.boundary.map(p => new THREE.Vector3(p.x, p.y, p.z));
            for (let i = 1; i < boundaryPoints.length - 1; i++) {
                vertices.push(boundaryPoints[0].x, boundaryPoints[0].y, boundaryPoints[0].z);
                vertices.push(boundaryPoints[i].x, boundaryPoints[i].y, boundaryPoints[i].z);
                vertices.push(boundaryPoints[i + 1].x, boundaryPoints[i + 1].y, boundaryPoints[i + 1].z);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                vertexIndex += 3;
            }
            colorIndex += tileVertexCount;
        });
        this.createHexasphereMesh(hexasphereGeometry, vertices, colors, indices);
        this.initializeTilePopulations(this.habitableTileIds);
    }

    async initializeTilePopulations(habitableTileIds) {
        try {
            await populationManager.initializeTilePopulations(habitableTileIds);
            this.updateTilePopulations();
        } catch (error) {
            console.error('❌ Failed to initialize tile populations:', error);
        }
    }

    updateTilePopulations() {
        if (!this.hexasphere || !this.hexasphere.tiles) return;
        const tilePopulations = populationManager.getAllTilePopulations();
        this.hexasphere.tiles.forEach(tile => {
            tile.population = tile.Habitable === 'yes' ? (tilePopulations[tile.id] || 0) : 0;
        });
    }

    checkPopulationThresholds() {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) return;
        const POPULATION_THRESHOLD = 10000;
        const redColor = new THREE.Color(0xff0000);
        let changesDetected = false;
        this.hexasphere.tiles.forEach(tile => {
            if (tile.Habitable === 'yes' && tile.population !== undefined) {
                const colorInfo = this.tileColorIndices.get(tile.id);
                if (!colorInfo) return;
                const shouldBeRed = tile.population >= POPULATION_THRESHOLD;
                if (shouldBeRed && !colorInfo.isHighlighted) {
                    this.updateTileColor(tile.id, redColor);
                    colorInfo.isHighlighted = true;
                    colorInfo.currentColor = redColor.clone();
                    changesDetected = true;
                } else if (!shouldBeRed && colorInfo.isHighlighted) {
                    this.updateTileColor(tile.id, colorInfo.originalColor);
                    colorInfo.isHighlighted = false;
                    colorInfo.currentColor = colorInfo.originalColor.clone();
                    changesDetected = true;
                }
            }
        });
    }

    updateTileColor(tileId, newColor) {
        if (!this.hexasphereMesh || !this.hexasphereMesh.geometry) return;
        const colorInfo = this.tileColorIndices.get(tileId);
        if (!colorInfo) return;
        const colorAttribute = this.hexasphereMesh.geometry.getAttribute('color');
        if (!colorAttribute) return;
        for (let i = colorInfo.start; i < colorInfo.start + colorInfo.count; i += 3) {
            colorAttribute.setXYZ(i / 3, newColor.r, newColor.g, newColor.b);
        }
        colorAttribute.needsUpdate = true;
    }

    resetTileColors() {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) return;
        this.hexasphere.tiles.forEach(tile => {
            const colorInfo = this.tileColorIndices.get(tile.id);
            if (colorInfo && colorInfo.isHighlighted) {
                this.updateTileColor(tile.id, colorInfo.originalColor);
                colorInfo.isHighlighted = false;
                colorInfo.currentColor = colorInfo.originalColor.clone();
            }
        });
    }

    async reinitializePopulation() {
        if (!this.habitableTileIds || this.habitableTileIds.length === 0) return;
        try {
            await this.initializeTilePopulations(this.habitableTileIds);
            this.checkPopulationThresholds();
        } catch (error) {
            console.error('❌ Failed to reinitialize population:', error);
        }
    }

    calculateTileProperties(tile) {
        let lat = 0, lon = 0;
        try {
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLonRad = tile.centerPoint.getLatLon();
                lat = latLonRad.lat * 180 / Math.PI;
                lon = latLonRad.lon * 180 / Math.PI;
            } else {
                const r = Math.sqrt(
                    tile.centerPoint.x * tile.centerPoint.x +
                    tile.centerPoint.y * tile.centerPoint.y +
                    tile.centerPoint.z * tile.centerPoint.z
                );
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e) {
            console.warn('Could not get lat/lon for tile:', tile.id, e);
        }        // Generate terrain using new system: ocean, flats, hills, mountains
        let terrainType;
        const y = tile.centerPoint.y;
        const absLat = Math.abs(lat);

        // Determine if it's water or land first
        const isWater = y < -0.1; // Lower threshold for water

        if (isWater) {
            terrainType = 'ocean';
        } else {
            // Land types based on altitude (y coordinate) and latitude
            const altitude = y + Math.random() * 0.2 - 0.1; // Add some noise

            if (altitude > 0.6) {
                terrainType = 'mountains';
            } else if (altitude > 0.2) {
                terrainType = 'hills';
            } else {
                terrainType = 'flats';
            }
        }

        return { terrainType, lat, lon };
    } getTerrainColor(terrainType) {
        return new THREE.Color(terrainColors[terrainType] || 0x808080); // Default to gray if unknown
    }

    addTileGeometry(tile, color, vertices, colors, indices, startVertexIndex) {
        const boundaryPoints = tile.boundary.map(p => new THREE.Vector3(p.x, p.y, p.z));
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            vertices.push(boundaryPoints[0].x, boundaryPoints[0].y, boundaryPoints[0].z);
            vertices.push(boundaryPoints[i].x, boundaryPoints[i].y, boundaryPoints[i].z);
            vertices.push(boundaryPoints[i + 1].x, boundaryPoints[i + 1].y, boundaryPoints[i + 1].z);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            indices.push(startVertexIndex, startVertexIndex + 1, startVertexIndex + 2);
            startVertexIndex += 3;
        }
    }

    createHexasphereMesh(geometry, vertices, colors, indices) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });
        const hexasphereMesh = new THREE.Mesh(geometry, material);
        this.hexasphereMesh = hexasphereMesh;
        hexasphereMesh.userData = { hexasphere: this.hexasphere };
        this.currentTiles.push(hexasphereMesh);
        this.scene.add(hexasphereMesh);
        window.currentTiles = this.currentTiles;
    }

    clearTiles() {
        if (this.currentTiles && this.currentTiles.length > 0) {
            this.currentTiles.forEach(tileMesh => this.scene.remove(tileMesh));
            this.currentTiles.length = 0;
        }
        this.tileColorIndices.clear();
        this.hexasphereMesh = null;
    }

    addLighting(camera, sphereRadius = 30) {
        if (this.cameraLight) {
            if (this.cameraLight.parent) this.cameraLight.parent.remove(this.cameraLight);
            this.cameraLight = null;
        }
        if (!this.ambientLight) {
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
            this.scene.add(this.ambientLight);
        }
        if (!this.directionalLight) {
            this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
            this.directionalLight.position.set(10, 20, 10);
            this.scene.add(this.directionalLight);
        }
        const lightRadius = sphereRadius * 0.8;
        this.cameraLight = new THREE.PointLight(0xffffff, 1.0, lightRadius);
        this.cameraLight.position.set(0, 0, 0);
        camera.add(this.cameraLight);
        if (!this.scene.children.includes(camera)) this.scene.add(camera);
    }

    updateCameraLight(camera) { }
    render(camera) { this.renderer.render(this.scene, camera); }
    getScene() { return this.scene; }
    getRenderer() { return this.renderer; }
    getCurrentTiles() { return this.currentTiles; }
    getTileData() {
        if (!this.hexasphere || !this.hexasphere.tiles) return {};
        const tileData = {};
        this.hexasphere.tiles.forEach(tile => {
            tileData[tile.id] = tile.getProperties();
        });
        return tileData;
    }
    getPopulationStats() {
        if (!this.hexasphere || !this.hexasphere.tiles) return { error: 'No hexasphere data available' };
        const POPULATION_THRESHOLD = 10000;
        let totalTiles = 0, habitableTiles = 0, populatedTiles = 0, highPopulationTiles = 0, redTiles = 0;
        this.hexasphere.tiles.forEach(tile => {
            totalTiles++;
            if (tile.Habitable === 'yes') {
                habitableTiles++;
                if (tile.population > 0) populatedTiles++;
                if (tile.population >= POPULATION_THRESHOLD) highPopulationTiles++;
                const colorInfo = this.tileColorIndices.get(tile.id);
                if (colorInfo && colorInfo.isHighlighted) redTiles++;
            }
        });
        return { totalTiles, habitableTiles, populatedTiles, highPopulationTiles, redTiles, threshold: POPULATION_THRESHOLD };
    }
    cleanup() {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        this.clearTiles();
    }
}

export default SceneManager;
