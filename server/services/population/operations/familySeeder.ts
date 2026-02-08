// Population Operations - Family Seeder Module
import serverConfig from '../../../config/server';
import idAllocator from '../../idAllocator';
import {
    PersonRecord,
    FamilyRecord,
    CalculatorModule,
    TilePopulationMap,
    TilePopulationTargets
} from './types';
import { getAge } from './helpers';

const PREGNANCY_SEED_RATE = 0.10;
const AVERAGE_CHILDREN_PER_FAMILY = 4;
const MAX_CHILDREN_PER_FAMILY = 10;

export interface SeedFamiliesResult {
    allFamilies: FamilyRecord[];
    allPeople: PersonRecord[]; // Updated with family_ids and potentially new children
}

/**
 * Seeds families for selected tiles with proper pairing and children distribution
 */
export async function seedFamiliesForTiles(
    selectedTiles: number[],
    allPeople: PersonRecord[],
    tilePopulationMap: TilePopulationMap,
    tilePopulationTargets: TilePopulationTargets,
    currentYear: number,
    currentMonth: number,
    currentDay: number,
    calculator: CalculatorModule
): Promise<SeedFamiliesResult> {
    const { getRandomSex, getRandomBirthDate } = calculator;

    // Allocate family IDs based on actual people count
    const estimatedFamilyCount = Math.ceil(allPeople.length * 0.3);
    const familyIds = await idAllocator.getFamilyIdBatch(estimatedFamilyCount);
    let familyIdIndex = 0;

    const allFamilies: FamilyRecord[] = [];

    for (const tile_id of selectedTiles) {
        const tilePeople = tilePopulationMap[tile_id];

        // Find eligible bachelors
        const eligibleMales = tilePeople.filter(p => {
            if (!p.sex || p.family_id !== null) return false;
            const age = getAge(p.date_of_birth, currentYear, currentMonth, currentDay);
            return age >= 16 && age <= 45;
        });

        const eligibleFemales = tilePeople.filter(p => {
            if (p.sex || p.family_id !== null) return false;
            const age = getAge(p.date_of_birth, currentYear, currentMonth, currentDay);
            return age >= 16 && age <= 30;
        });

        // Shuffle for random pairing
        eligibleMales.sort(() => Math.random() - 0.5);
        eligibleFemales.sort(() => Math.random() - 0.5);

        const pairCount = Math.floor(Math.min(eligibleMales.length, eligibleFemales.length) * 0.8);
        if (serverConfig.verboseLogs) {
            console.log(`[Tile ${tile_id}] Eligible: males=${eligibleMales.length}, females=${eligibleFemales.length}, pairs=${pairCount}`);
        }

        const tileFamilies: FamilyRecord[] = [];
        for (let i = 0; i < pairCount; i++) {
            const husband = eligibleMales[i];
            const wife = eligibleFemales[i];
            const familyId = familyIds[familyIdIndex++];

            const family: FamilyRecord = {
                id: familyId,
                husband_id: husband.id,
                wife_id: wife.id,
                tile_id,
                pregnancy: false,
                delivery_date: null,
                children_ids: []
            };

            // Update person family_ids in memory
            husband.family_id = familyId;
            wife.family_id = familyId;

            tileFamilies.push(family);
            allFamilies.push(family);
        }

        // Randomly seed pregnancies for a percentage of families
        seedPregnancies(tileFamilies, currentYear, currentMonth, currentDay);

        // Assign children to families with avg 4, variance 0-10
        await assignChildrenToFamilies(
            tileFamilies,
            tilePeople,
            allPeople,
            tile_id,
            tilePopulationTargets,
            currentYear,
            currentMonth,
            currentDay,
            getRandomSex,
            getRandomBirthDate
        );

        // Safety: ensure we did not exceed the intended tilePopulation -- trim excess if any
        trimExcessPopulation(tilePeople, allPeople, allFamilies, tile_id, tilePopulationTargets);
    }

    if (serverConfig.verboseLogs) {
        console.log(`⏱️ [familySeeder] Created ${allFamilies.length} families across ${selectedTiles.length} tiles`);
    }

    return { allFamilies, allPeople };
}

/**
 * Seeds pregnancies for a percentage of families
 */
function seedPregnancies(
    families: FamilyRecord[],
    currentYear: number,
    currentMonth: number,
    currentDay: number
): void {
    for (const family of families) {
        if (Math.random() < PREGNANCY_SEED_RATE) {
            family.pregnancy = true;
            // Set a random delivery date within the next 8-32 days
            const daysUntilDelivery = 8 + Math.floor(Math.random() * 25);
            const delivery = new Date(currentYear, currentMonth - 1, currentDay);
            delivery.setDate(delivery.getDate() + daysUntilDelivery);
            family.delivery_date = delivery.toISOString().split('T')[0];
        }
    }
}

/**
 * Assigns children to families with average 4 children per family, variance 0-10
 */
