// Population Statistics UI Component
class StatisticsManager {
    constructor() {
        this.container = null;
        this.chartContainer = null;
        this.chart = null;
        this.isVisible = false;
        this.refreshInterval = null;
        this.init();
    }

    init() {
        this.createUI();
        this.loadChartLibrary();
    }

    createUI() {
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
        document.getElementById('close-stats').onclick = () => this.hideStatistics();
        document.getElementById('refresh-chart').onclick = () => this.updateDashboard();
        document.getElementById('years-select').onchange = () => this.updateDashboard();
    }

    async loadChartLibrary() {
        // Load Chart.js if not already loaded
        if (typeof Chart === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
            script.onload = () => {
// [log removed]
                if (this.isVisible) {
                    this.updateDashboard();
                }
            };
            document.head.appendChild(script);
        }
    }

    toggleStatistics() {
        if (this.isVisible) {
            this.hideStatistics();
        } else {
            this.showStatistics();
        }
    }

    showStatistics() {
        this.container.style.display = 'block';
        this.isVisible = true;
        this.updateDashboard();

        // Start auto-refresh every 30 seconds
        this.refreshInterval = setInterval(() => {
            this.updateDashboard();
        }, 30000);
    }

    hideStatistics() {
        this.container.style.display = 'none';
        this.isVisible = false;

        // Stop auto-refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // Combined dashboard update - fetches all stats in a single API call
    async updateDashboard() {
        try {
            const selectedYears = document.getElementById('years-select')?.value || 100;
            const response = await fetch(`/api/statistics/dashboard?years=${selectedYears}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error);
            }

            // Update summary section
            this.renderSummary(result.summary, result.today);

            // Update chart section
            if (typeof Chart !== 'undefined') {
                this.renderChart(result.chart, selectedYears);
            }
        } catch (error) {
            console.error('Error updating dashboard:', error);
            document.getElementById('stats-summary').innerHTML = `
                <p style="color: #f44336;">Error loading statistics: ${error.message}</p>
            `;
        }
    }

    renderSummary(summary, today) {
        const summaryDiv = document.getElementById('stats-summary');
        if (!summaryDiv) return;

        summaryDiv.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #4CAF50;">Current Population</div>
                    <div style="font-size: 18px;">${(summary.currentPopulation || 0).toLocaleString()}</div>
                </div>
                <div style="background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px;">
                    <div style="font-weight: bold; color: #2196F3;">Current Year</div>
                    <div style="font-size: 18px;">${summary.currentYear || 'N/A'}</div>
                </div>
            </div>
            
            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">This Year (${summary.currentYear}):</div>
                <div style="margin-left: 10px;">
                    • Births: ${summary.currentYearBirths || 0}</div>
                <div style="margin-left: 10px;">
                    • Deaths: ${summary.currentYearDeaths || 0}</div>
            </div>
            
            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">Today:</div>
                <div style="margin-left: 10px;">
                    • Births: ${today?.births || 0}</div>
                <div style="margin-left: 10px;">
                    • Deaths: ${today?.deaths || 0}</div>
                <div style="margin-left: 10px;">
                    • Families Formed: ${today?.familiesFormed || 0}</div>
                <div style="margin-left: 10px;">
                    • Pregnancies Started: ${today?.pregnanciesStarted || 0}</div>
            </div>
            
            ${summary.totalYears > 0 ? `
            <div style="margin: 10px 0;">
                <div style="font-weight: bold; margin-bottom: 5px;">Historical Average (${summary.totalYears} years):</div>
                <div style="margin-left: 10px;">
                    • Birth Rate: ${summary.avgBirthRate}/1000</div>
                <div style="margin-left: 10px;">
                    • Death Rate: ${summary.avgDeathRate}/1000</div>
            </div>
            ` : '<div style="color: #999; font-style: italic;">No historical data yet (need at least 1 completed year)</div>'}
        `;
    }

    renderChart(chartData, selectedYears) {
        if (!chartData || !chartData.labels || chartData.labels.length === 0) {
            document.getElementById('chart-container').innerHTML =
                '<p style="color: #666; text-align: center; padding: 20px;">No data available yet. Let the simulation run for at least one year.</p>';
            return;
        }

        const ctx = document.getElementById('vitalRatesChart')?.getContext('2d');
        if (!ctx) return;

        // Destroy existing chart if it exists
        if (this.chart) {
            this.chart.destroy();
        }

        // Chart.js expects datasets directly from the server response
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

    // Legacy methods kept for backward compatibility
    async updateSummary() {
        try {
            const response = await fetch('/api/statistics/current');
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error);
            }

            this.renderSummary(result.summary, result.today);
        } catch (error) {
            console.error('Error updating summary:', error);
            document.getElementById('stats-summary').innerHTML = `
                <p style="color: #f44336;">Error loading statistics: ${error.message}</p>
            `;
        }
    }

    async updateChart() {
        if (typeof Chart === 'undefined') {
// [log removed]
            return;
        } try {
            const selectedYears = document.getElementById('years-select').value;
            const response = await fetch(`/api/statistics/vital-rates/${selectedYears}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error);
            }

            if (result.data.length === 0) {
                document.getElementById('chart-container').innerHTML =
                    '<p style="color: #666; text-align: center; padding: 20px;">No data available yet. Let the simulation run for at least one year.</p>';
                return;
            }

            const chartData = result.data;
            const yearLabels = chartData.map(d => d.year);
            const birthRates = chartData.map(d => d.birthRate);
            const deathRates = chartData.map(d => d.deathRate);

            const ctx = document.getElementById('vitalRatesChart').getContext('2d');

            // Destroy existing chart if it exists
            if (this.chart) {
                this.chart.destroy();
            }
            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: yearLabels,
                    datasets: [{
                        label: 'Birth Rate per 1000',
                        data: birthRates,
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.1)',
                        tension: 0.1,
                        pointRadius: 3
                    }, {
                        label: 'Death Rate per 1000',
                        data: deathRates,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        tension: 0.1,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: `Birth and Death Rates per 1000 Population (${chartData.length} years)`
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
        } catch (error) {
            console.error('Error updating chart:', error);
            document.getElementById('chart-container').innerHTML =
                `<p style="color: #f44336; text-align: center; padding: 20px;">Error loading chart: ${error.message}</p>`;
        }
    }
}

export default StatisticsManager;
