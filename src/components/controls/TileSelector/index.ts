// TileSelector - Main Orchestrator
// Handles tile selection, borders, and info panel coordination
// Optimized with request deduplication, debouncing, and proper cleanup
import * as THREE from 'three';
import { getAppContext } from '../../../core/AppContext';
import { HexTile, SceneManagerLike } from './types';
import { createTileBorder, removeTileBorder } from './tileBorder';
import { updateInfoPanel } from './infoPanel';
import { updateVillagesPage } from './villagesPage';

// Re-export types
export type { HexTile, LandData, VillageApiData, SceneManagerLike, HexasphereData, BoundaryPoint } from './types';

class TileSelector {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private raycaster: THREE.Raycaster;
    public selectedTile: HexTile | null;
    private borderLines: THREE.Group | null;
    private tileInfoPanel: HTMLElement | null;
    private infoRefreshInterval: ReturnType<typeof setInterval> | null;
    public infoRefreshTileId: number | string | null;

    // Request management
    private abortController: AbortController | null = null;
    private lastFetchTime = 0;
    private isFetching = false;
    private readonly FETCH_DEBOUNCE_MS = 300; // Debounce rapid clicks
    private readonly REFRESH_INTERVAL_MS = 5000; // Reduced from 1000ms to 5000ms

    // Cached vectors to avoid allocations
    private static readonly _mouseVec = new THREE.Vector2();
    private static readonly _tileCenter = new THREE.Vector3();

    // Store bound methods to avoid creating new functions each time
    private boundHandleClick: (event: MouseEvent) => void;
    private boundDocumentClick: ((e: Event) => void) | null = null;
    private boundDocumentKeydown: ((e: KeyboardEvent) => void) | null = null;

    // Render-on-demand callback
    private onChange: (() => void) | null = null;

