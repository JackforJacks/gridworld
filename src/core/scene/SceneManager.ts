// Scene Manager Module
// Handles scene creation, tile generation, and rendering
import * as THREE from 'three';
import { terrainColors, biomeColors, isLand } from '../../utils/index';
import Hexasphere from '../hexasphere/HexaSphere';
import populationManager from '../../managers/population/PopulationManager';

// Tile boundary point interface
interface BoundaryPoint {
    x: number;
    y: number;
    z: number;
}

// Tile interface for the hexasphere tiles
interface HexTile {
    id: number | string;
    Habitable?: string;
    is_habitable?: boolean;
    terrainType?: string;
    biome?: string;
    population?: number;
    boundary: BoundaryPoint[];
    centerPoint: BoundaryPoint & { getLatLon?: () => { lat: number; lon: number } };
    getProperties?: () => Record<string, unknown>;
}

// Color info for tile color tracking
interface TileColorInfo {
    start: number;
    count: number;
    originalColor: THREE.Color;
    currentColor: THREE.Color;
    isHighlighted: boolean;
}

// Hexasphere-like object
interface HexasphereData {
    tiles: HexTile[];
}

// Server tile data response
interface TileDataResponse {
    tiles: HexTile[];
}

// Population event data type
type PopulationEventType = 'populationUpdate' | string;

// Extend Window interface for global properties
declare global {
    interface Window {
        THREE: typeof THREE;
        currentTiles?: THREE.Mesh[];
        GridWorldApp?: {
            calendarManager?: {
                updateState: (state: unknown) => void;
            };
            calendarDisplay?: {
                updateDateDisplay: (state: unknown) => void;
            };
        };
        // Use a SceneManager-compatible interface to avoid conflicts with TileSelector declarations
    }
}

class SceneManager {
    // Three.js scene objects
    private scene: THREE.Scene | null;
    private renderer: THREE.WebGLRenderer | null;
    private hexasphereMesh: THREE.Mesh | null;
    private currentTiles: THREE.Mesh[];
    private cameraLight: THREE.PointLight | null;
    private ambientLight: THREE.AmbientLight | null;
    private directionalLight: THREE.DirectionalLight | null;

    // Hexasphere data (public for external access)
    public hexasphere: HexasphereData | null;
    private habitableTileIds: (number | string)[];
    private sphereRadius: number;