async function assignChildrenToFamilies(
    tileFamilies: FamilyRecord[],
    tilePeople: PersonRecord[],
    allPeople: PersonRecord[],
    tile_id: number,
    tilePopulationTargets: TilePopulationTargets,
    currentYear: number,
    currentMonth: number,
    currentDay: number,
    getRandomSex: () => boolean,
    getRandomBirthDate: (year: number, month: number, day: number, age: number) => string
): Promise<void> {
    if (tileFamilies.length === 0) return;

    // Assign each family a random number of children between 0 and 10
    // but guarantee the average is as close as possible to 4
    const childrenCounts: number[] = [];
    const totalFamilies = tileFamilies.length;
    let totalChildren = 0;

    // First, assign random children counts
    for (let i = 0; i < totalFamilies; i++) {
        const n = Math.floor(Math.random() * (MAX_CHILDREN_PER_FAMILY + 1));
        childrenCounts.push(n);
        totalChildren += n;
    }

    // Calculate adjustment needed to hit average of 4
    const desiredTotal = totalFamilies * AVERAGE_CHILDREN_PER_FAMILY;
    let diff = desiredTotal - totalChildren;

    // Adjust up or down to hit the target average
    while (diff !== 0) {
        if (diff > 0) {
            // Add 1 child to a random family below max
            const candidates = childrenCounts
                .map((c, idx) => c < MAX_CHILDREN_PER_FAMILY ? idx : -1)
                .filter(idx => idx !== -1);
            if (candidates.length === 0) break;
            const idx = candidates[Math.floor(Math.random() * candidates.length)];
            childrenCounts[idx]++;
            diff--;
        } else {
            // Remove 1 child from a random family above 0
            const candidates = childrenCounts
                .map((c, idx) => c > 0 ? idx : -1)
                .filter(idx => idx !== -1);
            if (candidates.length === 0) break;
            const idx = candidates[Math.floor(Math.random() * candidates.length)];
            childrenCounts[idx]--;
            diff++;
        }
    }

    // Get available minors (age < 16, no family)
    let minors: PersonRecord[] = tilePeople.filter((p: PersonRecord) => {
        const age = getAge(p.date_of_birth, currentYear, currentMonth, currentDay);
        return age < 16 && p.family_id === null;
    });

    // Compute how many new minors we *can* add without exceeding base tilePopulation
    let needed = childrenCounts.reduce((a, b) => a + b, 0) - minors.length;
    const targetForTile = tilePopulationTargets[tile_id];
    const allowedNew = Math.max(0, (typeof targetForTile === 'number' ? targetForTile : Number.MAX_SAFE_INTEGER) - tilePeople.length);
    needed = Math.min(needed, allowedNew);

    if (needed > 0) {
        const newIds = await idAllocator.getPersonIdBatch(needed);
        for (let j = 0; j < needed; j++) {
            const age = Math.floor(Math.random() * 16);
            const birthDate = getRandomBirthDate(currentYear, currentMonth, currentDay, age);
            const person: PersonRecord = {
                id: newIds[j],
                tile_id,
                residency: tile_id,
                sex: getRandomSex(),
                date_of_birth: birthDate,
                family_id: null
            };
            allPeople.push(person);
            tilePeople.push(person);
            minors.push(person);
        }
    }

    // If we couldn't add enough minors due to tile population cap, reduce childrenCounts to fit available minors
    const totalChildrenNeeded = childrenCounts.reduce((a, b) => a + b, 0);
    if (minors.length < totalChildrenNeeded) {
        if (serverConfig.verboseLogs) {
            console.warn(`[Tile ${tile_id}] Not enough minors to satisfy childrenCounts (${minors.length} available, ${totalChildrenNeeded} requested). Reducing childrenCounts.`);
        }
        // Reduce from families with highest child counts first
        const countsWithIndex = childrenCounts.map((c, idx) => ({ c, idx }));
        countsWithIndex.sort((a, b) => b.c - a.c);
        let remaining = minors.length;
        for (const entry of countsWithIndex) {
            const take = Math.min(entry.c, Math.max(0, remaining));
            childrenCounts[entry.idx] = take;
            remaining -= take;
            if (remaining <= 0) break;
        }
    }

    // Assign minors to families according to childrenCounts
    let minorIdx = 0;
    for (let f = 0; f < tileFamilies.length; f++) {
        for (let c = 0; c < childrenCounts[f]; c++) {
            const child = minors[minorIdx++];
            if (!child) continue; // defensive: skip if missing
            child.family_id = tileFamilies[f].id;
            tileFamilies[f].children_ids.push(child.id);
        }
    }

    if (serverConfig.verboseLogs) {
        console.log(`[Tile ${tile_id}] Assigned children to families (avg 4, 0-10 variance).`);
    }
}

/**
 * Trims excess population if tile exceeded target
 */
function trimExcessPopulation(
    tilePeople: PersonRecord[],
    allPeople: PersonRecord[],
    allFamilies: FamilyRecord[],
    tile_id: number,
    tilePopulationTargets: TilePopulationTargets
): void {
    const target = tilePopulationTargets ? tilePopulationTargets[tile_id] : undefined;
    if (typeof target !== 'undefined' && tilePeople.length > target) {
        const excess = tilePeople.length - target;
        if (serverConfig.verboseLogs) {
            console.warn(`[Tile ${tile_id}] Population exceeded target by ${excess}. Trimming ${excess} extras.`);
        }

        // Build a Set for O(1) lookup of people to remove
        const removed = tilePeople.splice(tilePeople.length - excess, excess);
        const removedIds = new Set(removed.map(p => p.id));

        // Remove from allPeople using filter (more efficient than repeated splice)
        const filteredPeople = allPeople.filter(p => !removedIds.has(p.id));
        allPeople.length = 0;
        allPeople.push(...filteredPeople);

        // Remove from family children lists
        for (const f of allFamilies) {
            if (f && Array.isArray(f.children_ids)) {
                f.children_ids = f.children_ids.filter(id => !removedIds.has(id));
            }
        }
    }
}
