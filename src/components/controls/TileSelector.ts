// TileSelector Module
// Re-exports from modular structure for backward compatibility
// All implementation moved to ./TileSelector/ directory

import TileSelector from './TileSelector/index';

// Re-export types
export type {
    BoundaryPoint,
    HexTile,
    LandData,
    VillageApiData,
    HexasphereData,
    SceneManagerLike
} from './TileSelector/types';

export default TileSelector;
