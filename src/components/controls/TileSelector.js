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
        this.tilePopup = document.getElementById('tilePopup');

        this.borderMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            depthTest: false,
            transparent: true,
            opacity: 1
        });
    }

    handleClick(event) {
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

        // Show popup
        this.showPopup(tile, event);

        this.selectedTile = tile;
    }

    createBorder(tile) {
        const borderGroup = new THREE.Group();

        console.log('[TileSelector] Creating border for tile:', tile.id);

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

    showPopup(tile, event) {
        if (!this.tilePopup) return;

        let lat = 0, lon = 0;
        let Habitable = 'unknown';
        let terrainType = 'unknown';

        // Get coordinates directly from tile properties (preferred) or calculate as fallback
        try {
            if (tile.latitude !== null && tile.longitude !== null) {
                // Use pre-calculated coordinates stored on the tile
                lat = tile.latitude;
                lon = tile.longitude;
            } else if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
                const latLon = tile.centerPoint.getLatLon(1);
                lat = latLon.lat;
                lon = latLon.lon;
            } else {
                // Fallback calculation
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

        // Get terrain and Habitable data directly from the tile object
        try {
            // All data is now stored directly on the tile - single source of truth!
            Habitable = tile.Habitable || 'unknown';
            terrainType = tile.terrainType || 'unknown';
        } catch (e) {
            console.warn("Could not get tile data for tile:", tile.id, e);
        }

        // Get population data
        const population = tile.population || 0;
        const populationDisplay = population > 0 ? population.toLocaleString() : 'Uninhabited';

        // Get biome data
        const biome = tile.biome || null;
        const biomeIcons = {
            tundra: '🏔️',
            desert: '🏜️',
            plains: '🌾',
            grassland: '🌱',
            alpine: '⛰️'
        };
        const biomeDisplay = biome ? `${biomeIcons[biome] || '🌍'} ${biome.charAt(0).toUpperCase() + biome.slice(1)}` : 'N/A';

        // Get fertility data
        const fertility = tile.fertility !== undefined ? tile.fertility : null;
        const fertilityDisplay = fertility !== null ? `${fertility}/100` : 'N/A';
        const fertilityIcon = fertility !== null ? (fertility === 0 ? '🪨' : fertility < 30 ? '🌫️' : fertility < 60 ? '🌿' : fertility < 80 ? '🌾' : '🌻') : '❓';

        this.tilePopup.innerHTML = `
            <div class="tile-popup-header">
                <strong>Tile ${tile.id}</strong>
            </div>
            <div class="tile-popup-content">
                <div class="tile-popup-row">
                    <span class="label">Location:</span>
                    <span class="value">${lat.toFixed(2)}°, ${lon.toFixed(2)}°</span>
                </div>
                <div class="tile-popup-row">
                    <span class="label">Terrain:</span>
                    <span class="value terrain-${terrainType.toLowerCase()}">${terrainType}</span>
                </div>
                ${biome ? `
                <div class="tile-popup-row">
                    <span class="label">Biome:</span>
                    <span class="value biome-${biome}">${biomeDisplay}</span>
                </div>
                ` : ''}
                ${fertility !== null ? `
                <div class="tile-popup-row">
                    <span class="label">Fertility:</span>
                    <span class="value fertility-${fertility === 0 ? 'barren' : fertility < 30 ? 'poor' : fertility < 60 ? 'fair' : fertility < 80 ? 'good' : 'excellent'}">${fertilityIcon} ${fertilityDisplay}</span>
                </div>
                ` : ''}
                <div class="tile-popup-row">
                    <span class="label">Population:</span>
                    <span class="value population-${population > 0 ? 'inhabited' : 'uninhabited'}">${populationDisplay}</span>
                </div>
                <div class="tile-popup-row">
                    <span class="label">Habitable:</span>
                    <span class="value Habitable-${Habitable}">${Habitable}</span>
                </div>
                <div class="tile-popup-footer">
                    <small>Boundary points: ${tile.boundary.length}</small>
                </div>
            </div>
        `;
        this.tilePopup.className = 'tile-popup visible';
        // this.tilePopup.style.left = (event.clientX + 10) + 'px';
        // this.tilePopup.style.top = (event.clientY + 10) + 'px';
        this.tilePopup.style.setProperty('--popup-left', (event.clientX + 10) + 'px');
        this.tilePopup.style.setProperty('--popup-top', (event.clientY + 10) + 'px');
    }

    hidePopup() {
        if (this.tilePopup) {
            this.tilePopup.className = 'tile-popup hidden';
        }
    }

    deselectAll() {
        this.removeBorder();
        this.hidePopup();
        this.selectedTile = null;
    }

    getSelectedTile() {
        return this.selectedTile;
    }
}

export default TileSelector;
