// Tile Selector Module
// Handles tile selection, borders, and popups

class TileSelector {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
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
    }

    findClosestTile(intersectionPoint) {
        if (!window.hexasphere || !window.hexasphere.tiles) {
            return null;
        }
        
        let closestTile = null;
        let minDistance = Infinity;
        
        window.hexasphere.tiles.forEach(tile => {
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
        
        // Create multiple thin lines offset slightly to simulate thickness
        for (let offset = 0; offset < 3; offset++) {
            const borderGeometry = new THREE.BufferGeometry();
            const borderVertices = [];
            const offsetScale = offset * 0.01;
            
            // Create lines around the tile boundary with validation
            for (let i = 0; i < tile.boundary.length; i++) {
                const current = tile.boundary[i];
                const next = tile.boundary[(i + 1) % tile.boundary.length];
                
                // Validate coordinates
                if (current && next && 
                    !isNaN(current.x) && !isNaN(current.y) && !isNaN(current.z) &&
                    !isNaN(next.x) && !isNaN(next.y) && !isNaN(next.z)) {
                    
                    // Apply small offset to create thickness effect
                    const currentVec = new THREE.Vector3(current.x, current.y, current.z);
                    const nextVec = new THREE.Vector3(next.x, next.y, next.z);
                    
                    // Normalize and apply offset
                    currentVec.normalize().multiplyScalar(30 + offsetScale);
                    nextVec.normalize().multiplyScalar(30 + offsetScale);
                    
                    borderVertices.push(currentVec.x, currentVec.y, currentVec.z);
                    borderVertices.push(nextVec.x, nextVec.y, nextVec.z);
                }
            }
            
            if (borderVertices.length > 0) {
                borderGeometry.setAttribute('position', new THREE.Float32BufferAttribute(borderVertices, 3));
                
                const borderMaterial = new THREE.LineBasicMaterial({
                    color: 0xff0000,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.8 - (offset * 0.1)
                });
                
                const borderLine = new THREE.LineSegments(borderGeometry, borderMaterial);
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
        
        try {
            if (tile.centerPoint && typeof tile.centerPoint.getLatLon === 'function') {
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
        
        this.tilePopup.innerHTML = `
            <strong>Tile ${tile.id}</strong><br>
            Lat: ${lat.toFixed(4)}°, Lon: ${lon.toFixed(4)}°<br>
            Boundary points: ${tile.boundary.length}
        `;
        this.tilePopup.style.display = 'block';
        this.tilePopup.style.left = (event.clientX + 10) + 'px';
        this.tilePopup.style.top = (event.clientY + 10) + 'px';
    }

    hidePopup() {
        if (this.tilePopup) {
            this.tilePopup.style.display = 'none';
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

module.exports = TileSelector;
