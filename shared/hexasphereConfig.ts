/**
 * Hexasphere Configuration Constants
 * 
 * Shared constants for hexasphere generation.
 * Used by both client and server.
 */

export const HEXASPHERE_DEFAULTS = {
    /** Sphere radius (legacy units) */
    RADIUS: 30,
    
    /** Subdivision level - determines tile count: 10n² + 2 tiles */
    SUBDIVISIONS: 12,  // 12 = 1,442 tiles
    
    /** Tile width ratio (1 = touching, <1 = gaps between tiles) */
    TILE_WIDTH_RATIO: 1,
} as const;

// Convenience exports
export const DEFAULT_RADIUS = HEXASPHERE_DEFAULTS.RADIUS;
export const DEFAULT_SUBDIVISIONS = HEXASPHERE_DEFAULTS.SUBDIVISIONS;
export const DEFAULT_TILE_WIDTH_RATIO = HEXASPHERE_DEFAULTS.TILE_WIDTH_RATIO;
