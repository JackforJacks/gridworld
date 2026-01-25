// Tile Selector Module
// Handles tile selection, borders, and popups

class TileSelector {
    constructor(scene, camera, sceneManager) {
        this.scene = scene;
        this.camera = camera;
        this.sceneManager = sceneManager;
        this.raycaster = new THREE.Raycaster();
        this.selectedTile = null;
        this.borderLines = null;
        this.tileInfoPanel = document.getElementById('tileInfoPanel');
        this.closeInfoPanelBtn = document.getElementById('closeInfoPanel');

        this.borderMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            depthTest: false,
            transparent: true,
            opacity: 1
        });
        this.infoRefreshInterval = null;
        this.infoRefreshTileId = null;

        // Add close button event listener
        if (this.closeInfoPanelBtn) {
            this.closeInfoPanelBtn.addEventListener('click', () => {
                this.hideInfoPanel();
                this.deselectAll();
            });
        }
    }

    handleClick(event) {
        // Check if the click is on the info panel - if so, ignore it
        if (this.tileInfoPanel && this.tileInfoPanel.contains(event.target)) {
            return;
        }

        const rect = event.target.getBoundingClientRect();
        const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera({ x: mouseX, y: mouseY }, this.camera);

        // Get current tiles from window
        const currentTiles = window.currentTiles || [];
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
    } findClosestTile(intersectionPoint) {
        if (!window.sceneManager || !window.sceneManager.hexasphere || !window.sceneManager.hexasphere.tiles) {
            return null;
        }

        let closestTile = null;
        let minDistance = Infinity;

        window.sceneManager.hexasphere.tiles.forEach(tile => {
            const tileCenter = new THREE.Vector3(tile.centerPoint.x, tile.centerPoint.y, tile.centerPoint.z);
            const distance = intersectionPoint.distanceTo(tileCenter);

            if (distance < minDistance) {
                minDistance = distance;
                closestTile = tile;
            }
        });

        return closestTile;
    }

    selectTile(tile, event) {
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

    createBorder(tile) {
        const borderGroup = new THREE.Group();

        // Create multiple border layers for glowing yellow effect
        for (let offset = 0; offset < 4; offset++) {
            const borderGeometry = new THREE.BufferGeometry();
            const borderVertices = [];
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

    removeBorder() {
        if (this.borderLines) {
            this.scene.remove(this.borderLines);
            this.borderLines = null;
        }
    }

    showInfoPanel(tile) {
        if (!this.tileInfoPanel) return;
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
            this.tileInfoPanel.classList.remove('hidden');
            const page1 = this.tileInfoPanel.querySelector('#info-panel-page-1');
            const page2 = this.tileInfoPanel.querySelector('#info-panel-page-2');
            if (page1) page1.style.display = '';
            if (page2) page2.style.display = 'none';
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
                this.updateInfoPanel(this.selectedTile);
            } catch (e) {
                console.warn('Error refreshing info panel:', e);
            }
        }, 1000);
    }

    updateInfoPanel(tile) {
        if (!this.tileInfoPanel || !tile) return;

        let lat = 0, lon = 0;
        let Habitable = 'unknown';
        let terrainType = 'unknown';

        try {
            if (tile.latitude !== null && tile.longitude !== null) {
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
        } catch (e) {
            console.warn("Could not get lat/lon for tile:", tile.id, e);
        }

        try {
            Habitable = tile.Habitable || 'unknown';
            terrainType = tile.terrainType || 'unknown';
        } catch (e) {
            console.warn("Could not get tile data for tile:", tile.id, e);
        }

        const population = tile.population || 0;
        const populationDisplay = population > 0 ? population.toLocaleString() : 'Uninhabited';

        const biome = tile.biome || null;
        const biomeIcons = { tundra: '🏔️', desert: '🏜️', plains: '🌾', grassland: '🌱', alpine: '⛰️' };
        const biomeDisplay = biome ? `${biomeIcons[biome] || '🌍'} ${biome.charAt(0).toUpperCase() + biome.slice(1)}` : 'N/A';

        const fertility = tile.fertility !== undefined ? tile.fertility : null;
        const fertilityDisplay = fertility !== null ? `${fertility}/100` : 'N/A';
        const fertilityIcon = fertility !== null ? (fertility === 0 ? '🪨' : fertility < 30 ? '🌫️' : fertility < 60 ? '🌿' : fertility < 80 ? '🌾' : '🌻') : '❓';

        let forestedCount = 0, wasteCount = 0, clearedCount = 0;
        if (Array.isArray(tile.lands)) {
            forestedCount = tile.lands.filter(l => l.land_type === 'forest').length;
            wasteCount = tile.lands.filter(l => l.land_type === 'wasteland').length;
            clearedCount = tile.lands.filter(l => l.land_type === 'cleared').length;
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

        // Update Villages page
        const villagesPage = this.tileInfoPanel.querySelector('#info-panel-page-2');
        if (villagesPage) {
            let villageEntries = [];
            if (Array.isArray(tile.lands)) villageEntries = tile.lands.filter(l => l.village_id !== null && l.village_id !== undefined);
            const villagesCount = villageEntries.length;
            const clearedCountDebug = Array.isArray(tile.lands) ? tile.lands.filter(l => l.cleared).length : 0;
            console.debug(`[TileSelector] tile ${tile.id} terrain=${tile.terrainType} Habitable=${tile.Habitable} lands=${Array.isArray(tile.lands) ? tile.lands.length : 0} cleared=${clearedCountDebug} villages=${villagesCount}`);
            const occupiedSlotsTotal = villageEntries.reduce((sum, v) => {
                const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
                return sum + occ;
            }, 0);
            const capacityTotal = villageEntries.reduce((sum, v) => {
                const cap = v.housing_capacity || 100;
                return sum + cap;
            }, 0);
            const availableSlots = Math.max(0, capacityTotal - occupiedSlotsTotal);
            const villageListHtml = villagesCount > 0 ? (`<ul class="village-list">` + villageEntries.map(v => {
                const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
                const cap = v.housing_capacity || 100;
                return `\n                        <li>${v.village_name || ('Village ' + (v.village_id || ''))} — ${occ}/${cap} slots</li>`;
            }).join('') + `\n                    </ul>`) : '<div>No villages on this tile.</div>';

            villagesPage.innerHTML = `
                <h3>🏛️ Villages</h3>
                <p>Manage villages and buildings on this tile.</p>
                <div>Villages: <strong>${villagesCount}</strong></div>
                <div>Available Housing Slots: <strong>${availableSlots}</strong></div>
                ${villageListHtml}
                <button id="build-village-btn">Build New Village</button>
            `;

            const buildBtn = villagesPage.querySelector('#build-village-btn');
            if (buildBtn && !buildBtn.dataset.listenerAttached) {
                buildBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const evt = new CustomEvent('tile:buildVillage', { detail: { tileId: tile.id } });
                    window.dispatchEvent(evt);
                });
                buildBtn.dataset.listenerAttached = '1';
            }
        }

    }

    hideInfoPanel() {
        if (this.tileInfoPanel) {
            this.tileInfoPanel.className = 'tile-info-panel hidden';
            if (this.infoRefreshInterval) {
                clearInterval(this.infoRefreshInterval);
                this.infoRefreshInterval = null;
                this.infoRefreshTileId = null;
            }
        }
    }

    deselectAll() {
        this.removeBorder();
        this.hideInfoPanel();
        this.selectedTile = null;
    }

    getSelectedTile() {
        return this.selectedTile;
    }
}

export default TileSelector;
