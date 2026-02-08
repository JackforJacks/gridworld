// Population Operations - People Generator Module
import serverConfig from '../../../config/server';
import idAllocator from '../../idAllocator';
import {
    PersonRecord,
    CalculatorModule,
    TilePopulationMap,
    TilePopulationTargets
} from './types';

export interface GeneratePeopleResult {
    allPeople: PersonRecord[];
    tilePopulationMap: TilePopulationMap;
    tilePopulationTargets: TilePopulationTargets;
}

/**
 * Generates people for selected tiles with proper age distribution
 * Includes guaranteed eligible males (16-45) and females (16-30) for family formation
 */
export async function generatePeopleForTiles(
    selectedTiles: number[],
    currentYear: number,
    currentMonth: number,
    currentDay: number,
    calculator: CalculatorModule
): Promise<GeneratePeopleResult> {
    const { getRandomSex, getRandomAge, getRandomBirthDate } = calculator;

    const allPeople: PersonRecord[] = [];
    const tilePopulationMap: TilePopulationMap = {};
    const tilePopulationTargets: TilePopulationTargets = {};

    // Configurable population per tile: RESTART_POP_PER_TILE env var (default 500 for fast dev restarts)
    const popPerTileEnv = process.env.RESTART_POP_PER_TILE;
    const popPerTileMax = popPerTileEnv && !isNaN(parseInt(popPerTileEnv)) ? parseInt(popPerTileEnv) : 500;

    for (const tile_id of selectedTiles) {
        const tilePopulation = Math.floor(100 + Math.random() * (popPerTileMax - 100 + 1)); // 100 to popPerTileMax per tile
        // Use more conservative buffer for large populations to save memory
        const bufferMultiplier = tilePopulation > 10000 ? 1.5 : 2.5;
        const estimatedTilePeople = Math.ceil(tilePopulation * bufferMultiplier);
        const tilePersonIds = await idAllocator.getPersonIdBatch(estimatedTilePeople);
        let tilePersonIndex = 0;

        tilePopulationMap[tile_id] = [];
        // Track the intended target population for this tile (used to prevent over-allocation)
        tilePopulationTargets[tile_id] = tilePopulation;
        const minBachelorsPerSex = Math.floor(tilePopulation * 0.15);

        // Add guaranteed eligible males (16-45)
        for (let i = 0; i < minBachelorsPerSex; i++) {
            const age = 16 + Math.floor(Math.random() * 30);
            const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
            const person: PersonRecord = {
                id: tilePersonIds[tilePersonIndex++],
                tile_id,
                residency: tile_id,
                sex: true,
                date_of_birth: birthDate,
                family_id: null
            };
            allPeople.push(person);
            tilePopulationMap[tile_id].push(person);
        }

        // Add guaranteed eligible females (16-30)
        for (let i = 0; i < minBachelorsPerSex; i++) {
            const age = 16 + Math.floor(Math.random() * 15);
            const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
            const person: PersonRecord = {
                id: tilePersonIds[tilePersonIndex++],
                tile_id,
                residency: tile_id,
                sex: false,
                date_of_birth: birthDate,
                family_id: null
            };
            allPeople.push(person);
            tilePopulationMap[tile_id].push(person);
        }

        // Fill the rest randomly
        const remaining = tilePopulation - (minBachelorsPerSex * 2);
        for (let i = 0; i < remaining; i++) {
            const sex = getRandomSex();
            const age = getRandomAge();
            const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
            const person: PersonRecord = {
                id: tilePersonIds[tilePersonIndex++],
                tile_id,
                residency: tile_id,
                sex,
                date_of_birth: birthDate,
                family_id: null
            };
            allPeople.push(person);
            tilePopulationMap[tile_id].push(person);
        }
    }

    if (serverConfig.verboseLogs) {
        console.log(`⏱️ [peopleGenerator] Generated ${allPeople.length} people across ${selectedTiles.length} tiles`);
    }

    return { allPeople, tilePopulationMap, tilePopulationTargets };
}
