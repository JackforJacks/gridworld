// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

import populationManager from '../population/PopulationManager.js';

class UIManager {
    constructor(sceneManager) {
        this.controlsPanel = null;
        this.toggleHelpButton = null;
        this.populationDisplay = null; // This will be the wrapper for the connection icon
        // this.connectionStatus = null; // No longer needed as a separate element
        this.isInitialized = false;
        this.populationUnsubscribe = null;
        this.sceneManager = sceneManager; // Store sceneManager instance
        this.currentTotalPopulation = 0; // Store current total population
        this.isConnected = false; // Store connection status
        this.loadingIndicator = null; // Store loading indicator element
        this.messageTimeout = null; // Store message timeout
    }

    initialize() { // sceneManager parameter removed
        // this.sceneManager = sceneManager; // This line removed
        this.setupControlsPanel();
        this.setupPopulationDisplay();
        this.setupResetButtons();
        this.connectToPopulationManager();
        this.isInitialized = true;
    }

    getContainer() {
        // Return the main container element where the renderer should be attached
        return document.getElementById('container') || document.body;
    }

    showLoadingIndicator(message = 'Loading...') {
        // Remove existing loading indicator if any
        this.hideLoadingIndicator();

        // Create loading indicator
        const indicator = document.createElement('div');
        indicator.className = 'loading-indicator';
        indicator.innerHTML = `
            <div class="loading-indicator-spinner"></div>
            <span>${message}</span>
        `;

        document.body.appendChild(indicator);
        this.loadingIndicator = indicator;
    }

    hideLoadingIndicator() {
        if (this.loadingIndicator) {
            this.loadingIndicator.remove();
            this.loadingIndicator = null;
        }
    }

