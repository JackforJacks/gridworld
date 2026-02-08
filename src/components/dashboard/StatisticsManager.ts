// Population Statistics UI Component
import { getApiClient } from '../../services/api/ApiClient';
import type { VitalStatistics } from '../../services/api/ApiClient';
import populationManager from '../../managers/population/PopulationManager';

// Declare Chart.js global type
declare const Chart: ChartConstructor;

interface ChartConstructor {
    new(ctx: CanvasRenderingContext2D, config: ChartConfiguration): ChartInstance;
}

interface ChartInstance {
    destroy(): void;
}

interface ChartConfiguration {
    type: string;
    data: ChartData;
    options?: ChartOptions;
}

interface ChartData {
    labels: (string | number)[];
    datasets: ChartDataset[];
}

interface ChartDataset {
    label: string;
    data: number[];
    borderColor: string;
    backgroundColor: string;
    tension?: number;
    pointRadius?: number;
}

interface ChartOptions {
    responsive?: boolean;
    maintainAspectRatio?: boolean;
    plugins?: {
        title?: { display: boolean; text: string };
        legend?: { display: boolean; position: string };
    };
    scales?: {
        y?: { beginAtZero?: boolean; title?: { display: boolean; text: string } };
        x?: { title?: { display: boolean; text: string } };
    };
}

class StatisticsManager {
    private container: HTMLDivElement | null;
    private chartContainer: HTMLDivElement | null;
    private chart: ChartInstance | null;
    private isVisible: boolean;
    private refreshInterval: ReturnType<typeof setInterval> | null;

    constructor() {
        this.container = null;
        this.chartContainer = null;
        this.chart = null;
        this.isVisible = false;
        this.refreshInterval = null;
        this.init();
    }

    private init(): void {
        this.createUI();
        this.loadChartLibrary();
    }

    private createUI(): void {
        // Create statistics toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'stats-toggle';
        toggleBtn.innerHTML = '📊 Statistics';
        toggleBtn.style.cssText = `
            position: fixed;
            top: 60px;
            right: 10px;
            z-index: 1001;
            padding: 8px 12px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            border: 1px solid #333;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;
        toggleBtn.onclick = () => this.toggleStatistics();
        document.body.appendChild(toggleBtn);

        // Create statistics panel
        this.container = document.createElement('div');
        this.container.id = 'statistics-panel';
        this.container.style.cssText = `
            position: fixed;
            top: 100px;
            right: 10px;
            width: 400px;
            max-height: 500px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 15px;
            display: none;
            z-index: 1000;
            overflow-y: auto;
            font-family: Arial, sans-serif;
            font-size: 12px;
        `;

        this.container.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #fff;">Population Statistics</h3>
                <button id="close-stats" style="background: none; border: none; color: white; cursor: pointer; font-size: 16px;">×</button>
            </div>
            <div id="stats-summary">
                <p>Loading statistics...</p>
            </div>
            <div style="margin: 15px 0;">
                <button id="refresh-chart" style="background: #333; color: white; border: 1px solid #555; padding: 5px 10px; border-radius: 3px; cursor: pointer; margin-right: 10px;">Refresh Chart</button>
                <select id="years-select" style="background: #333; color: white; border: 1px solid #555; padding: 5px; border-radius: 3px;">
                    <option value="10">Last 10 Years</option>
                    <option value="25">Last 25 Years</option>
                    <option value="50">Last 50 Years</option>
                    <option value="100" selected>Last 100 Years</option>
                </select>
            </div>
            <div id="chart-container" style="background: white; border-radius: 4px; padding: 10px; margin-top: 10px;">
                <canvas id="vitalRatesChart" width="360" height="200"></canvas>
            </div>
        `;

        document.body.appendChild(this.container);

        // Add event listeners
        const closeBtn = document.getElementById('close-stats');
        const refreshBtn = document.getElementById('refresh-chart');
        const yearsSelect = document.getElementById('years-select');

        if (closeBtn) closeBtn.onclick = () => this.hideStatistics();
        if (refreshBtn) refreshBtn.onclick = () => this.updateDashboard();
        if (yearsSelect) yearsSelect.onchange = () => this.updateDashboard();
    }

    private async loadChartLibrary(): Promise<void> {
        // Load Chart.js if not already loaded
        if (typeof Chart === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.onload = () => {
                if (this.isVisible) {
                    this.updateDashboard();
                }
            };
            document.head.appendChild(script);
        }
    }

    public toggleStatistics(): void {
        if (this.isVisible) {
            this.hideStatistics();
        } else {
            this.showStatistics();
        }
    }

