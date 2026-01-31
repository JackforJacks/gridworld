// Tile Selector Module
// Handles tile selection, borders, and popups

import * as THREE from 'three';
import { getAppContext } from '../../core/AppContext';

// Tile boundary point interface
interface BoundaryPoint {
    x: number;
    y: number;
    z: number;
}

// Land data within a tile
interface LandData {
    land_type?: string;
    cleared?: boolean;
    chunk_index?: number;
    village_id?: number | null;
    village_name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_slots?: number[];
    housing_capacity?: number;
    occupied_slots?: number;
}

// Tile interface for the hexasphere tiles
interface HexTile {
    id: number | string;
    Habitable?: string;
    is_habitable?: boolean;
    terrainType?: string;
    biome?: string;
    population?: number;
    fertility?: number;
    latitude?: number | null;
    longitude?: number | null;
    lands?: LandData[];
    boundary: BoundaryPoint[];
    centerPoint: BoundaryPoint & { getLatLon?: (radius?: number) => { lat: number; lon: number } };
    getProperties?: () => Record<string, unknown>;
}

// Hexasphere data structure
interface HexasphereData {
    tiles: HexTile[];
}

// SceneManager interface (minimal for TileSelector usage)
interface SceneManagerLike {
    hexasphere?: HexasphereData | null;
}

// Village data from API
interface VillageApiData {
    id?: number | null;
    tile_id?: number;
    land_chunk_index?: number;
    village_name?: string;
    name?: string;
    food_stores?: number;
    food_capacity?: number;
    food_production_rate?: number;
    housing_slots?: number[];
    housing_capacity?: number;
    occupied_slots?: number;
}

// Extend Window interface for global properties used by TileSelector
declare global {
    interface Window {
        THREE: typeof THREE;
        currentTiles?: THREE.Mesh[];
        sceneManager?: SceneManagerLike;
        tileSelector?: TileSelector;
        __tileSelectorJustClosed?: number;
        __tileSelectorDebug?: boolean;
        __tileSelectorCloseHandlerAttached?: boolean;
    }
}

class TileSelector {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private sceneManager: SceneManagerLike;
    private raycaster: THREE.Raycaster;
    public selectedTile: HexTile | null;
    private borderLines: THREE.Group | null;
    private tileInfoPanel: HTMLElement | null;
    private closeInfoPanelBtn: HTMLElement | null;
    private borderMaterial: THREE.LineBasicMaterial;
    private infoRefreshInterval: ReturnType<typeof setInterval> | null;
    public infoRefreshTileId: number | string | null;
    private _infoPanelMutationObserver?: MutationObserver;

