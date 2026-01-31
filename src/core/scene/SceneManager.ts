// Scene Manager Module
// Re-exports from modular structure for backward compatibility
// All implementation moved to ./SceneManager/ directory

import SceneManager from './SceneManager/index';

// Re-export types for consumers
export type {
    BoundaryPoint,
    HexTile,
    TileColorInfo,
    HexasphereData,
    TileDataResponse,
    PopulationStats,
    TileProperties
} from './SceneManager/types';

export default SceneManager;