    public showStatistics(): void {
        if (!this.container) return;
        this.container.style.display = 'block';
        this.isVisible = true;
        this.updateDashboard();

        // Start auto-refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.updateDashboard();
        }, 30000);
    }

    public hideStatistics(): void {
        if (!this.container) return;
        this.container.style.display = 'none';
        this.isVisible = false;

        // Stop auto-refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Combined dashboard update - fetches stats via Tauri invoke
    public async updateDashboard(): Promise<void> {
        try {
            const yearsSelect = document.getElementById('years-select') as HTMLSelectElement | null;
            const selectedYears = parseInt(yearsSelect?.value || '100', 10);

            const api = getApiClient();

            // Fetch summary data in parallel
            const [calendarState, currentYearStats, recentStats] = await Promise.all([
                api.getCalendarState(),
                api.getCurrentYearStatistics(),
                api.getRecentStatistics(selectedYears),
            ]);

            const currentYear = calendarState.date.year;
            const tickData = populationManager.getRustTickData();

            // Render summary
            this.renderSummary(
                recentStats.population,
                currentYear,
                currentYearStats.total_births,
                currentYearStats.total_deaths,
                recentStats.years_covered,
                recentStats.birth_rate,
                recentStats.death_rate,
                tickData
            );

            // Build per-year chart data
            if (typeof Chart !== 'undefined') {
                await this.buildAndRenderChart(currentYear, selectedYears);
            }
        } catch (error: unknown) {
            console.error('Error updating dashboard:', error);
            const summaryDiv = document.getElementById('stats-summary');
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (summaryDiv) {
                summaryDiv.innerHTML = `
                    <p style="color: #f44336;">Error loading statistics: ${errorMessage}</p>
                `;
            }
        }
    }

    private renderSummary(
        population: number,
        currentYear: number,
        currentYearBirths: number,
        currentYearDeaths: number,
        totalYears: number,
        avgBirthRate: number,
        avgDeathRate: number,
        tickData: { births: number; deaths: number; marriages: number; pregnancies: number }
    ): void {
        const summaryDiv = document.getElementById('stats-summary');
        if (!summaryDiv) return;

        summaryDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #4CAF50;">Current Population</div>
                    <div style="font-size: 18px;">${(population || 0).toLocaleString()}</div>
                </div>
                <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #2196F3;">Current Year</div>
                    <div style="font-size: 18px;">${currentYear || 'N/A'}</div>
                </div>
            </div>

            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">This Year (${currentYear}):</div>
                <div style="margin-left: 10px;">
                    • Births: ${currentYearBirths || 0}</div>
                <div style="margin-left: 10px;">
                    • Deaths: ${currentYearDeaths || 0}</div>
            </div>

            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">Last Tick:</div>
                <div style="margin-left: 10px;">
                    • Births: ${tickData?.births || 0}</div>
                <div style="margin-left: 10px;">
                    • Deaths: ${tickData?.deaths || 0}</div>
                <div style="margin-left: 10px;">
                    • Marriages: ${tickData?.marriages || 0}</div>
                <div style="margin-left: 10px;">
                    • Pregnancies: ${tickData?.pregnancies || 0}</div>
            </div>

            ${totalYears > 0 ? `
            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">Historical Average (${totalYears} years):</div>
                <div style="margin-left: 10px;">
                    • Birth Rate: ${avgBirthRate.toFixed(1)}/1000</div>
                <div style="margin-left: 10px;">
                    • Death Rate: ${avgDeathRate.toFixed(1)}/1000</div>
            </div>
            ` : '<div style="color: #999; font-style: italic;">No historical data yet (need at least 1 completed year)</div>'}
        `;
    }

    /**
     * Build per-year chart data by calling getVitalStatistics for each year
     */
    private async buildAndRenderChart(currentYear: number, years: number): Promise<void> {
        const startYear = currentYear - years;
        const api = getApiClient();

        // Batch all per-year requests in parallel (Tauri IPC is fast, no network overhead)
        const yearRange: number[] = [];
        for (let y = startYear + 1; y <= currentYear; y++) {
            yearRange.push(y);
        }

        const yearResults = await Promise.all(
            yearRange.map(y => api.getVitalStatistics(y, y))
        );

        const chartLabels: number[] = [];
        const birthRates: number[] = [];
        const deathRates: number[] = [];

        for (let i = 0; i < yearRange.length; i++) {
            const stats = yearResults[i];
            if (stats.years_covered > 0) {
                chartLabels.push(yearRange[i]);
                birthRates.push(stats.birth_rate);
                deathRates.push(stats.death_rate);
            }
        }

        const chartData: ChartData = {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Birth Rate',
                    data: birthRates,
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    tension: 0.3,
                    pointRadius: 1,
                },
                {
                    label: 'Death Rate',
                    data: deathRates,
                    borderColor: '#f44336',
                    backgroundColor: 'rgba(244, 67, 54, 0.1)',
                    tension: 0.3,
                    pointRadius: 1,
                },
            ],
        };

        this.renderChart(chartData);
    }

    private renderChart(chartData: ChartData): void {
        const chartContainer = document.getElementById('chart-container');
        if (!chartData || !chartData.labels || chartData.labels.length === 0) {
            if (chartContainer) {
                chartContainer.innerHTML =
                    '<p style="color: #666; text-align: center; padding: 20px;">No data available yet. Let the simulation run for at least one year.</p>';
            }
            return;
        }

        // Ensure canvas exists
        if (chartContainer && !document.getElementById('vitalRatesChart')) {
            chartContainer.innerHTML = '<canvas id="vitalRatesChart" width="360" height="200"></canvas>';
        }

        const canvas = document.getElementById('vitalRatesChart') as HTMLCanvasElement | null;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Birth and Death Rates per 1000 Population (${chartData.labels.length} years)`
                    },
                    legend: {
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Rate per 1000 people'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Year'
                        }
                    }
                }
            }
        });
    }

}

export default StatisticsManager;
