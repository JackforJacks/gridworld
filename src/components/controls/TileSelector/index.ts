// TileSelector - Main Orchestrator
// Handles tile selection, borders, and info panel coordination
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

    constructor(scene: THREE.Scene, camera: THREE.Camera, _sceneManager: SceneManagerLike) {
        this.scene = scene;
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        this.selectedTile = null;
        this.borderLines = null;
        this.tileInfoPanel = document.getElementById('tileInfoPanel');
        this.infoRefreshInterval = null;
        this.infoRefreshTileId = null;

        // Expose instance via AppContext
        const ctx = getAppContext();
        ctx.tileSelector = this;
        (window as unknown as { tileSelector: TileSelector }).tileSelector = this;

        // Single event delegation for close button
        if (!ctx.tileSelectorCloseHandlerAttached) {
            document.addEventListener('click', (e: Event) => {
                const target = e.target as HTMLElement;
                if (target?.closest('#closeInfoPanel, .close-info-panel')) {
                    e.preventDefault();
                    e.stopPropagation();
                    getAppContext().tileSelector?.deselectAll();
                }
            }, true);

            // Escape key to close
            document.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    getAppContext().tileSelector?.deselectAll();
                }
            });

            ctx.tileSelectorCloseHandlerAttached = true;
        }
    }

    handleClick(event: MouseEvent): void {
        if (this.tileInfoPanel?.contains(event.target as Node)) return;

        const target = event.target as HTMLElement;
        const rect = target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);

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
        let minDistance = Infinity;

        for (const tile of tiles) {
            const center = new THREE.Vector3(tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z);
            const distance = intersectionPoint.distanceTo(center);
            if (distance < minDistance) {
                minDistance = distance;
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
        this.showInfoPanel(tile);
    }

    createBorder(tile: HexTile): void {
        this.borderLines = createTileBorder(tile);
        this.scene.add(this.borderLines);
    }

    removeBorder(): void {
        removeTileBorder(this.scene, this.borderLines);
        this.borderLines = null;
    }

    showInfoPanel(tile: HexTile): void {
        if (!this.tileInfoPanel) return;

        this.stopRefresh();
        this.updatePanel(tile);

        // Show panel
        this.tileInfoPanel.classList.remove('hidden');
        this.tileInfoPanel.style.display = 'block';

        // Ensure page1 is active
        const page1 = this.tileInfoPanel.querySelector('#info-panel-page-1') as HTMLElement | null;
        const page2 = this.tileInfoPanel.querySelector('#info-panel-page-2') as HTMLElement | null;
        if (page1) page1.style.display = '';
        if (page2) page2.style.display = 'none';

        // Start periodic refresh
        this.infoRefreshTileId = tile.id;
        this.infoRefreshInterval = setInterval(() => {
            if (!this.tileInfoPanel?.classList.contains('hidden') && this.selectedTile) {
                this.updatePanel(this.selectedTile);
            } else {
                this.stopRefresh();
            }
        }, 1000);
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
            this.infoRefreshTileId = null;
        }
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
}

export default TileSelector;
