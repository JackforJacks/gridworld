// Scene Manager - Tile Labels
// Displays tile ID numbers on each hexagon using canvas-based sprites
import * as THREE from 'three';
import { HexTile } from './types';

/** Label configuration */
const LABEL_CONFIG = {
    fontSize: 64,
    fontFamily: 'Arial, sans-serif',
    textColor: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 8,
    scale: 0.75,  // Scale factor for sprite size (50x larger)
    heightOffset: 0.05  // How far above the tile center to place the label
};

/**
 * Create a canvas texture with the tile ID
 */
function createLabelTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    ctx.font = `bold ${LABEL_CONFIG.fontSize}px ${LABEL_CONFIG.fontFamily}`;
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = LABEL_CONFIG.fontSize;
    
    // Size canvas to fit text with padding
    canvas.width = textWidth + LABEL_CONFIG.padding * 2;
    canvas.height = textHeight + LABEL_CONFIG.padding * 2;
    
    // Background
    ctx.fillStyle = LABEL_CONFIG.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Text
    ctx.font = `bold ${LABEL_CONFIG.fontSize}px ${LABEL_CONFIG.fontFamily}`;
    ctx.fillStyle = LABEL_CONFIG.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

/**
 * Create a sprite label for a tile
 */
export function createTileLabel(tile: HexTile): THREE.Sprite | null {
    if (!tile.centerPoint) return null;
    
    const texture = createLabelTexture(String(tile.id));
    const material = new THREE.SpriteMaterial({ 
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false
    });
    
    const sprite = new THREE.Sprite(material);
    
    // Position slightly above tile center
    const center = tile.centerPoint;
    const normal = new THREE.Vector3(center.x, center.y, center.z).normalize();
    sprite.position.set(
        center.x + normal.x * LABEL_CONFIG.heightOffset,
        center.y + normal.y * LABEL_CONFIG.heightOffset,
        center.z + normal.z * LABEL_CONFIG.heightOffset
    );
    
    // Scale based on texture aspect ratio
    const aspect = texture.image.width / texture.image.height;
    sprite.scale.set(LABEL_CONFIG.scale * aspect, LABEL_CONFIG.scale, 1);
    
    return sprite;
}

/**
 * Dispose of a label sprite properly
 */
export function disposeLabel(sprite: THREE.Sprite): void {
    if (sprite.material instanceof THREE.SpriteMaterial && sprite.material.map) {
        sprite.material.map.dispose();
    }
    sprite.material.dispose();
}

/**
 * Manages tile label state
 */
export class TileLabelManager {
    private scene: THREE.Scene;
    private labels: Map<string, THREE.Sprite> = new Map();
    private _visible: boolean = false;
    
    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }
    
    /**
     * Add label for a tile
     */
    add(tile: HexTile): void {
        const tileId = String(tile.id);
        
        // Don't add duplicate
        if (this.labels.has(tileId)) return;
        
        const label = createTileLabel(tile);
        if (label) {
            label.visible = this._visible;
            this.scene.add(label);
            this.labels.set(tileId, label);
        }
    }
    
    /**
     * Add labels for multiple tiles
     */
    addAll(tiles: HexTile[]): void {
        for (const tile of tiles) {
            this.add(tile);
        }
    }
    
    /**
     * Remove label for a tile
     */
    remove(tileId: string): void {
        const label = this.labels.get(tileId);
        if (label) {
            this.scene.remove(label);
            disposeLabel(label);
            this.labels.delete(tileId);
        }
    }
    
    /**
     * Toggle visibility of all labels
     */
    setVisible(visible: boolean): void {
        this._visible = visible;
        this.labels.forEach(label => {
            label.visible = visible;
        });
    }
    
    /**
     * Get current visibility
     */
    get visible(): boolean {
        return this._visible;
    }
    
    /**
     * Toggle visibility
     */
    toggle(): boolean {
        this.setVisible(!this._visible);
        return this._visible;
    }
    
    /**
     * Clear all labels
     */
    clear(): void {
        this.labels.forEach((label, _tileId) => {
            this.scene.remove(label);
            disposeLabel(label);
        });
        this.labels.clear();
    }
    
    /**
     * Get label count
     */
    get size(): number {
        return this.labels.size;
    }
}
