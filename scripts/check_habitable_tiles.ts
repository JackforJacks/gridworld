// Check which tiles are habitable and which have villages
import Redis from 'ioredis';

const redis = new Redis();

async function main() {
    try {
        // Get all tiles from Redis
        const tileData = await redis.hgetall('tile');
        const landsData = await redis.hgetall('tile:lands');

        // Parse tiles
        const tiles: Record<string, any> = {};
        for (const [tileId, json] of Object.entries(tileData || {})) {
            tiles[tileId] = JSON.parse(json as string);
        }

        // Find habitable tiles with cleared lands
        const habitableIds: number[] = [];
        for (const [tileId, tile] of Object.entries(tiles)) {
            if (tile.is_habitable) {
                const landsJson = landsData[tileId];
                if (landsJson) {
                    const lands = JSON.parse(landsJson as string);
                    if (lands.some((l: any) => l.cleared)) {
                        habitableIds.push(parseInt(tileId));
                    }
                }
            }
        }

        console.log('Total habitable tiles with cleared lands:', habitableIds.length);

        // Get villages first to know which tiles to check
        const villages = await redis.hgetall('village');
        const villageTileIds = new Set<number>();
        for (const [vid, vjson] of Object.entries(villages || {})) {
            const v = JSON.parse(vjson as string);
            if (v.tile_id) villageTileIds.add(v.tile_id);
        }

        console.log('\n--- Villages and their tiles ---');
        for (const [vid, vjson] of Object.entries(villages || {})) {
            const v = JSON.parse(vjson as string);
            const tile = tiles[v.tile_id?.toString()];
            if (tile) {
                const status = tile.is_habitable ? '✅' : '❌ BAD';
                console.log(`${status} Village ${vid}: tile ${v.tile_id}, terrain=${tile.terrain_type}, biome=${tile.biome || 'none'}, is_habitable=${tile.is_habitable}`);
            } else {
                console.log(`❌ Village ${vid}: tile ${v.tile_id} NOT FOUND in tiles`);
            }
        }

        // Count bad villages
        let badCount = 0;
        for (const [vid, vjson] of Object.entries(villages || {})) {
            const v = JSON.parse(vjson as string);
            const tile = tiles[v.tile_id?.toString()];
            if (!tile || !tile.is_habitable) badCount++;
        }

        console.log(`\n${badCount > 0 ? '❌' : '✅'} ${badCount} villages on uninhabitable tiles out of ${Object.keys(villages || {}).length} total`);

    } finally {
        await redis.quit();
    }
}

main().catch(console.error);
