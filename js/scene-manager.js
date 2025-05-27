// Scene Manager Module
// Handles scene creation, tile generation, and rendering

const { terrainColors, isLand } = require('./utils');

class SceneManager {
    constructor() {
        this.scene = null;
        this.renderer = null;
        this.hexasphere = null;
        this.currentTiles = [];
        this.tileData = {};
    }

    initialize(width, height) {
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);

        // Create scene
        this.scene = new THREE.Scene();

        return { scene: this.scene, renderer: this.renderer };
    }

    createHexasphere(radius = 30, subdivisions = 10, tileWidthRatio = 1, serverPopulationData = null) {
        // Clear existing tiles
        this.clearTiles();

        // Create new hexasphere
        this.hexasphere = new Hexasphere(radius, subdivisions, tileWidthRatio);
        window.hexasphere = this.hexasphere;

        // Create unified geometry
        const hexasphereGeometry = new THREE.BufferGeometry();
        const vertices = [];
        const colors = [];
        const indices = [];
        let vertexIndex = 0;

        const generatedTileData = [];

        this.hexasphere.tiles.forEach((tile, idx) => {
            tile.id = idx;
            
            // Calculate terrain type and coordinates
            const { terrainType, lat, lon } = this.calculateTileProperties(tile);
            
            // Get color for terrain type
            const color = this.getTerrainColor(terrainType);
            
            // Create geometry for this tile
            this.addTileGeometry(tile, color, vertices, colors, indices, vertexIndex);
            vertexIndex += (tile.boundary.length - 2) * 3;

            // Store tile data
            const population = this.getTilePopulation(tile, serverPopulationData);
            this.tileData[tile.id] = {
                id: tile.id,
                tileObject: tile,
                population: population,
                latitude: lat,
                longitude: lon,
                isLand: isLand(tile.centerPoint),
                terrainType: terrainType
            };

            generatedTileData.push({
                tileId: tile.id,
                population: population,
                latitude: lat,
                longitude: lon
            });
        });

        // Create the mesh
        this.createHexasphereMesh(hexasphereGeometry, vertices, colors, indices);

        return generatedTileData;
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
            console.warn("Could not get lat/lon for tile:", tile.id, e);
        }

        // Determine terrain type
        let terrainType;
        if (lat >= 89 || lat <= -89) {
            terrainType = 'ice';
        } else {
            terrainType = isLand(tile.centerPoint) ? 'grassland' : 'ocean';
        }

        return { terrainType, lat, lon };
    }

    getTerrainColor(terrainType) {
        return new THREE.Color(
            terrainType === 'ice' ? 0xffffff : 
            terrainType === 'grassland' ? terrainColors.grassland : terrainColors.ocean
        );
    }

    addTileGeometry(tile, color, vertices, colors, indices, startVertexIndex) {
        const boundaryPoints = tile.boundary.map(p => new THREE.Vector3(p.x, p.y, p.z));

        // Fan triangulation
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            // Triangle vertices
            vertices.push(boundaryPoints[0].x, boundaryPoints[0].y, boundaryPoints[0].z);
            vertices.push(boundaryPoints[i].x, boundaryPoints[i].y, boundaryPoints[i].z);
            vertices.push(boundaryPoints[i + 1].x, boundaryPoints[i + 1].y, boundaryPoints[i + 1].z);

            // Colors for each vertex
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);

            // Indices for the triangle
            indices.push(startVertexIndex, startVertexIndex + 1, startVertexIndex + 2);
            startVertexIndex += 3;
        }
    }

    getTilePopulation(tile, serverPopulationData) {
        let population = Math.floor(Math.random() * 1000);
        
        if (serverPopulationData) {
            const serverTileInfo = serverPopulationData.find(d => d.tileId === tile.id);
            if (serverTileInfo && serverTileInfo.population !== undefined) {
                population = serverTileInfo.population;
            }
        }
        
        return population;
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
        hexasphereMesh.userData = { tileData: this.tileData };
        
        this.currentTiles.push(hexasphereMesh);
        this.scene.add(hexasphereMesh);
        
        // Update global reference
        window.currentTiles = this.currentTiles;
    }

    clearTiles() {
        if (this.currentTiles && this.currentTiles.length > 0) {
            this.currentTiles.forEach(tileMesh => this.scene.remove(tileMesh));
            this.currentTiles.length = 0;
        }
    }

    addLighting() {
        // Add ambient light
        const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
        this.scene.add(ambientLight);

        // Add directional light
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1).normalize();
        this.scene.add(directionalLight);
    }

    render(camera) {
        this.renderer.render(this.scene, camera);
    }

    getScene() {
        return this.scene;
    }

    getRenderer() {
        return this.renderer;
    }

    getCurrentTiles() {
        return this.currentTiles;
    }

    getTileData() {
        return this.tileData;
    }
}

module.exports = SceneManager;
