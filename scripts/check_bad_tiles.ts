// Check specific tiles in Redis
import Redis from 'ioredis';

const redis = new Redis();

async function main() {
    // Check the specific tiles that were bad
    const tile823 = await redis.hget('tile', '823');
    const tile575 = await redis.hget('tile', '575');

    console.log('Tile 823:', tile823 ? JSON.parse(tile823) : 'NOT FOUND');
    console.log('Tile 575:', tile575 ? JSON.parse(tile575) : 'NOT FOUND');

    // Check lands for these tiles
    const lands823 = await redis.hget('tile:lands', '823');
    const lands575 = await redis.hget('tile:lands', '575');

    console.log('\nTile 823 has lands:', !!lands823);
    console.log('Tile 575 has lands:', !!lands575);

    await redis.quit();
}

main().catch(console.error);