    constructor(scene: THREE.Scene, camera: THREE.Camera, sceneManager: SceneManagerLike) {
        this.scene = scene;
        this.camera = camera;
        this.sceneManager = sceneManager;
        this.raycaster = new THREE.Raycaster();
        this.selectedTile = null;
        this.borderLines = null;
        this.tileInfoPanel = document.getElementById('tileInfoPanel');
        this.closeInfoPanelBtn = document.getElementById('closeInfoPanel');
        this.infoRefreshInterval = null;
        this.infoRefreshTileId = null;
        this.borderMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            depthTest: false,
            transparent: true,
            opacity: 1
        });
        // Expose current instance via AppContext so event handlers always call the active TileSelector
        const ctx = getAppContext();
        ctx.tileSelector = this;
        // Also set on window for legacy compatibility during transition
        window.tileSelector = this;

        try {
            if (this.tileInfoPanel && typeof MutationObserver !== 'undefined') {
                this._infoPanelMutationObserver = new MutationObserver((_mutations: MutationRecord[]) => {
                    if (getAppContext().tileSelectorDebug) console.debug('TileSelector: tileInfoPanel mutated', _mutations);
                    try { this.ensureCloseButtonAttached(); } catch (_: unknown) { /* ignore */ }
                });
                this._infoPanelMutationObserver.observe(this.tileInfoPanel, { childList: true, subtree: true, attributes: true, characterData: true });
            }
        } catch (_e: unknown) {
            // ignore if MutationObserver not available in environment
        }

        // Add listeners to page buttons so that switching pages re-attaches close handlers
        try {
            const pageButtons = document.querySelectorAll('.info-panel-btn');
            pageButtons.forEach(btn => {
                btn.addEventListener('click', (_e: Event) => {
                    if (getAppContext().tileSelectorDebug) console.debug('TileSelector: page button clicked', (btn as HTMLElement).id);
                    try { this.ensureCloseButtonAttached(); } catch (_: unknown) { /* ignore */ }
                }, true);
            });
        } catch (_: unknown) { /* ignore */ }

        // Use event delegation on the panel itself to handle close button clicks
        // This works even if the button is replaced/recreated. Attach only once.
        if (this.tileInfoPanel && !this.tileInfoPanel.dataset.closeDelegateAttached) {
            this.tileInfoPanel.addEventListener('click', (e: Event) => {
                const target = e.target as HTMLElement;
                const closeBtn = target.closest('#closeInfoPanel, .close-info-panel');
                if (closeBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const ctx = getAppContext();
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.hideInfoPanel === 'function') ctx.tileSelector.hideInfoPanel(); } catch (_: unknown) { /* ignore */ }
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.deselectAll === 'function') ctx.tileSelector.deselectAll(); } catch (_: unknown) { /* ignore */ }
                }
            });
            this.tileInfoPanel.dataset.closeDelegateAttached = '1';
        }

        // Fallback: global listener to ensure close works even if panel/button is replaced
        if (!getAppContext().tileSelectorCloseHandlerAttached) {
            const docHandler = (e: Event): void => {
                const ctx = getAppContext();
                const target = e.target as HTMLElement | null;
                const closeBtn = target && target.closest && target.closest('#closeInfoPanel, .close-info-panel');
                if (closeBtn) {
                    if (ctx.tileSelectorDebug) console.debug('TileSelector: docHandler caught close click (debug)', target);
                    e.preventDefault();
                    e.stopPropagation();
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.hideInfoPanel === 'function') ctx.tileSelector.hideInfoPanel(); } catch (_: unknown) { /* ignore */ }
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.deselectAll === 'function') ctx.tileSelector.deselectAll(); } catch (_: unknown) { /* ignore */ }
                    // As a fallback, directly hide the DOM panel in case the instance method fails
                    try {
                        const panel = document.getElementById('tileInfoPanel');
                        if (panel) {
                            panel.classList.add('hidden');
                            panel.style.display = 'none';
                            panel.style.pointerEvents = 'none';
                            try { ctx.tileSelectorJustClosed = Date.now(); } catch (_: unknown) { /* ignore */ }
                        }
                    } catch (_: unknown) { /* ignore */ }
                    // Try removing visual selection if instance exists
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.removeBorder === 'function') ctx.tileSelector.removeBorder(); } catch (_: unknown) { /* ignore */ }
                    try { if (ctx.tileSelector) ctx.tileSelector.selectedTile = null; } catch (_: unknown) { /* ignore */ }
                }
            };
            // capture click/pointer events early to catch interactions even if propagation is stopped elsewhere
            document.addEventListener('pointerdown', docHandler, true);
            document.addEventListener('click', docHandler, true);
            document.addEventListener('pointerup', docHandler, true);

            // allow Escape key to close the panel as an extra fallback
            const keyHandler = (ev: KeyboardEvent): void => {
                const ctx = getAppContext();
                if (ev.key === 'Escape' || ev.key === 'Esc') {
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.hideInfoPanel === 'function') ctx.tileSelector.hideInfoPanel(); } catch (_: unknown) { /* ignore */ }
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.deselectAll === 'function') ctx.tileSelector.deselectAll(); } catch (_: unknown) { /* ignore */ }
                }
            };
            document.addEventListener('keydown', keyHandler, true);

            // mark as attached to avoid duplicates
            getAppContext().tileSelectorCloseHandlerAttached = true;
        }
    }

    handleClick(event: MouseEvent): void {
        // Debug trace: log when clicks reach the TileSelector
        // debug: clicks reach TileSelector (guarded by tileSelectorDebug if needed)
        if (getAppContext().tileSelectorDebug) try { console.debug('TileSelector.handleClick', event.clientX, event.clientY, 'target=', event.target && (event.target as HTMLElement).tagName); } catch (_: unknown) { /* ignore */ }
        // Check if the click is on the info panel - if so, ignore it
        if (this.tileInfoPanel && this.tileInfoPanel.contains(event.target as Node)) {
            return;
        }

        const target = event.target as HTMLElement;
        const rect = target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);

        // Get current tiles from AppContext
        const currentTiles = getAppContext().currentTiles || [];
        const intersects = this.raycaster.intersectObjects(currentTiles);

        if (intersects.length > 0) {
            const intersectionPoint = intersects[0].point;
            const closestTile = this.findClosestTile(intersectionPoint);

            if (closestTile) {
                this.selectTile(closestTile, event);
            }
        } else {
            this.deselectAll();
        }
    }

    findClosestTile(intersectionPoint: THREE.Vector3): HexTile | null {
        const ctx = getAppContext();
        const tiles = ctx.getHexasphereTiles() as HexTile[];

        if (!tiles || tiles.length === 0) {
            return null;
        }

        let closestTile: HexTile | null = null;
        let minDistance = Infinity;

        tiles.forEach((tile: HexTile) => {
            const tileCenter = new THREE.Vector3(tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z);
            const distance = intersectionPoint.distanceTo(tileCenter);

            if (distance < minDistance) {
                minDistance = distance;
                closestTile = tile;
            }
        });

        return closestTile;
    }

    selectTile(tile: HexTile, _event?: MouseEvent): void {
        // Check if clicking the same tile again
        if (this.selectedTile && this.selectedTile.id === tile.id) {
            this.deselectAll();
            return;
        }

        // Remove previous border
        this.removeBorder();

        // Create new border
        this.createBorder(tile);

        // Set selected tile then show info panel
        this.selectedTile = tile;
        this.showInfoPanel(tile);
    }

    createBorder(tile: HexTile): void {
        const borderGroup = new THREE.Group();

        // Create multiple border layers for glowing yellow effect
        for (let offset = 0; offset < 4; offset++) {
            const borderGeometry = new THREE.BufferGeometry();
            const borderVertices: number[] = [];
            const offsetScale = offset * 0.004; // Slightly larger offset for glow

            // Create a continuous line loop around the tile boundary
            for (let i = 0; i <= tile.boundary.length; i++) {
                const current = tile.boundary[i % tile.boundary.length];

                // Validate coordinates
                if (current && !isNaN(current.x) && !isNaN(current.y) && !isNaN(current.z)) {
                    // Use the boundary points directly with slight outward offset
                    const currentVec = new THREE.Vector3(current.x, current.y, current.z);

                    // Apply small outward offset along the normal direction
                    if (offsetScale > 0) {
                        const normal = currentVec.clone().normalize();
                        currentVec.add(normal.multiplyScalar(offsetScale));
                    }

                    borderVertices.push(currentVec.x, currentVec.y, currentVec.z);
                }
            }

            if (borderVertices.length > 0) {
                borderGeometry.setAttribute('position', new THREE.Float32BufferAttribute(borderVertices, 3));

                // Create glowing yellow effect with different intensities
                const glowIntensity = 1 - (offset * 0.2);
                const borderMaterial = new THREE.LineBasicMaterial({
                    color: offset === 0 ? 0xffff00 : // Bright yellow core
                        offset === 1 ? 0xffdd00 : // Slightly orange yellow
                            offset === 2 ? 0xffaa00 : // More orange
                                0xff8800,  // Outer orange glow
                    depthTest: false,
                    transparent: true,
                    opacity: glowIntensity * 0.8,
                    linewidth: 8 - (offset * 1.5) // Much thicker lines: 8, 6.5, 5, 3.5
                });

                const borderLine = new THREE.LineLoop(borderGeometry, borderMaterial);
                borderGroup.add(borderLine);
            }
        }

        this.borderLines = borderGroup;
        this.scene.add(this.borderLines);
    }

    removeBorder(): void {
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines = null;
        }
    }

    showInfoPanel(tile: HexTile): void {
        if (!this.tileInfoPanel) return;
        // Clear recent-close guard so user clicks always reopen panel
        try { getAppContext().tileSelectorJustClosed = undefined; } catch (_: unknown) { /* ignore */ }
        // Clear any existing interval
        if (this.infoRefreshInterval) {
            clearInterval(this.infoRefreshInterval);
            this.infoRefreshInterval = null;
            this.infoRefreshTileId = null;
        }

        // Delegate rendering to updateInfoPanel (also used by the refresh interval)
        this.updateInfoPanel(tile);

        // Ensure panel is visible and page1 is active
        if (this.tileInfoPanel) {
            // Make sure panel is visible even if it was forcibly hidden
            try { this.tileInfoPanel.style.display = 'block'; } catch (_: unknown) { /* ignore */ }
            try { this.tileInfoPanel.style.pointerEvents = 'auto'; } catch (_: unknown) { /* ignore */ }
            this.tileInfoPanel.classList.remove('hidden');
            // Ensure panel sits above the canvas and can receive pointer events
            try {
                this.tileInfoPanel.style.zIndex = '99999';
                this.tileInfoPanel.style.position = 'fixed';
                this.tileInfoPanel.style.pointerEvents = 'auto';
                // Move panel to document.body to avoid stacking-context issues from transformed parents
                try {
                    if (this.tileInfoPanel.parentElement !== document.body) {
                        document.body.appendChild(this.tileInfoPanel);
                        if (getAppContext().tileSelectorDebug) console.debug('TileSelector: moved tileInfoPanel to document.body');
                    }
                } catch (_e: unknown) { /* ignore */ }
            } catch (_: unknown) { /* ignore */ }
            const page1 = this.tileInfoPanel.querySelector('#info-panel-page-1') as HTMLElement | null;
            const page2 = this.tileInfoPanel.querySelector('#info-panel-page-2') as HTMLElement | null;
            if (page1) page1.style.display = '';
            if (page2) page2.style.display = 'none';

            // Attach direct handlers to the close button to avoid delegation issues when pages change
            const closeBtn = this.tileInfoPanel.querySelector('#closeInfoPanel') as HTMLElement | null;
            if (closeBtn && !closeBtn.dataset.listenerAttached) {
                // make sure the button can receive pointer events and sits above the canvas
                try { closeBtn.style.pointerEvents = 'auto'; } catch (_: unknown) { /* ignore */ }
                try { closeBtn.style.zIndex = '100000'; } catch (_: unknown) { /* ignore */ }
                try { closeBtn.style.position = 'absolute'; } catch (_: unknown) { /* ignore */ }
                try { closeBtn.style.top = '10px'; } catch (_: unknown) { /* ignore */ }
                try { closeBtn.style.right = '10px'; } catch (_: unknown) { /* ignore */ }
                const handler = (ev: Event): void => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    try { closeBtn.style.pointerEvents = 'auto'; } catch (_: unknown) { /* ignore */ }
                    const ctx = getAppContext();
                    if (ctx.tileSelectorDebug) console.debug('closeInfoPanel direct handler fired (debug)', ev.target);
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.hideInfoPanel === 'function') ctx.tileSelector.hideInfoPanel(); } catch (_: unknown) { /* ignore */ }
                    try { if (ctx.tileSelector && typeof ctx.tileSelector.deselectAll === 'function') ctx.tileSelector.deselectAll(); } catch (_: unknown) { /* ignore */ }
                };
                closeBtn.addEventListener('click', handler, true);
                closeBtn.addEventListener('pointerup', handler, true);
                closeBtn.dataset.listenerAttached = '1';
            }
        }

        // Start periodic refresh for this tile while panel visible
        this.infoRefreshTileId = tile.id;
        this.infoRefreshInterval = setInterval(() => {
            if (!this.tileInfoPanel || this.tileInfoPanel.classList.contains('hidden') || this.infoRefreshTileId !== this.selectedTile?.id) {
                if (this.infoRefreshInterval) {
                    clearInterval(this.infoRefreshInterval);
                    this.infoRefreshInterval = null;
                    this.infoRefreshTileId = null;
                }
                return;
            }
            try {
                // Refresh using the currently selected tile (may have updated properties)
                if (this.selectedTile) {
                    this.updateInfoPanel(this.selectedTile);
                }
            } catch (e: unknown) {
                console.warn('Error refreshing info panel:', e);
            }
        }, 1000);
    }

    updateInfoPanel(tile: HexTile): void {
        if (!this.tileInfoPanel || !tile) return;

        let lat = 0, lon = 0;
        let Habitable = 'unknown';
        let terrainType = 'unknown';

        try {
            if (tile.latitude !== null && tile.latitude !== undefined && tile.longitude !== null && tile.longitude !== undefined) {
                lat = tile.latitude;
                lon = tile.longitude;
            } else if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLon = tile.centerPoint.getLatLon(1);
                lat = latLon.lat;
                lon = latLon.lon;
            } else if (tile.centerPoint) {
                const r = Math.sqrt(
                    tile.centerPoint.x * tile.centerPoint.x +
                    tile.centerPoint.y * tile.centerPoint.y +
                    tile.centerPoint.z * tile.centerPoint.z
                );
                lat = Math.asin(tile.centerPoint.y / r) * 180 / Math.PI;
                lon = Math.atan2(tile.centerPoint.z, tile.centerPoint.x) * 180 / Math.PI;
            }
        } catch (e: unknown) {
            console.warn("Could not get lat/lon for tile:", tile.id, e);
        }

        try {
            Habitable = tile.Habitable || 'unknown';
            terrainType = tile.terrainType || 'unknown';
        } catch (e: unknown) {
            console.warn("Could not get tile data for tile:", tile.id, e);
        }

        const population = tile.population || 0;
        const populationDisplay = population > 0 ? population.toLocaleString() : 'Uninhabited';

        const biome = tile.biome || null;
        const biomeIcons: Record<string, string> = { tundra: '🏔️', desert: '🏜️', plains: '🌾', grassland: '🌱', alpine: '⛰️' };
        const biomeDisplay = biome ? `${biomeIcons[biome] || '🌍'} ${biome.charAt(0).toUpperCase() + biome.slice(1)}` : 'N/A';

        const fertility = tile.fertility !== undefined ? tile.fertility : null;
        const fertilityDisplay = fertility !== null ? `${fertility}/100` : 'N/A';
        const fertilityIcon = fertility !== null ? (fertility === 0 ? '🪨' : fertility < 30 ? '🌫️' : fertility < 60 ? '🌿' : fertility < 80 ? '🌾' : '🌻') : '❓';

        let forestedCount = 0, wasteCount = 0, clearedCount = 0;
        if (Array.isArray(tile.lands)) {
            forestedCount = tile.lands.filter((l: LandData) => l.land_type === 'forest').length;
            wasteCount = tile.lands.filter((l: LandData) => l.land_type === 'wasteland').length;
            clearedCount = tile.lands.filter((l: LandData) => l.land_type === 'cleared').length;
        }

        const contentDiv = this.tileInfoPanel.querySelector('#info-panel-page-1');
        const titleElement = this.tileInfoPanel.querySelector('#tileInfoTitle');
        if (titleElement) titleElement.textContent = `Tile ${tile.id}`;

        if (contentDiv) {
            contentDiv.innerHTML = `
                <div class="tile-info-row">
                    <span class="label">Terrain:</span>
                    <span class="value terrain-${terrainType.toLowerCase()}">${terrainType}</span>
                </div>
                ${biome ? `
                <div class="tile-info-row">
                    <span class="label">Biome:</span>
                    <span class="value biome-${biome}">${biomeDisplay}</span>
                </div>
                ` : ''}
                ${tile.lands && tile.lands.length > 0 ? `
                <div class="tile-info-row">
                    <span class="label">Land:</span>
                    <span class="value">🌲 ${forestedCount} | 🏜️ ${wasteCount} | 🌱 ${clearedCount}</span>
                </div>
                ` : ''}
                ${fertility !== null ? `
                <div class="tile-info-row">
                    <span class="label">Fertility:</span>
                    <span class="value fertility-${fertility === 0 ? 'barren' : fertility < 30 ? 'poor' : fertility < 60 ? 'fair' : fertility < 80 ? 'good' : 'excellent'}">${fertilityIcon} ${fertilityDisplay}</span>
                </div>
                ` : ''}
                <div class="tile-info-row">
                    <span class="label">Population:</span>
                    <span class="value population-${population > 0 ? 'inhabited' : 'uninhabited'}">${populationDisplay}</span>
                </div>
                <div class="tile-info-row">
                    <span class="label">Habitable:</span>
                    <span class="value Habitable-${Habitable}">${Habitable}</span>
                </div>
            `;
        }

        // Update Villages page with fresh data
        this.updateVillagesPage(tile);
    }

    async updateVillagesPage(tile: HexTile): Promise<void> {
        const villagesPage = this.tileInfoPanel?.querySelector('#info-panel-page-2') as HTMLElement | null;
        if (!villagesPage) return;

        try {
            // Fetch fresh village data for this tile
            const response = await fetch(`/api/villages/tile/${tile.id}`);
            const data = await response.json() as { villages?: VillageApiData[] };
            let villages: VillageApiData[] = data.villages || [];

            // Fallback: if API returns no villages but client-side tile lands contain village info
            // (common when running redis-only without saving to Postgres), build village objects
            // from the tile's lands so the info panel still shows villages.
            if ((!villages || villages.length === 0) && Array.isArray(tile.lands)) {
                const landsWithVillage = tile.lands.filter((l: LandData) => l && (l.village_id || l.village_name));
                if (landsWithVillage.length > 0) {
                    villages = landsWithVillage.map((l: LandData) => ({
                        id: l.village_id || null,
                        tile_id: tile.id as number,
                        land_chunk_index: l.chunk_index,
                        village_name: l.village_name || ('Village ' + (l.village_id || '')),
                        food_stores: l.food_stores || 0,
                        food_capacity: l.food_capacity || 1000,
                        food_production_rate: l.food_production_rate || 0,
                        housing_slots: l.housing_slots || [],
                        housing_capacity: l.housing_capacity || 1000,
                        occupied_slots: Array.isArray(l.housing_slots) ? l.housing_slots.length : (l.occupied_slots || 0)
                    }));
                }
            }

            const villagesCount = villages.length;
            const clearedCount = Array.isArray(tile.lands) ? tile.lands.filter((l: LandData) => l.cleared).length : 0;
            const occupiedSlotsTotal = villages.reduce((sum: number, v: VillageApiData) => {
                const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
                return sum + occ;
            }, 0);
            const capacityTotal = villages.reduce((sum: number, v: VillageApiData) => {
                const cap = v.housing_capacity || 100;
                return sum + cap;
            }, 0);
            const availableSlots = Math.max(0, capacityTotal - occupiedSlotsTotal);
            const totalFoodProduction = villages.reduce((sum: number, v: VillageApiData) => sum + (v.food_production_rate || 0), 0).toFixed(1);
            const totalFoodStockpile = villages.reduce((sum: number, v: VillageApiData) => sum + (v.food_stores || 0), 0).toFixed(0);
            const totalFoodCapacity = villages.reduce((sum: number, v: VillageApiData) => sum + (v.food_capacity || 1000), 0);
            const villageListHtml = villagesCount > 0 ? (`<ul class="village-list">` + villages.map((v: VillageApiData) => {
                const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
                const cap = v.housing_capacity || 100;
                const foodStores = (v.food_stores || 0).toFixed(0);
                const foodCapacity = v.food_capacity || 1000;
                const foodProduction = (v.food_production_rate || 0).toFixed(1);
                return `\n                        <li>
                            <div class="village-name">${v.village_name || ('Village ' + (v.id || ''))}</div>
                            <div class="village-details">Housing: ${occ}/${cap} | Food: ${foodStores}/${foodCapacity} 🍖 (${foodProduction}/sec)</div>
                        </li>`;
            }).join('') + `\n                    </ul>`) : '<div>No villages on this tile.</div>';

            villagesPage.innerHTML = `
                <h3>🏛️ Buildings</h3>
                <p>Manage buildings on this tile.</p>
                <div>Villages: <strong>${villagesCount}/${clearedCount}</strong></div>
                <div>Available Housing Slots: <strong>${availableSlots}</strong></div>
                <div>Total Food Stockpile: <strong>${totalFoodStockpile}/${totalFoodCapacity} 🍖</strong></div>
                <div>Total Food Production: <strong>${totalFoodProduction}/sec</strong></div>
                ${villageListHtml}
                <button id="build-village-btn">Build New Village</button>
            `;

            const buildBtn = villagesPage.querySelector('#build-village-btn') as HTMLElement | null;
            if (buildBtn && !buildBtn.dataset.listenerAttached) {
                buildBtn.addEventListener('click', (e: Event) => {
                    e.preventDefault();
                    const evt = new CustomEvent('tile:buildVillage', { detail: { tileId: tile.id } });
                    window.dispatchEvent(evt);
                });
                buildBtn.dataset.listenerAttached = '1';
            }
        } catch (error: unknown) {
            console.error('Failed to fetch village data:', error);
            villagesPage.innerHTML = `
                <h3>🏛️ Buildings</h3>
                <p>Failed to load village data.</p>
            `;
        }
    }

    ensureCloseButtonAttached(): void {
        // Ensure close button has direct handlers and is attached to the current instance
        if (!this.tileInfoPanel) return;
        const closeBtn = this.tileInfoPanel.querySelector('#closeInfoPanel') as HTMLElement | null;
        if (!closeBtn) return;
        const ctx = getAppContext();
        // If already attached and not debugging, skip reattaching
        if (closeBtn.dataset.listenerAttached && !ctx.tileSelectorDebug) return;

        const handler = (ev: Event): void => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (_: unknown) { /* ignore */ }
            if (ctx.tileSelectorDebug) console.debug('closeInfoPanel direct handler fired (ensure)', ev ? ev.target : null);
            try { if (ctx.tileSelector && typeof ctx.tileSelector.hideInfoPanel === 'function') ctx.tileSelector.hideInfoPanel(); } catch (_: unknown) { /* ignore */ }
            try { if (ctx.tileSelector && typeof ctx.tileSelector.deselectAll === 'function') ctx.tileSelector.deselectAll(); } catch (_: unknown) { /* ignore */ }
        };
        // remove any previous handlers bound with same signature to avoid duplicates
        try { closeBtn.removeEventListener('click', handler, true); } catch (_: unknown) { /* ignore */ }
        try { closeBtn.removeEventListener('pointerup', handler, true); } catch (_: unknown) { /* ignore */ }
        closeBtn.addEventListener('click', handler, true);
        closeBtn.addEventListener('pointerup', handler, true);
        closeBtn.dataset.listenerAttached = '1';
    }

    hideInfoPanel(): void {
        if (this.tileInfoPanel) {
            this.tileInfoPanel.classList.add('hidden');
            if (this.infoRefreshInterval) {
                clearInterval(this.infoRefreshInterval);
                this.infoRefreshInterval = null;
                this.infoRefreshTileId = null;
            }
        }
    }

    deselectAll(): void {
        this.removeBorder();
        this.hideInfoPanel();
        this.selectedTile = null;
    }

    getSelectedTile(): HexTile | null {
        return this.selectedTile;
    }
}

export default TileSelector;
