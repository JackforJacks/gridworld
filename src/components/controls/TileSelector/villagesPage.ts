// TileSelector - Villages Page Rendering
// Handles the buildings/villages page in the info panel
import { HexTile, LandData, VillageApiData } from './types';

/**
 * Build village data from tile lands (fallback when API returns empty)
 */
function buildVillagesFromLands(tile: HexTile): VillageApiData[] {
    if (!Array.isArray(tile.lands)) return [];

    return tile.lands
        .filter((l: LandData) => l?.village_id || l?.village_name)
        .map((l: LandData) => ({
            id: l.village_id || null,
            tile_id: tile.id as number,
            land_chunk_index: l.chunk_index,
            village_name: l.village_name || `Village ${l.village_id || ''}`,
            food_stores: l.food_stores || 0,
            food_capacity: l.food_capacity || 1000,
            food_production_rate: l.food_production_rate || 0,
            housing_slots: l.housing_slots || [],
            housing_capacity: l.housing_capacity || 1000,
            occupied_slots: Array.isArray(l.housing_slots) ? l.housing_slots.length : (l.occupied_slots || 0)
        }));
}

/**
 * Calculate village statistics
 */
function calculateVillageStats(villages: VillageApiData[]) {
    let occupiedTotal = 0;
    let capacityTotal = 0;
    let foodProduction = 0;
    let foodStockpile = 0;
    let foodCapacity = 0;

    for (const v of villages) {
        occupiedTotal += Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
        capacityTotal += v.housing_capacity || 100;
        foodProduction += v.food_production_rate || 0;
        foodStockpile += v.food_stores || 0;
        foodCapacity += v.food_capacity || 1000;
    }

    return {
        occupiedTotal,
        capacityTotal,
        availableSlots: Math.max(0, capacityTotal - occupiedTotal),
        foodProduction: foodProduction.toFixed(1),
        foodStockpile: foodStockpile.toFixed(0),
        foodCapacity
    };
}

/**
 * Generate village list HTML
 */
function generateVillageListHTML(villages: VillageApiData[]): string {
    if (villages.length === 0) {
        return '<div>No villages on this tile.</div>';
    }

    const items = villages.map(v => {
        const occ = Array.isArray(v.housing_slots) ? v.housing_slots.length : (v.occupied_slots || 0);
        const cap = v.housing_capacity || 100;
        const foodStores = (v.food_stores || 0).toFixed(0);
        const foodCap = v.food_capacity || 1000;
        const foodProd = (v.food_production_rate || 0).toFixed(1);

        return `
            <li>
                <div class="village-name">${v.village_name || `Village ${v.id || ''}`}</div>
                <div class="village-details">Housing: ${occ}/${cap} | Food: ${foodStores}/${foodCap} 🍖 (${foodProd}/sec)</div>
            </li>`;
    }).join('');

    return `<ul class="village-list">${items}</ul>`;
}

/**
 * Generate full villages page HTML
 */
function generateVillagesPageHTML(villages: VillageApiData[], clearedCount: number): string {
    const stats = calculateVillageStats(villages);

    return `
        <h3>🏛️ Buildings</h3>
        <p>Manage buildings on this tile.</p>
        <div>Villages: <strong>${villages.length}/${clearedCount}</strong></div>
        <div>Available Housing Slots: <strong>${stats.availableSlots}</strong></div>
        <div>Total Food Stockpile: <strong>${stats.foodStockpile}/${stats.foodCapacity} 🍖</strong></div>
        <div>Total Food Production: <strong>${stats.foodProduction}/sec</strong></div>
        ${generateVillageListHTML(villages)}
        <button id="build-village-btn">Build New Village</button>
    `;
}

/**
 * Update the villages page with tile data
 */
export async function updateVillagesPage(panel: HTMLElement, tile: HexTile): Promise<void> {
    const villagesPage = panel.querySelector('#info-panel-page-2') as HTMLElement | null;
    if (!villagesPage) return;

    try {
        // Fetch village data from API
        const response = await fetch(`/api/villages/tile/${tile.id}`);
        const data = await response.json() as { villages?: VillageApiData[] };
        let villages = data.villages || [];

        // Fallback to tile lands if API returns empty
        if (villages.length === 0) {
            villages = buildVillagesFromLands(tile);
        }

        const clearedCount = Array.isArray(tile.lands)
            ? tile.lands.filter((l: LandData) => l.cleared).length
            : 0;

        villagesPage.innerHTML = generateVillagesPageHTML(villages, clearedCount);

        // Attach build button listener
        const buildBtn = villagesPage.querySelector('#build-village-btn') as HTMLElement | null;
        if (buildBtn && !buildBtn.dataset.listenerAttached) {
            buildBtn.addEventListener('click', (e: Event) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('tile:buildVillage', { detail: { tileId: tile.id } }));
            });
            buildBtn.dataset.listenerAttached = '1';
        }
    } catch (error: unknown) {
        console.error('Failed to fetch village data:', error);
        villagesPage.innerHTML = `
            <h3>🏛️ Buildings</h3>
            <p>Failed to load village data.</p>
        `;
    }
}