    showMessage(message, type = 'info', duration = 3000) {
        // Clear any existing message timeout
        if (this.messageTimeout) {
            clearTimeout(this.messageTimeout);
            this.messageTimeout = null;
        }

        // Remove existing message if any
        const existingMessage = document.querySelector('.message-element');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = `message-element ${type}`;
        messageElement.textContent = message;

        document.body.appendChild(messageElement);

        // Show message with animation
        setTimeout(() => {
            messageElement.classList.add('visible');
        }, 10);

        // Auto-hide message after duration
        this.messageTimeout = setTimeout(() => {
            messageElement.classList.remove('visible');
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 300); // Wait for fade-out animation
        }, duration);
    }

    setupControlsPanel() {
        this.toggleHelpButton = document.getElementById('toggle-help');
        this.controlsPanel = document.getElementById('controls-help');

        if (this.toggleHelpButton && this.controlsPanel) {
            this.toggleHelpButton.addEventListener('click', () => {
                this.toggleControlsPanel();
            });

            // Initially show controls for a few seconds, then collapse
            setTimeout(() => {
                this.collapseControlsPanel();
            }, 5000);
        }
    }

    toggleControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.toggle('collapsed');
        this.toggleHelpButton.textContent = this.controlsPanel.classList.contains('collapsed') ? '?' : '×';
    }

    collapseControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.add('collapsed');
        this.toggleHelpButton.textContent = '?';
    }

    expandControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;

        this.controlsPanel.classList.remove('collapsed');
        this.toggleHelpButton.textContent = '×';
    }

    setupPopulationDisplay() {
        // Move population display into the dashboard
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;

        // Remove old population panel if it exists
        const oldPanel = document.getElementById('population-panel');
        if (oldPanel) oldPanel.remove();

        // Create population display elements - now only the icon
        const populationWrapper = document.createElement('span');
        populationWrapper.id = 'population-panel'; // Keep ID for consistency if needed elsewhere
        populationWrapper.classList.add('population-panel-wrapper');

        // Create the connection status icon, which was previously missing
        const icon = document.createElement('span');
        icon.id = 'connection-icon';
        icon.className = 'connection-icon';
        icon.textContent = '●'; // Default icon, color will be set by CSS
        populationWrapper.appendChild(icon);

        // The year display logic has been removed from here and is now exclusively
        // handled by the CalendarDisplay component to avoid duplication.

        const statsButton = document.getElementById('show-stats');
        const toggleHelpButton = document.getElementById('toggle-help');

        if (statsButton) {
            statsButton.insertAdjacentElement('afterend', populationWrapper);
        } else if (toggleHelpButton) {
            dashboard.insertBefore(populationWrapper, toggleHelpButton);
        } else {
            dashboard.appendChild(populationWrapper);
        }

        this.populationDisplay = populationWrapper; // Reference to the wrapper span
        this.updateConnectionVisuals(); // Initialize icon color
    } setupResetButtons() {
        const resetDataButton = document.getElementById('reset-data');
        const showStatsButton = document.getElementById('show-stats');

        if (resetDataButton) {
            resetDataButton.addEventListener('click', () => {
                this.handleResetData();
            });
        }

        if (showStatsButton) {
            showStatsButton.addEventListener('click', () => {
                this.handleShowStats();
            });
        }
    }    async handleResetData() {
        if (!this.sceneManager) {
            console.error("SceneManager not available in UIManager for reset.");
            return;
        }
        try {
            console.log("🔄 Resetting all data...");

            // 1. Reset population data on the server
            await populationManager.resetPopulation();
            console.log("🏘️ Population data reset on server.");

            // 2. Regenerate tiles (new terrain and habitability)
            console.log("🌍 Regenerating tiles...");
            await this.sceneManager.regenerateTiles();
            console.log("🗺️ Tiles regenerated with new terrain.");

            // 3. Reset tile colors on the client
            this.sceneManager.resetTileColors();
            console.log("🎨 Tile colors reset on client.");

            // 4. Re-initialize population on newly generated habitable tiles
            await this.sceneManager.reinitializePopulation();
            console.log("🌱 Population re-initialized on habitable tiles.");

            // 5. Refresh the stats modal to show the new population, only if it's open
            const statsModal = document.getElementById('stats-modal-overlay');
            if (statsModal) {
                await this.handleShowStats();
            }

            // Population display will update via events if modal is open or for connection status
            console.log("✅ All data reset successfully!");

        } catch (error) {
            console.error("❌ Error during data reset:", error);
        }
    }

    async handleShowStats() {
        if (!window.sceneManager) {
            this.showMessage('Scene manager not available', 'error');
            return;
        }

        try {
            // Show loading indicator while fetching
            this.showLoadingIndicator('Loading statistics...');

            // Get tile stats from sceneManager
            const stats = window.sceneManager.getPopulationStats();
            // Fetch demographic stats from backend API (force fresh)
            const popData = await populationManager.makeApiRequest('/stats', 'GET');
            // Merge demographic stats if available
            if (popData) {
                if (typeof popData.male !== 'undefined') stats.male = Number(popData.male);
                if (typeof popData.female !== 'undefined') stats.female = Number(popData.female);
                if (typeof popData.minors !== 'undefined') stats.minors = Number(popData.minors);
                if (typeof popData.working_age !== 'undefined') stats.working_age = Number(popData.working_age);
                if (typeof popData.elderly !== 'undefined') stats.elderly = Number(popData.elderly);
                if (typeof popData.bachelors !== 'undefined') stats.bachelors = Number(popData.bachelors);
                if (typeof popData.birthRate !== 'undefined') stats.birthRate = Number(popData.birthRate);
                if (typeof popData.deathRate !== 'undefined') stats.deathRate = Number(popData.deathRate);
                if (typeof popData.birthCount !== 'undefined') stats.birthCount = Number(popData.birthCount);
                if (typeof popData.deathCount !== 'undefined') stats.deathCount = Number(popData.deathCount);
                if (typeof popData.totalFamilies !== 'undefined') stats.totalFamilies = Number(popData.totalFamilies);
                if (typeof popData.pregnantFamilies !== 'undefined') stats.pregnantFamilies = Number(popData.pregnantFamilies);
                if (typeof popData.familiesWithChildren !== 'undefined') stats.familiesWithChildren = Number(popData.familiesWithChildren);
                if (typeof popData.avgChildrenPerFamily !== 'undefined') stats.avgChildrenPerFamily = Number(popData.avgChildrenPerFamily);
                if (typeof popData.totalPopulation !== 'undefined') stats.totalPopulation = Number(popData.totalPopulation);
            }
            this.currentTotalPopulation = stats.totalPopulation;
            const growthStats = populationManager.getGrowthStats();
            this.hideLoadingIndicator();
            this.showStatsModal(stats, growthStats);
            console.log('📊 Population Statistics:', { stats, growthStats, totalPopulation: this.currentTotalPopulation });
        } catch (error) {
            this.hideLoadingIndicator();
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    showStatsModal(stats, growthStats) {
        // Remove existing modal if any
        const existingModal = document.getElementById('stats-modal-overlay');
        if (existingModal) {
            existingModal.remove();
        }

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'stats-modal-overlay';
        overlay.classList.add('stats-modal-overlay');

        // Create modal
        const modal = document.createElement('div');
        modal.classList.add('stats-modal');

        // Modal Header
        const header = document.createElement('div');
        header.classList.add('stats-modal-header');
        header.innerHTML = '<h3>📊 Population Statistics</h3>';

        // Add Refresh button
        const refreshButton = document.createElement('button');
        refreshButton.classList.add('stats-modal-refresh');
        refreshButton.innerHTML = '⟳ Refresh';
        refreshButton.style.marginRight = '8px';
        refreshButton.onclick = async () => {
            refreshButton.disabled = true;
            refreshButton.textContent = 'Refreshing...';
            try {
                await this.handleShowStats();
            } finally {
                // The modal will be replaced, so no need to re-enable
            }
        };
        header.appendChild(refreshButton);

        const closeButton = document.createElement('button');
        closeButton.classList.add('stats-modal-close');
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => overlay.remove();
        header.appendChild(closeButton);

        // Modal Content
        const content = document.createElement('div');
        content.classList.add('stats-modal-content');
        content.innerHTML = `
            <p><strong>Total Population:</strong> <span id="stats-modal-total-population">${stats.totalPopulation?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Male Population:</strong> <span id="stats-modal-male-population">${stats.male?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Female Population:</strong> <span id="stats-modal-female-population">${stats.female?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Minors (under 16):</strong> <span id="stats-modal-minors">${stats.minors?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Working Age (16-60):</strong> <span id="stats-modal-working-age">${stats.working_age?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Elderly (over 60):</strong> <span id="stats-modal-elderly">${stats.elderly?.toLocaleString() ?? 'N/A'}</span></p>
            <p><strong>Bachelors:</strong> <span id="stats-modal-bachelors">${stats.bachelors?.toLocaleString() ?? 'N/A'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Total Families:</strong> <span id="stats-modal-total-families">${stats.totalFamilies?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Pregnant Families:</strong> <span id="stats-modal-pregnant-families">${stats.pregnantFamilies?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Families with Children:</strong> <span id="stats-modal-families-with-children">${stats.familiesWithChildren?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Avg. Children per Family:</strong> <span id="stats-modal-avg-children">${stats.avgChildrenPerFamily?.toFixed(1) ?? '0.0'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Birth Rate:</strong> <span id="stats-modal-birth-rate">${stats.birthRate?.toFixed(2) ?? '0.00'} %</span></p>
            <p><strong>Death Rate:</strong> <span id="stats-modal-death-rate">${stats.deathRate?.toFixed(2) ?? '0.00'} %</span></p>
            <p><strong>Total Births:</strong> <span id="stats-modal-birth-count">${stats.birthCount?.toLocaleString() ?? '0'}</span></p>
            <p><strong>Total Deaths:</strong> <span id="stats-modal-death-count">${stats.deathCount?.toLocaleString() ?? '0'}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Total Tiles:</strong> ${stats.totalTiles}</p>
            <p><strong>Habitable Tiles:</strong> ${stats.habitableTiles}</p>
            <p><strong>Populated Tiles:</strong> ${stats.populatedTiles}</p>
            <p><strong>High Pop Tiles (≥${stats.threshold}):</strong> ${stats.highPopulationTiles}</p>
            <p><strong>Red Tiles:</strong> ${stats.redTiles}</p>            <hr class="stats-modal-separator">
            <div style="margin: 24px 0;">
                <h4>Vital Rates (per 1000 people, last 25 years)</h4>
                <canvas id="vital-rates-chart" width="600" height="300"></canvas>
            </div>
        `;

        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Render the vital rates chart
        this.renderVitalRatesChart();

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });
    } async renderVitalRatesChart() {
        try {
            const response = await fetch('/api/statistics/vital-rates/100');
            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Failed to fetch vital rates');
            const chartData = result.data;

            if (!window.Chart) {
                throw new Error('Chart.js is not loaded. Please include <script src="https://cdn.jsdelivr.net/npm/chart.js"></script> in your HTML.');
            }

            const chartCanvas = document.getElementById('vital-rates-chart');
            if (!chartCanvas) {
                throw new Error('Chart container not found in the DOM.');
            }
            const ctx = chartCanvas.getContext('2d');
            if (!ctx) {
                throw new Error('Failed to get 2D context for vital rates chart.');
            }

            if (window.vitalRatesChartInstance) {
                window.vitalRatesChartInstance.destroy();
            }
            window.vitalRatesChartInstance = new window.Chart(ctx, {
                type: 'line',
                data: chartData,
                options: {
                    responsive: true,
                    plugins: {
                        legend: { position: 'top' },
                        title: { display: true, text: 'Birth and Death Rates per 1000 People (Last 25 Years)' }
                    },
                    scales: {
                        x: { title: { display: true, text: 'Year' } },
                        y: { title: { display: true, text: 'Rate per 1000' } }
                    }
                }
            });
        } catch (err) {
            const chartContainer = document.getElementById('vital-rates-chart');
            if (chartContainer) {
                chartContainer.outerHTML = `<div style="color:red;">Failed to load vital rates chart: ${err.message}</div>`;
            }
        }
    }

    connectToPopulationManager() {
        this.populationUnsubscribe = populationManager.subscribe((eventType, eventData) => {
            if (eventType === 'connected') {
                this.isConnected = eventData;
                this.updateConnectionVisuals(); // Update dashboard icon color
            }
            // Do NOT update currentTotalPopulation on populationUpdate anymore
        });
        populationManager.connect();
    }

    updateConnectionVisuals() {
        if (!this.populationDisplay) return;
        const iconElement = this.populationDisplay.querySelector('#connection-icon');
        if (iconElement) {
            if (this.isConnected) {
                iconElement.classList.remove('disconnected');
                iconElement.classList.add('connected');
            } else {
                iconElement.classList.remove('connected');
                iconElement.classList.add('disconnected');
            }
        }
    }

    updateStatsModalPopulation() {
        const totalPopElement = document.getElementById('stats-modal-total-population');
        if (totalPopElement) { // Check if modal is open and element exists
            totalPopElement.textContent = this.currentTotalPopulation.toLocaleString();
        }
    }

    cleanup() {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
            this.populationUnsubscribe = null;
        }
        // Remove controls panel and population display if they exist
        if (this.controlsPanel) {
            this.controlsPanel.remove();
            this.controlsPanel = null;
        }
        if (this.populationDisplay) {
            this.populationDisplay.remove();
            this.populationDisplay = null;
        }
        this.isInitialized = false;
    }
}

export default UIManager;