    constructor(scene: THREE.Scene, camera: THREE.Camera, _sceneManager: SceneManagerLike, onChange?: (() => void) | null) {
        this.scene = scene;
        this.camera = camera;
        this.onChange = onChange || null;
        this.raycaster = new THREE.Raycaster();
        this.selectedTile = null;
        this.borderLines = null;
        this.tileInfoPanel = document.getElementById('tileInfoPanel');
        this.infoRefreshInterval = null;
        this.infoRefreshTileId = null;

        // Pre-bind methods to avoid creating new closures
        this.boundHandleClick = this.handleClick.bind(this);

        // Expose instance via AppContext
        const ctx = getAppContext();
        ctx.tileSelector = this;
        (window as unknown as { tileSelector: TileSelector }).tileSelector = this;

        // Single event delegation for close button (store references for cleanup)
        this.boundDocumentClick = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target?.closest('#closeInfoPanel, .close-info-panel')) {
                e.preventDefault();
                e.stopPropagation();
                getAppContext().tileSelector?.deselectAll();
            }
        };
        this.boundDocumentKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                getAppContext().tileSelector?.deselectAll();
            }
        };
        document.addEventListener('click', this.boundDocumentClick, true);
        document.addEventListener('keydown', this.boundDocumentKeydown);
    }

    handleClick(event: MouseEvent): void {
        if (this.tileInfoPanel?.contains(event.target as Node)) return;

        const target = event.target as HTMLElement;
        const rect = target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        TileSelector._mouseVec.set(mouseX, mouseY);
        this.raycaster.setFromCamera(TileSelector._mouseVec, this.camera);

        const currentTiles = getAppContext().currentTiles || [];
        const intersects = this.raycaster.intersectObjects(currentTiles);

        if (intersects.length > 0) {
            const closestTile = this.findClosestTile(intersects[0].point);
            if (closestTile) {
                this.selectTile(closestTile);
            }
        } else {
            this.deselectAll();
        }
    }

    findClosestTile(intersectionPoint: THREE.Vector3): HexTile | null {
        const tiles = getAppContext().getHexasphereTiles() as HexTile[];
        if (!tiles?.length) return null;

        let closestTile: HexTile | null = null;
        let minDistanceSq = Infinity;

        // Reuse cached vector and use squared distance to avoid sqrt per tile
        for (const tile of tiles) {
            // Handle both array [x,y,z] and object {x,y,z} formats
            const cp = tile.centerPoint;
            if (Array.isArray(cp)) {
                TileSelector._tileCenter.set(cp[0], cp[1], cp[2]);
            } else {
                TileSelector._tileCenter.set(cp.x, cp.y, cp.z);
            }
            const distanceSq = intersectionPoint.distanceToSquared(TileSelector._tileCenter);
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                closestTile = tile;
            }
        }

        return closestTile;
    }

    selectTile(tile: HexTile): void {
        // Toggle off if same tile
        if (this.selectedTile?.id === tile.id) {
            this.deselectAll();
            return;
        }

        this.removeBorder();
        this.createBorder(tile);
        this.selectedTile = tile;

        // Fetch detailed tile data on-demand and show panel
        this.fetchAndShowTileDetails(tile);
    }

    /**
     * Fetch detailed tile data from server and update the panel
     * Includes debouncing and request deduplication
     */
    private async fetchAndShowTileDetails(tile: HexTile): Promise<void> {
        // Show panel immediately with basic data
        this.showInfoPanel(tile);

        // Debounce rapid selections
        const now = Date.now();
        if (now - this.lastFetchTime < this.FETCH_DEBOUNCE_MS) {
            return;
        }
        this.lastFetchTime = now;

        // Cancel any pending request
        this.cancelPendingRequest();

        try {
            // Fetch tile data and Rust population in parallel
            const [data, rustData] = await Promise.all([
                this.fetchTileData(tile.id),
                this.fetchRustTilePopulation(tile.id)
            ]);
            
            if (data) {
                tile.lands = data.lands;
                tile.fertility = data.fertility;
            }
            if (rustData !== null) {
                tile.rustPopulation = rustData;
            }
            this.updatePanel(tile);
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                console.warn(`Failed to fetch detailed tile data for tile ${tile.id}:`, error);
            }
        }
    }

    /**
     * Fetch Rust ECS population for a tile
     */
    private async fetchRustTilePopulation(tileId: number | string): Promise<number | null> {
        try {
            const response = await fetch(`/api/rust/tiles/${tileId}`, {
                signal: this.abortController?.signal
            });
            if (response.ok) {
                const data = await response.json();
                return data.population ?? null;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Fetch tile data with timeout and abort support
     */
    private async fetchTileData(tileId: number | string): Promise<{ lands?: any; fertility?: number } | null> {
        if (this.isFetching) return null;
        
        this.isFetching = true;
        this.abortController = new AbortController();

        try {
            // Set timeout for the request
            const timeoutId = setTimeout(() => {
                this.abortController?.abort();
            }, 10000); // 10 second timeout

            const response = await fetch(`/api/tiles/${tileId}`, {
                signal: this.abortController.signal
            });
            
            clearTimeout(timeoutId);

            if (response.ok) {
                return await response.json();
            }
            return null;
        } finally {
            this.isFetching = false;
            this.abortController = null;
        }
    }

    /**
     * Cancel any in-flight request
     */
    private cancelPendingRequest(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isFetching = false;
    }

    createBorder(tile: HexTile): void {
        this.borderLines = createTileBorder(tile);
        this.scene.add(this.borderLines);
        if (this.onChange) this.onChange();
    }

    removeBorder(): void {
        removeTileBorder(this.scene, this.borderLines);
        this.borderLines = null;
        if (this.onChange) this.onChange();
    }

    showInfoPanel(tile: HexTile): void {
        if (!this.tileInfoPanel) return;

        this.stopRefresh();
        this.updatePanel(tile);

        // Show panel and reset to page 1
        this.tileInfoPanel.classList.remove('hidden');
        this.tileInfoPanel.style.cssText = 'opacity:1;transform:translateY(0);pointer-events:auto;display:flex;';

        // Ensure page1 is active using CSS classes
        this.tileInfoPanel.querySelectorAll('.info-panel-page').forEach((page, idx) => {
            page.classList.toggle('hidden', idx !== 0);
        });
        this.tileInfoPanel.querySelectorAll('.info-panel-btn').forEach((btn, idx) => {
            btn.classList.toggle('active', idx === 0);
        });

        // Start periodic refresh with reduced frequency (5s instead of 1s)
        this.infoRefreshTileId = tile.id;
        
        // Capture only primitive values to avoid closing over `this`
        const refreshFn = () => {
            // Check if still valid before doing anything
            if (!this.tileInfoPanel || !this.selectedTile) {
                this.stopRefresh();
                return;
            }
            
            if (this.tileInfoPanel.classList.contains('hidden')) {
                this.stopRefresh();
                return;
            }
            
            // Skip if already fetching
            if (this.isFetching) return;
            
            // Store ID locally to avoid race conditions
            const currentTileId = this.selectedTile.id;
            
            this.fetchTileData(currentTileId).then(data => {
                // Only update if still looking at the same tile
                if (data && this.selectedTile?.id === currentTileId) {
                    this.selectedTile.lands = data.lands;
                    this.selectedTile.fertility = data.fertility;
                    this.updatePanel(this.selectedTile);
                }
            }).catch(() => {
                // Ignore errors
            });
        };
        
        this.infoRefreshInterval = setInterval(refreshFn, this.REFRESH_INTERVAL_MS);
    }

    private updatePanel(tile: HexTile): void {
        if (!this.tileInfoPanel) return;
        updateInfoPanel(this.tileInfoPanel, tile);
        updateVillagesPage(this.tileInfoPanel, tile);
    }

    private stopRefresh(): void {
        if (this.infoRefreshInterval) {
            clearInterval(this.infoRefreshInterval);
            this.infoRefreshInterval = null;
        }
        this.infoRefreshTileId = null;
        this.cancelPendingRequest();
    }

    hideInfoPanel(): void {
        if (this.tileInfoPanel) {
            this.tileInfoPanel.classList.add('hidden');
            // Clear inline styles that may override the hidden class
            this.tileInfoPanel.style.opacity = '';
            this.tileInfoPanel.style.transform = '';
            this.tileInfoPanel.style.pointerEvents = '';
            this.tileInfoPanel.style.display = '';
            this.stopRefresh();
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

    /**
     * Clean up resources when component is destroyed
     */
    destroy(): void {
        this.stopRefresh();
        this.removeBorder();

        // Remove document event listeners to prevent memory leaks
        if (this.boundDocumentClick) {
            document.removeEventListener('click', this.boundDocumentClick, true);
            this.boundDocumentClick = null;
        }
        if (this.boundDocumentKeydown) {
            document.removeEventListener('keydown', this.boundDocumentKeydown);
            this.boundDocumentKeydown = null;
        }

        // Clear all references to help GC
        this.selectedTile = null;
        this.tileInfoPanel = null;
        this.scene = null as any;
        this.camera = null as any;
        this.raycaster = null as any;
        this.borderLines = null;
        this.onChange = null;

        // Remove from global references
        const ctx = getAppContext();
        if (ctx.tileSelector === this) {
            ctx.tileSelector = null;
        }
        (window as unknown as { tileSelector?: TileSelector | null }).tileSelector = null;
    }
}

export default TileSelector;
