// Scene Manager Module
// Handles scene creation, tile generation, and rendering
// CSS Loading Test: ${new Date().toLocaleTimeString()}

import { terrainColors, isLand } from './utils.js';
import Hexasphere from './Sphere/hexaSphere.js';
import populationManager from './population-manager.js';

class SceneManager {
    constructor() {
        this.scene = null;
        this.renderer = null;
        this.hexasphere = null; this.currentTiles = [];
        this.cameraLight = null;
        this.ambientLight = null;
        this.directionalLight = null;
        this.populationUnsubscribe = null;
        this.tileColorIndices = new Map(); // Track color indices for each tile
        this.hexasphereMesh = null; // Reference to the main mesh for color updates
        this.habitableTileIds = []; // Store IDs of habitable tiles
    }

    initialize(width, height) {
        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);

        // Create scene
        this.scene = new THREE.Scene();        // Subscribe to population updates to keep tile data current
        this.populationUnsubscribe = populationManager.subscribe((eventType, data) => {
            if (eventType === 'populationUpdate') {
                this.updateTilePopulations();
                this.checkPopulationThresholds(); // Check for color changes
            }
        });

        return { scene: this.scene, renderer: this.renderer };
    }

    createHexasphere(radius = 30, subdivisions = 3, tileWidthRatio = 1) {
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
        let vertexIndex = 0; const generatedTileData = [];
        this.habitableTileIds = []; // Initialize for this creation
        let colorIndex = 0; // Track color array index for each tile

        this.hexasphere.tiles.forEach((tile, idx) => {
            // Calculate terrain type and coordinates
            const { terrainType, lat, lon } = this.calculateTileProperties(tile);

            // Determine if tile is Habitable (no for ice/ocean, yes for others)
            const Habitable = (terrainType === 'ice' || terrainType === 'ocean') ? 'no' : 'yes';

            // Set all properties directly on the tile object - single source of truth!
            tile.setProperties(idx, lat, lon, isLand(tile.centerPoint), terrainType, Habitable);

            // Track habitable tiles for population initialization
            if (Habitable === 'yes') {
                this.habitableTileIds.push(idx);
            }

            // Get color for terrain type
            const color = this.getTerrainColor(terrainType);

            // Store color indices for this tile
            const tileColorStart = colorIndex;
            const tileVertexCount = (tile.boundary.length - 2) * 3 * 3; // vertices per triangle * 3 color components
            this.tileColorIndices.set(tile.id, {
                start: tileColorStart,
                count: tileVertexCount,
                originalColor: color.clone(),
                currentColor: color.clone(),
                isHighlighted: false
            });

            // Create geometry for this tile
            this.addTileGeometry(tile, color, vertices, colors, indices, vertexIndex);
            vertexIndex += (tile.boundary.length - 2) * 3;
            colorIndex += tileVertexCount;

            generatedTileData.push({
                tileId: tile.id,
                latitude: lat,
                longitude: lon,
                Habitable: Habitable
            });
        });

        // Create the mesh
        this.createHexasphereMesh(hexasphereGeometry, vertices, colors, indices);

        // Initialize tile populations for habitable tiles
        this.initializeTilePopulations(this.habitableTileIds);

        return generatedTileData;
    }

    // Initialize populations for habitable tiles
    async initializeTilePopulations(habitableTileIds) {
        try {
            console.log(`🏘️ Initializing populations for ${habitableTileIds.length} habitable tiles...`);
            await populationManager.initializeTilePopulations(habitableTileIds);

            // Update tile objects with their population data
            this.updateTilePopulations();
        } catch (error) {
            console.error('❌ Failed to initialize tile populations:', error);
        }
    }    // Update tile objects with current population data
    updateTilePopulations() {
        if (!this.hexasphere || !this.hexasphere.tiles) return;

        const tilePopulations = populationManager.getAllTilePopulations();

        this.hexasphere.tiles.forEach(tile => {
            if (tile.Habitable === 'yes') {
                tile.population = tilePopulations[tile.id] || 0;
            } else {
                tile.population = 0;
            }
        });

        console.log(`📊 Updated population data for ${Object.keys(tilePopulations).length} habitable tiles`);
    }

    // Check for population thresholds and update tile colors
    checkPopulationThresholds() {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) return;

        const POPULATION_THRESHOLD = 10000;
        const redColor = new THREE.Color(0xff0000); // Red color for high population
        let changesDetected = false;

        this.hexasphere.tiles.forEach(tile => {
            if (tile.Habitable === 'yes' && tile.population !== undefined) {
                const colorInfo = this.tileColorIndices.get(tile.id);
                if (!colorInfo) return;

                const shouldBeRed = tile.population >= POPULATION_THRESHOLD;

                // Check if color state needs to change
                if (shouldBeRed && !colorInfo.isHighlighted) {
                    // Change to red
                    this.updateTileColor(tile.id, redColor);
                    colorInfo.isHighlighted = true;
                    colorInfo.currentColor = redColor.clone();
                    changesDetected = true;
                    console.log(`🔴 Tile ${tile.id} turned red - Population: ${tile.population.toLocaleString()}`);
                } else if (!shouldBeRed && colorInfo.isHighlighted) {
                    // Revert to original color
                    this.updateTileColor(tile.id, colorInfo.originalColor);
                    colorInfo.isHighlighted = false;
                    colorInfo.currentColor = colorInfo.originalColor.clone();
                    changesDetected = true;
                    console.log(`🟢 Tile ${tile.id} reverted to original color - Population: ${tile.population.toLocaleString()}`);
                }
            }
        });

        if (changesDetected) {
            console.log(`🎨 Updated tile colors based on population thresholds`);
        }
    }

    // Update color of a specific tile
    updateTileColor(tileId, newColor) {
        if (!this.hexasphereMesh || !this.hexasphereMesh.geometry) return;

        const colorInfo = this.tileColorIndices.get(tileId);
        if (!colorInfo) return;

        const colorAttribute = this.hexasphereMesh.geometry.getAttribute('color');
        if (!colorAttribute) return;

        // Update all color components for this tile's vertices
        for (let i = colorInfo.start; i < colorInfo.start + colorInfo.count; i += 3) {
            colorAttribute.setXYZ(i / 3, newColor.r, newColor.g, newColor.b);
        }

        // Mark the color attribute as needing update
        colorAttribute.needsUpdate = true;
    }

    // Reset all tile colors to their original terrain-based colors
    resetTileColors() {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) {
            console.warn('⚠️ Cannot reset colors: missing hexasphere data');
            return;
        }

        let resetCount = 0;
        this.hexasphere.tiles.forEach(tile => {
            const colorInfo = this.tileColorIndices.get(tile.id);
            if (colorInfo && colorInfo.isHighlighted) { // Corrected syntax: added parentheses
                this.updateTileColor(tile.id, colorInfo.originalColor);
                colorInfo.isHighlighted = false;
                colorInfo.currentColor = colorInfo.originalColor.clone();
                resetCount++;
            }
        });

        console.log(`🎨 Reset ${resetCount} tiles to original colors`);
        return resetCount;
    }

    // Method to re-initialize population on habitable tiles
    async reinitializePopulation() {
        if (!this.habitableTileIds || this.habitableTileIds.length === 0) {
            console.warn('⚠️ Cannot reinitialize population: habitable tile IDs not available or hexasphere not created yet.');
            // Potentially, we could try to regenerate them if the hexasphere exists
            // but for now, we assume createHexasphere must have been called.
            return;
        }
        console.log(`🔄 Reinitializing population for ${this.habitableTileIds.length} habitable tiles...`);
        try {
            await this.initializeTilePopulations(this.habitableTileIds);
            // Ensure UI reflects the reset and new initialization
            this.checkPopulationThresholds(); // Re-check thresholds after re-initialization
            console.log('✅ Population reinitialized and thresholds checked.');
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

    createHexasphereMesh(geometry, vertices, colors, indices) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals(); const material = new THREE.MeshPhongMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });

        const hexasphereMesh = new THREE.Mesh(geometry, material);
        // Store reference to the mesh for color updates
        this.hexasphereMesh = hexasphereMesh;

        // Simplified userData - no separate tileData structure needed
        hexasphereMesh.userData = { hexasphere: this.hexasphere };

        this.currentTiles.push(hexasphereMesh);
        this.scene.add(hexasphereMesh);

        // Update global reference
        window.currentTiles = this.currentTiles;
    } clearTiles() {
        if (this.currentTiles && this.currentTiles.length > 0) {
            this.currentTiles.forEach(tileMesh => this.scene.remove(tileMesh));
            this.currentTiles.length = 0;
        }

        // Clear color tracking data
        this.tileColorIndices.clear();
        this.hexasphereMesh = null;
    }

    addLighting(camera, sphereRadius = 30) {
        // Remove old light if present
        if (this.cameraLight) {
            if (this.cameraLight.parent) this.cameraLight.parent.remove(this.cameraLight);
            this.cameraLight = null;
        }
        // Add ambient light (reduced for more contrast)
        if (!this.ambientLight) {
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
            this.scene.add(this.ambientLight);
        }
        // Add a directional light for clear shading
        if (!this.directionalLight) {
            this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
            this.directionalLight.position.set(10, 20, 10);
            this.scene.add(this.directionalLight);
        }
        // Add a point light at the camera for highlights, with a smaller radius
        const lightRadius = sphereRadius * 0.8;
        this.cameraLight = new THREE.PointLight(0xffffff, 1.0, lightRadius);
        this.cameraLight.position.set(0, 0, 0);
        camera.add(this.cameraLight);
        if (!this.scene.children.includes(camera)) this.scene.add(camera);
    }

    updateCameraLight(camera) {
        // No need to update position, as the light is parented to the camera
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
    } getTileData() {
        // Return tile properties directly from the hexasphere tiles
        if (!this.hexasphere || !this.hexasphere.tiles) {
            return {};
        }

        const tileData = {};
        this.hexasphere.tiles.forEach(tile => {
            tileData[tile.id] = tile.getProperties();
        });

        return tileData;
    }    // Get statistics about tile population thresholds
    getPopulationStats() {
        if (!this.hexasphere || !this.hexasphere.tiles) {
            return { error: 'No hexasphere data available' };
        }

        const POPULATION_THRESHOLD = 10000;
        let totalTiles = 0;
        let habitableTiles = 0;
        let populatedTiles = 0;
        let highPopulationTiles = 0;
        let redTiles = 0;

        this.hexasphere.tiles.forEach(tile => {
            totalTiles++;
            if (tile.Habitable === 'yes') {
                habitableTiles++;
                if (tile.population > 0) {
                    populatedTiles++;
                }
                if (tile.population >= POPULATION_THRESHOLD) {
                    highPopulationTiles++;
                }

                // Check if tile is currently red
                const colorInfo = this.tileColorIndices.get(tile.id);
                if (colorInfo && colorInfo.isHighlighted) {
                    redTiles++;
                }
            }
        });

        return {
            totalTiles,
            habitableTiles,
            populatedTiles,
            highPopulationTiles,
            redTiles,
            threshold: POPULATION_THRESHOLD
        };
    }

    cleanup() {
        // Unsubscribe from population updates
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }

        // Clear tiles and color tracking
        this.clearTiles();
    }
}

export default SceneManager;
