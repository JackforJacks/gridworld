// StatsRenderer - Statistics modal HTML generation and chart rendering
// Extracted from UIManager for single-responsibility

import type { Demographics, VitalStatistics } from '../../services/api/ApiClient';

// ============ Interfaces ============

interface StatsData {
    totalPopulation?: number;
    totalTiles?: number;
    habitableTiles?: number;
    populatedTiles?: number;
    highPopulationTiles?: number;
    threshold?: number;
    redTiles?: number;
    biomes?: {
        tundra: { tiles: number; population: number };
        desert: { tiles: number; population: number };
        plains: { tiles: number; population: number };
        grassland: { tiles: number; population: number };
        alpine: { tiles: number; population: number };
    };
}

interface ChartInstance {
    destroy(): void;
}

interface ExtendedWindow {
    Chart?: {
        new(ctx: CanvasRenderingContext2D, config: Record<string, unknown>): ChartInstance;
    };
    vitalRatesChartInstance?: ChartInstance;
}

const extendedWindow = window as unknown as ExtendedWindow;

export type { StatsData };

// ============ Formatting Helpers ============

function fmt(value: number | undefined, fallback = 'N/A'): string {
    return value !== undefined ? value.toLocaleString() : fallback;
}

function fmtPct(value: number | undefined, fallback = '0.00'): string {
    return value !== undefined ? value.toFixed(2) : fallback;
}

function statRow(label: string, value: string, id?: string): string {
    const idAttr = id ? ` id="${id}"` : '';
    return `<p><strong>${label}:</strong> <span${idAttr}>${value}</span></p>`;
}

function biomeRow(label: string, biome: { tiles: number; population: number }): string {
    return `<p><strong>${label}:</strong> ${biome.tiles} tiles (${biome.population.toLocaleString()} people)</p>`;
}

// ============ HTML Generation ============