    // State tracking
    private tileColorIndices: Map<string, TileColorInfo>;
    private tileOverlays: Map<string, THREE.Mesh>;
    private populationUnsubscribe: (() => void) | null;

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
        this.tileOverlays = new Map(); // Map of tileId -> overlay mesh
    }

    initialize(width: number, height: number): { scene: THREE.Scene; renderer: THREE.WebGLRenderer } {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setClearColor(0x000000, 0);
        this.scene = new THREE.Scene();
        this.populationUnsubscribe = populationManager.subscribe((eventType: PopulationEventType, data: unknown) => {
            if (eventType === 'populationUpdate') {
                this.updateTilePopulations();
                this.checkPopulationThresholds();
            }
        });
        return { scene: this.scene, renderer: this.renderer };
    }

    async createHexasphere(radius: number | null = null, subdivisions: number | null = null, tileWidthRatio: number | null = null, forceRegenerate: boolean = false): Promise<void> {
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
            } catch (error: unknown) {
                console.warn('Failed to fetch config from server, using fallback defaults:', error);
                // Fallback to hardcoded defaults if server config is unavailable
                radius = radius ?? 30;
                subdivisions = subdivisions ?? 3;
                tileWidthRatio = tileWidthRatio ?? 1;
            }
        }

        // Instead of generating tiles locally, fetch from server
        await this.fetchAndBuildTiles(radius!, subdivisions!, tileWidthRatio!, forceRegenerate);
    }

    // Fetch tile data from the server and build geometry
    async fetchAndBuildTiles(radius: number, subdivisions: number, tileWidthRatio: number, forceRegenerate: boolean = false): Promise<void> {
        try {
            // Store the radius for use in border calculations
            this.sphereRadius = radius;

            // Fetch tile data from the server
            const regenQuery = forceRegenerate ? '&regenerate=true' : '';
            const response = await fetch(`/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}${regenQuery}`);
            if (!response.ok) throw new Error(`Failed to fetch tiles: ${response.status}`);
            const tileData = await response.json();
            this.buildTilesFromData(tileData);
        } catch (error: unknown) {
            console.error('❌ Error fetching tile data from server:', error);
        }
    }

    // Build Three.js geometry from server-provided tile data
    buildTilesFromData(tileData: TileDataResponse): void {
        // tileData is expected to be an array of tile objects with all necessary properties
        if (!tileData || !Array.isArray(tileData.tiles)) {
            console.error('❌ Invalid tile data from server:', tileData);
            return;
        }
        // Set up a pseudo-hexasphere object to keep compatibility with rest of code
        this.hexasphere = { tiles: tileData.tiles };
        this.habitableTileIds = [];
        this.tileColorIndices.clear();
        const hexasphereGeometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];
        let vertexIndex = 0;
        let colorIndex = 0;
        // Build geometry from each tile
        this.hexasphere.tiles.forEach((tile: HexTile, idx: number) => {
            // Use tile properties from server
            if (tile.Habitable === 'yes') this.habitableTileIds.push(tile.id);
            const color = this.getBiomeColor(tile); // Changed to use biome-based color
            const tileColorStart = colorIndex;
            const tileVertexCount = (tile.boundary.length - 2) * 3 * 3;
            this.tileColorIndices.set(String(tile.id), {
                start: tileColorStart,
                count: tileVertexCount,
                originalColor: color.clone(),
                currentColor: color.clone(),
                isHighlighted: false
            });            // Build geometry (fan triangulation) with NaN validation
            const boundaryPoints = tile.boundary.map((p: BoundaryPoint) => {
                // Validate and sanitize coordinates
                const x = isNaN(p.x) ? 0 : parseFloat(String(p.x));
                const y = isNaN(p.y) ? 0 : parseFloat(String(p.y));
                const z = isNaN(p.z) ? 0 : parseFloat(String(p.z));
                return new THREE.Vector3(x, y, z);
            });

            // Skip tiles with invalid boundary data
            if (boundaryPoints.length < 3) {
                console.warn(`Skipping tile ${tile.id}: insufficient boundary points`);
                return;
            }

            for (let i = 1; i < boundaryPoints.length - 1; i++) {
                const p0 = boundaryPoints[0];
                const p1 = boundaryPoints[i];
                const p2 = boundaryPoints[i + 1];

                // Validate triangle vertices before adding
                if (isNaN(p0.x) || isNaN(p0.y) || isNaN(p0.z) ||
                    isNaN(p1.x) || isNaN(p1.y) || isNaN(p1.z) ||
                    isNaN(p2.x) || isNaN(p2.y) || isNaN(p2.z)) {
                    console.warn(`Skipping invalid triangle in tile ${tile.id}`);
                    continue;
                }

                vertices.push(p0.x, p0.y, p0.z);
                vertices.push(p1.x, p1.y, p1.z);
                vertices.push(p2.x, p2.y, p2.z);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
                colors.push(color.r, color.g, color.b);
                indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                vertexIndex += 3;
            }
            colorIndex += tileVertexCount;
        });
        this.createHexasphereMesh(hexasphereGeometry, vertices, colors, indices);
        // After tiles are loaded, immediately apply any existing population data
        this.updateTilePopulations();
        this.checkPopulationThresholds();
    }

    async initializeTilePopulations(habitableTileIds: (number | string)[]): Promise<void> {
        try {
            // [log removed]
            // Convert to string[] for API compatibility
            const tileIdStrings = habitableTileIds.map(id => String(id));
            const result = await populationManager.initializeTilePopulations(tileIdStrings);
            this.updateTilePopulations();
            if (result && result.isExisting) {
                // [log removed]
            } else {
                // [log removed]
            }
        } catch (error: unknown) {
            console.error('❌ Failed to initialize tile populations:', error);
            console.error('❌ Habitable tiles data:', habitableTileIds);
            throw error;
        }
    }

    updateTilePopulations(): void {
        if (!this.hexasphere || !this.hexasphere.tiles) {
            console.warn('[SceneManager] updateTilePopulations: hexasphere not ready');
            return;
        }
        const tilePopulations = populationManager.getAllTilePopulations();
        const popKeys = Object.keys(tilePopulations);
        // [log removed]
        let updated = 0;
        // Debug: Check a specific tile that should have population
        if (popKeys.length > 0) {
            const testTileId = popKeys[0];
            const foundTile = this.hexasphere.tiles.find((t: HexTile) => String(t.id) === String(testTileId));
            // [log removed]
        }
        this.hexasphere.tiles.forEach((tile: HexTile) => {
            const oldPop = tile.population;
            // Use string comparison to handle both numeric and string IDs
            const pop = tilePopulations[tile.id] || tilePopulations[String(tile.id)] || 0;
            tile.population = (tile.Habitable === 'yes' || tile.is_habitable === true) ? pop : 0;
            if ((tile.population ?? 0) > 0) updated++;
        });
        // [log removed]
    }

    checkPopulationThresholds(): void {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) return;
        const POPULATION_THRESHOLD = 0; // Changed to 0 - any tile with population > 0 will be red
        let changesDetected = false;
        this.hexasphere.tiles.forEach((tile: HexTile) => {
            if (tile.Habitable === 'yes' && tile.population !== undefined) {
                const colorInfo = this.tileColorIndices.get(String(tile.id));
                if (!colorInfo) return;
                const shouldBeRed = (tile.population ?? 0) > POPULATION_THRESHOLD;
                if (shouldBeRed && !colorInfo.isHighlighted) {
                    this.addTileOverlay(tile);
                    colorInfo.isHighlighted = true;
                    changesDetected = true;
                } else if (!shouldBeRed && colorInfo.isHighlighted) {
                    this.removeTileOverlay(String(tile.id));
                    colorInfo.isHighlighted = false;
                    changesDetected = true;
                }
            }
        });
    }

    addTileOverlay(tile: HexTile): void {
        // Remove if already exists
        this.removeTileOverlay(String(tile.id));
        // Build overlay geometry (same as tile, but slightly scaled out)
        const boundaryPoints = tile.boundary.map((p: BoundaryPoint) => {
            // Scale out from center for overlay
            const center = tile.centerPoint;
            const scale = 1.0; // Same size as tile
            const x = center.x + (p.x - center.x) * scale;
            const y = center.y + (p.y - center.y) * scale;
            const z = center.z + (p.z - center.z) * scale;
            return new THREE.Vector3(x, y, z);
        });
        if (boundaryPoints.length < 3) return;
        const geometry = new THREE.BufferGeometry();
        const vertices: number[] = [];
        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            const p0 = boundaryPoints[0], p1 = boundaryPoints[i], p2 = boundaryPoints[i + 1];
            vertices.push(p0.x, p0.y, p0.z);
            vertices.push(p1.x, p1.y, p1.z);
            vertices.push(p2.x, p2.y, p2.z);
        }
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            transparent: true,
            opacity: 0.15, // More transparent effect
            depthWrite: true
        });
        const overlayMesh = new THREE.Mesh(geometry, material);
        overlayMesh.renderOrder = 10; // Render on top
        this.scene!.add(overlayMesh);
        this.tileOverlays.set(String(tile.id), overlayMesh);
    }

    removeTileOverlay(tileId: string): void {
        const overlay = this.tileOverlays.get(tileId);
        if (overlay) {
            this.scene!.remove(overlay);
            overlay.geometry.dispose();
            (overlay.material as THREE.Material).dispose();
            this.tileOverlays.delete(tileId);
        }
    }

    // Clear all tile overlays
    clearTileOverlays(): void {
        this.tileOverlays.forEach((overlay: THREE.Mesh, tileId: string) => {
            this.scene!.remove(overlay);
            overlay.geometry.dispose();
            (overlay.material as THREE.Material).dispose();
        });
        this.tileOverlays.clear();
    }

    resetTileColors(): void {
        if (!this.hexasphere || !this.hexasphere.tiles || !this.hexasphereMesh) return;
        // [log removed]
        let removedCount = 0;
        this.hexasphere.tiles.forEach((tile: HexTile) => {
            const colorInfo = this.tileColorIndices.get(String(tile.id));
            if (colorInfo && colorInfo.isHighlighted) {
                this.removeTileOverlay(String(tile.id));
                colorInfo.isHighlighted = false;
                colorInfo.currentColor = colorInfo.originalColor.clone();
                removedCount++;
            }
            // Clear population data as well
            tile.population = 0;
        });
        // [log removed]
    }

    async reinitializePopulation(): Promise<void> {
        // Ensure habitableTileIds is populated before re-initializing
        if (!this.habitableTileIds || this.habitableTileIds.length === 0) {
            if (this.hexasphere && this.hexasphere.tiles) {
                this.habitableTileIds = this.hexasphere.tiles
                    .filter((t: HexTile) => t.Habitable === 'yes')
                    .map((t: HexTile) => t.id);
            }
        }

        if (!this.habitableTileIds || this.habitableTileIds.length === 0) {
            console.error('❌ No habitable tiles found to reinitialize population.');
            return;
        }

        try {
            // [log removed]
            // Convert to string[] for API compatibility
            const tileIdStrings = this.habitableTileIds.map(id => String(id));
            await populationManager.initializeTilePopulations(tileIdStrings);
            // [log removed]
            this.updateTilePopulations(); // Refresh local tile data
            this.checkPopulationThresholds(); // This should add red overlays
            // [log removed]
        } catch (error: unknown) {
            console.error('❌ Failed to reinitialize population:', error);
        }
    }

    // Regenerate tiles with new terrain and habitability
    async regenerateTiles(): Promise<void> {
        // Require user confirmation before wiping all data
        const confirmed = window.confirm(
            '⚠️ WARNING: This will DELETE ALL POPULATION DATA permanently!\n\n' +
            'All people, families, and villages will be wiped and regenerated.\n\n' +
            'Are you absolutely sure you want to regenerate tiles?'
        );

        if (!confirmed) {
            // [log removed]
            return;
        }

        try {
            // [log removed]

            // First, restart the world to get a new seed
            const restartResponse = await fetch('/api/worldrestart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' })
            });
            if (!restartResponse.ok) {
                const errorData = await restartResponse.json().catch(() => ({}));
                throw new Error(`Failed to restart world: ${restartResponse.status} - ${errorData.message || 'Unknown error'}`);
            }
            const restartData = await restartResponse.json();
            // [log removed]

            // Attempt to apply server calendar state to client. If restart response lacks it, fetch /api/calendar/state
            try {
                let calendarState = restartData && restartData.calendarState;
                if (!calendarState) {
                    try {
                        const csResp = await fetch('/api/calendar/state');
                        if (csResp.ok) {
                            const csJson = await csResp.json();
                            if (csJson && csJson.success) calendarState = csJson.data;
                        }
                    } catch (e: unknown) {
                        console.warn('Failed to fetch /api/calendar/state after restart:', e);
                    }
                }

                if (calendarState) {
                    // [log removed]
                    // Force-update year label directly
                    const yearEl = document.getElementById('calendar-year-inline');
                    if (yearEl && calendarState.currentDate) {
                        yearEl.textContent = `Year: ${calendarState.currentDate.year}`;
                        // [log removed]
                    }
                    if (window.GridWorldApp && window.GridWorldApp.calendarManager) {
                        try {
                            window.GridWorldApp.calendarManager.updateState(calendarState);
                            if (window.GridWorldApp.calendarDisplay && typeof window.GridWorldApp.calendarDisplay.updateDateDisplay === 'function') {
                                window.GridWorldApp.calendarDisplay.updateDateDisplay(calendarState);
                            }
                            // [log removed]
                        } catch (e: unknown) {
                            console.warn('Failed to apply calendarState on client:', e);
                        }
                    }
                } else {
                    console.warn('[restart] No calendarState received from server');
                }
            } catch (e: unknown) {
                /* ignore */
            }

            // Get current hexasphere parameters from server config
            let radius = this.sphereRadius || 30;
            let subdivisions = 3; // Fallback
            let tileWidthRatio = 1; // Fallback

            try {
                const configResponse = await fetch('/api/config');
                if (configResponse.ok) {
                    const config = await configResponse.json();
                    radius = config.hexasphere.radius;
                    subdivisions = config.hexasphere.subdivisions;
                    tileWidthRatio = config.hexasphere.tileWidthRatio;
                    // [log removed]
                }
            } catch (error: unknown) {
                console.warn('Failed to fetch config, using fallback values:', error);
            }

            // Clear existing mesh before regenerating
            if (this.hexasphereMesh) {
                this.scene!.remove(this.hexasphereMesh);
                this.hexasphereMesh.geometry.dispose();
                (this.hexasphereMesh.material as THREE.Material).dispose();
                this.hexasphereMesh = null;
            }

            // Clear existing overlays
            this.clearTileOverlays();

            // Fetch new tile data from server with regenerate flag
            const response = await fetch(`/api/tiles?radius=${radius}&subdivisions=${subdivisions}&tileWidthRatio=${tileWidthRatio}&regenerate=true`);
            if (!response.ok) throw new Error(`Failed to fetch tiles: ${response.status}`);
            const tileData = await response.json();

            // Rebuild the geometry with new data
            this.buildTilesFromData(tileData);

            // [log removed]
        } catch (error: unknown) {
            console.error('❌ Failed to regenerate tiles:', error);
            throw error;
        }
    }

    calculateTileProperties(tile: HexTile): { terrainType: string; lat: number; lon: number } {
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
        } catch (e: unknown) {
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
    }

    getTerrainColor(terrainType: string): THREE.Color {
        return new THREE.Color((terrainColors as Record<string, number>)[terrainType] || 0x808080); // Default to gray if unknown
    }

    // New function to get biome-based color
    getBiomeColor(tile: HexTile): THREE.Color {
        // For ocean tiles, always use ocean color
        if (tile.terrainType === 'ocean') {
            return new THREE.Color((biomeColors as Record<string, number>).ocean);
        }
        // For land tiles, use biome color if available, otherwise fall back to terrain color
        if (tile.biome && (biomeColors as Record<string, number>)[tile.biome]) {
            return new THREE.Color((biomeColors as Record<string, number>)[tile.biome]);
        }
        // Fallback to terrain color if no biome is set
        return this.getTerrainColor(tile.terrainType || 'ocean');
    }

    addTileGeometry(tile: HexTile, color: THREE.Color, vertices: number[], colors: number[], indices: number[], startVertexIndex: number): void {
        // Validate and sanitize boundary points
        const boundaryPoints = tile.boundary.map((p: BoundaryPoint) => {
            const x = isNaN(p.x) ? 0 : parseFloat(String(p.x));
            const y = isNaN(p.y) ? 0 : parseFloat(String(p.y));
            const z = isNaN(p.z) ? 0 : parseFloat(String(p.z));
            return new THREE.Vector3(x, y, z);
        });

        // Skip tiles with invalid boundary data
        if (boundaryPoints.length < 3) {
            console.warn(`Skipping tile ${tile.id}: insufficient boundary points`);
            return;
        }

        for (let i = 1; i < boundaryPoints.length - 1; i++) {
            const p0 = boundaryPoints[0];
            const p1 = boundaryPoints[i];
            const p2 = boundaryPoints[i + 1];

            // Validate triangle vertices before adding
            if (isNaN(p0.x) || isNaN(p0.y) || isNaN(p0.z) ||
                isNaN(p1.x) || isNaN(p1.y) || isNaN(p1.z) ||
                isNaN(p2.x) || isNaN(p2.y) || isNaN(p2.z)) {
                console.warn(`Skipping invalid triangle in tile ${tile.id}`);
                continue;
            }

            vertices.push(p0.x, p0.y, p0.z);
            vertices.push(p1.x, p1.y, p1.z);
            vertices.push(p2.x, p2.y, p2.z);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            colors.push(color.r, color.g, color.b);
            indices.push(startVertexIndex, startVertexIndex + 1, startVertexIndex + 2);
            startVertexIndex += 3;
        }
    }

    createHexasphereMesh(geometry: THREE.BufferGeometry, vertices: number[], colors: number[], indices: number[]): void {
        // Validate vertices array for NaN values before creating geometry
        const hasNaN = vertices.some(v => isNaN(v));
        if (hasNaN) {
            console.error('❌ NaN values detected in vertices array:', vertices.filter(v => isNaN(v)));
            // Filter out NaN values
            const cleanVertices = vertices.filter(v => !isNaN(v));
            if (cleanVertices.length % 3 !== 0) {
                console.error('❌ Invalid vertex count after NaN removal');
                return;
            }
        }

        try {
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
            geometry.setIndex(indices);

            // Compute vertex normals (this is where the error was occurring)
            geometry.computeVertexNormals();

            const material = new THREE.MeshPhongMaterial({
                vertexColors: true,
                side: THREE.DoubleSide
            });
            const hexasphereMesh = new THREE.Mesh(geometry, material);
            this.hexasphereMesh = hexasphereMesh;
            hexasphereMesh.userData = { hexasphere: this.hexasphere };
            this.currentTiles.push(hexasphereMesh);
            this.scene!.add(hexasphereMesh);
            window.currentTiles = this.currentTiles;
        } catch (error: unknown) {
            console.error('❌ Error creating hexasphere mesh:', error);
            console.error('Vertices count:', vertices.length);
            console.error('Colors count:', colors.length);
            console.error('Indices count:', indices.length);
        }
    }

    clearTiles(): void {
        if (this.currentTiles && this.currentTiles.length > 0) {
            this.currentTiles.forEach((tileMesh: THREE.Mesh) => {
                this.scene!.remove(tileMesh);
                // Dispose geometry and material to prevent memory leaks
                if (tileMesh.geometry) tileMesh.geometry.dispose();
                if (tileMesh.material) {
                    if (Array.isArray(tileMesh.material)) {
                        tileMesh.material.forEach((material: THREE.Material) => material.dispose());
                    } else {
                        (tileMesh.material as THREE.Material).dispose();
                    }
                }
            });
            this.currentTiles.length = 0;
        }
        // Also dispose the hexasphereMesh if it exists
        if (this.hexasphereMesh) {
            this.scene!.remove(this.hexasphereMesh);
            if (this.hexasphereMesh.geometry) this.hexasphereMesh.geometry.dispose();
            if (this.hexasphereMesh.material) {
                if (Array.isArray(this.hexasphereMesh.material)) {
                    this.hexasphereMesh.material.forEach((material: THREE.Material) => material.dispose());
                } else {
                    (this.hexasphereMesh.material as THREE.Material).dispose();
                }
            }
            this.hexasphereMesh = null;
        }
        this.tileColorIndices.clear();
    }

    addLighting(camera: THREE.Camera, sphereRadius: number = 30): void {
        if (this.cameraLight) {
            if (this.cameraLight.parent) this.cameraLight.parent.remove(this.cameraLight);
            this.cameraLight = null;
        }
        if (!this.ambientLight) {
            this.ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
            this.scene!.add(this.ambientLight);
        }
        if (!this.directionalLight) {
            this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
            this.directionalLight.position.set(10, 20, 10);
            this.scene!.add(this.directionalLight);
        }
        const lightRadius = sphereRadius * 0.8;
        this.cameraLight = new THREE.PointLight(0xffffff, 1.0, lightRadius);
        this.cameraLight.position.set(0, 0, 0);
        camera.add(this.cameraLight);
        if (!this.scene!.children.includes(camera)) this.scene!.add(camera);
    }

    updateCameraLight(camera: THREE.Camera): void { }

    render(camera: THREE.Camera): void { this.renderer!.render(this.scene!, camera); }

    getScene(): THREE.Scene | null { return this.scene; }

    getRenderer(): THREE.WebGLRenderer | null { return this.renderer; }

    getCurrentTiles(): THREE.Mesh[] { return this.currentTiles; }

    getTileData(): Record<string, unknown> {
        if (!this.hexasphere || !this.hexasphere.tiles) return {};
        const tileData: Record<string, unknown> = {};
        this.hexasphere.tiles.forEach((tile: HexTile) => {
            tileData[String(tile.id)] = tile.getProperties ? tile.getProperties() : tile;
        });
        return tileData;
    }

    getPopulationStats(): Record<string, unknown> {
        if (!this.hexasphere || !this.hexasphere.tiles) return { error: 'No hexasphere data available' };
        const POPULATION_THRESHOLD = 10000;
        let totalTiles = 0, habitableTiles = 0, populatedTiles = 0, highPopulationTiles = 0, redTiles = 0;

        // Initialize biome statistics
        const biomes: Record<string, { tiles: number; population: number }> = {
            tundra: { tiles: 0, population: 0 },
            desert: { tiles: 0, population: 0 },
            plains: { tiles: 0, population: 0 },
            grassland: { tiles: 0, population: 0 },
            alpine: { tiles: 0, population: 0 }
        };

        this.hexasphere.tiles.forEach((tile: HexTile) => {
            totalTiles++;
            const population = tile.population || 0;

            if (tile.Habitable === 'yes') {
                habitableTiles++;
                if (population > 0) populatedTiles++;
                if (population >= POPULATION_THRESHOLD) highPopulationTiles++;
                const colorInfo = this.tileColorIndices.get(String(tile.id));
                if (colorInfo && colorInfo.isHighlighted) redTiles++;
            }

            // Count biome statistics
            if (tile.biome && biomes[tile.biome]) {
                biomes[tile.biome].tiles++;
                biomes[tile.biome].population += population;
            }
        });

        return {
            totalTiles,
            habitableTiles,
            populatedTiles,
            highPopulationTiles,
            redTiles,
            threshold: POPULATION_THRESHOLD,
            biomes
        };
    }

    cleanup(): void {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        this.clearTiles();
    }
}

export default SceneManager;