export function generateStatsModalHTML(
    stats: StatsData,
    demographics?: Demographics | null,
    vitalStats?: VitalStatistics | null
): string {
    const SEP = '<hr class="stats-modal-separator">';

    const biomeSection = stats.biomes ? `
        ${SEP}
        <h4>Biome Distribution</h4>
        ${biomeRow('Tundra', stats.biomes.tundra)}
        ${biomeRow('Desert', stats.biomes.desert)}
        ${biomeRow('Plains', stats.biomes.plains)}
        ${biomeRow('Grassland', stats.biomes.grassland)}
        ${biomeRow('Alpine', stats.biomes.alpine)}
    ` : '';

    const demoSection = demographics ? (() => {
        const d = demographics;
        const sexRatio = d.females > 0 ? (d.males / d.females).toFixed(2) : 'N/A';
        const partnerPct = d.population > 0 ? ((d.partnered / d.population) * 100).toFixed(1) : '0.0';
        const brackets = [
            { label: '0-4', count: d.age_brackets[0] },
            { label: '5-14', count: d.age_brackets[1] },
            { label: '15-29', count: d.age_brackets[2] },
            { label: '30-49', count: d.age_brackets[3] },
            { label: '50-69', count: d.age_brackets[4] },
            { label: '70-89', count: d.age_brackets[5] },
            { label: '90+', count: d.age_brackets[6] },
        ];
        const maxCount = Math.max(...brackets.map(b => b.count), 1);
        const barRows = brackets.map(b => {
            const pct = d.population > 0 ? ((b.count / d.population) * 100).toFixed(1) : '0.0';
            const barWidth = Math.round((b.count / maxCount) * 100);
            return `<div style="display:flex;align-items:center;margin:2px 0;gap:6px;">
                <span style="width:40px;text-align:right;font-size:0.85em;color:#aaa;">${b.label}</span>
                <div style="flex:1;background:#333;border-radius:3px;overflow:hidden;height:16px;">
                    <div style="width:${barWidth}%;background:linear-gradient(90deg,#4a90d9,#67b8e3);height:100%;border-radius:3px;"></div>
                </div>
                <span style="width:80px;font-size:0.85em;color:#ccc;">${b.count.toLocaleString()} (${pct}%)</span>
            </div>`;
        }).join('');

        return `
            ${SEP}
            <h4>Demographics</h4>
            ${statRow('Population', d.population.toLocaleString())}
            ${statRow('Males / Females', `${d.males.toLocaleString()} / ${d.females.toLocaleString()} (ratio: ${sexRatio})`)}
            ${statRow('Partnered', `${d.partnered.toLocaleString()} (${partnerPct}%)`)}
            ${statRow('Single', d.single.toLocaleString())}
            ${statRow('Pregnant', (d.pregnant ?? 0).toLocaleString())}
            ${statRow('Average Age', d.average_age.toFixed(1) + ' years')}
            <div style="margin-top:8px;">
                <strong>Age Distribution:</strong>
                <div style="margin-top:4px;">${barRows}</div>
            </div>
        `;
    })() : '';

    const vitalSection = vitalStats ? `
        ${SEP}
        ${statRow('Birth Rate', fmtPct(vitalStats.birth_rate) + ' per 1000')}
        ${statRow('Death Rate', fmtPct(vitalStats.death_rate) + ' per 1000')}
        ${statRow('Marriage Rate', fmtPct(vitalStats.marriage_rate) + ' per 1000')}
        ${statRow('Total Births', fmt(vitalStats.total_births, '0'))}
        ${statRow('Total Deaths', fmt(vitalStats.total_deaths, '0'))}
        ${statRow('Total Marriages', fmt(vitalStats.total_marriages, '0'))}
    ` : '';

    return `
        <div class="stats-modal">
            <div class="stats-modal-header">
                <h3>Population Statistics</h3>
                <button class="stats-modal-close">&times;</button>
            </div>
            <div class="stats-modal-content">
                ${statRow('Total Population', fmt(stats.totalPopulation), 'stats-modal-total-population')}
                ${SEP}
                ${statRow('Total Tiles', String(stats.totalTiles ?? 'N/A'))}
                ${statRow('Habitable Tiles', String(stats.habitableTiles ?? 'N/A'))}
                ${statRow('Populated Tiles', String(stats.populatedTiles ?? 'N/A'))}
                ${statRow('High Pop Tiles (>=' + (stats.threshold ?? 0) + ')', String(stats.highPopulationTiles ?? 'N/A'))}
                ${statRow('Red Tiles', String(stats.redTiles ?? 'N/A'))}
                ${biomeSection}
                ${demoSection}
                ${vitalSection}
                ${SEP}
                <div style="margin: 24px 0;">
                    <h4>Vital Rates (per 1000 people, last 100 years)</h4>
                    <canvas id="vital-rates-chart" width="600" height="300"></canvas>
                </div>
            </div>
        </div>
    `;
}

// ============ Chart Rendering ============

export async function renderVitalRatesChart(vitalStats: VitalStatistics): Promise<void> {
    if (!extendedWindow.Chart) {
        throw new Error('Chart.js is not loaded.');
    }

    const chartCanvas = document.getElementById('vital-rates-chart') as HTMLCanvasElement | null;
    if (!chartCanvas) {
        throw new Error('Chart container not found in the DOM.');
    }
    const ctx = chartCanvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get 2D context for vital rates chart.');
    }

    if (extendedWindow.vitalRatesChartInstance) {
        extendedWindow.vitalRatesChartInstance.destroy();
    }

    const chartData = {
        labels: ['Recent'],
        datasets: [
            {
                label: 'Birth Rate',
                data: [vitalStats.birth_rate],
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
            },
            {
                label: 'Death Rate',
                data: [vitalStats.death_rate],
                borderColor: 'rgb(255, 99, 132)',
                tension: 0.1,
            },
        ],
    };

    extendedWindow.vitalRatesChartInstance = new extendedWindow.Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top' },
                title: { display: true, text: 'Birth and Death Rates per 1000 People' }
            },
            scales: {
                y: { title: { display: true, text: 'Rate per 1000' } }
            }
        }
    });
}

// ============ Modal Handlers ============

export function attachStatsModalHandlers(overlay: HTMLElement): void {
    const closeBtn = overlay.querySelector('.stats-modal-close');

    const closeStats = () => {
        overlay.remove();
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', closeStats);
    }

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeStats();
    });
}
