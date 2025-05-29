// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

import populationManager from './population-manager.js';

class UIManager {
    constructor(sceneManager) {
        this.controlsPanel = null;
        this.toggleHelpButton = null;
        this.populationDisplay = null;
        this.connectionStatus = null;
        this.isInitialized = false;
        this.populationUnsubscribe = null;
        this.sceneManager = sceneManager; // Store sceneManager instance
    } initialize() { // sceneManager parameter removed
        // this.sceneManager = sceneManager; // This line removed
        this.setupControlsPanel();
        this.setupPopulationDisplay();
        this.setupResetButtons();
        this.connectToPopulationManager();
        this.isInitialized = true;
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
    } expandControlsPanel() {
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

        // Create population display elements
        const populationWrapper = document.createElement('span');
        populationWrapper.id = 'population-panel';
        populationWrapper.classList.add('population-panel-wrapper'); // Add class for styling

        populationWrapper.innerHTML = `
            <span class="population-panel-icon">👥</span>
            <span id="population-count">Loading...</span>`;

        const statsButton = document.getElementById('show-stats');
        const toggleHelpButton = document.getElementById('toggle-help');

        if (statsButton) {
            statsButton.insertAdjacentElement('afterend', populationWrapper);
        } else if (toggleHelpButton) {
            // Fallback: if stats button is not found, insert before the help button
            dashboard.insertBefore(populationWrapper, toggleHelpButton);
        } else {
            // Fallback: if neither button is found, append to dashboard
            dashboard.appendChild(populationWrapper);
        }

        this.populationDisplay = populationWrapper;
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
    } async handleResetData() {
        if (!this.sceneManager) {
            console.error("SceneManager not available in UIManager for reset.");
            return;
        }
        try {
            console.log("🔄 Resetting all data...");

            // 1. Reset population data on the server
            await populationManager.resetPopulation();
            console.log("🏘️ Population data reset on server.");

            // 2. Reset tile colors on the client
            this.sceneManager.resetTileColors();
            console.log("🎨 Tile colors reset on client.");

            // 3. Re-initialize population on habitable tiles
            await this.sceneManager.reinitializePopulation();
            console.log("🌱 Population re-initialized on habitable tiles.");

            // Optional: Update UI or provide feedback
            this.updatePopulationDisplay(); // Refresh population display if needed
            console.log("✅ All data reset successfully!");

        } catch (error) {
            console.error("❌ Error during data reset:", error);
            // Optionally, display an error message to the user
        }
    }

    async handleShowStats() {
        if (!window.sceneManager) {
            this.showMessage('Scene manager not available', 'error');
            return;
        }

        try {
            const stats = window.sceneManager.getPopulationStats();
            const growthStats = populationManager.getGrowthStats();

            const message = `📊 POPULATION STATISTICS
Total Tiles: ${stats.totalTiles}
Habitable Tiles: ${stats.habitableTiles}
Populated Tiles: ${stats.populatedTiles}
High Pop Tiles (≥${stats.threshold}): ${stats.highPopulationTiles}
Red Tiles: ${stats.redTiles}
Average Pop/Tile: ${Math.round(growthStats.averagePopulationPerTile)}`;

            this.showMessage(message, 'info', 8000);
            console.log('📊 Population Statistics:', { stats, growthStats });
        } catch (error) {
            console.error('Failed to get statistics:', error);
            this.showMessage('Failed to get statistics', 'error');
        }
    }

    connectToPopulationManager() {
        // Subscribe to population updates
        this.populationUnsubscribe = populationManager.subscribe((eventType, data) => {
            if (eventType === 'populationUpdate') {
                this.updatePopulationDisplay(data);
            } else if (eventType === 'connected') {
                this.updateConnectionStatus(data);
            }
        });

        // Connect to the population server
        populationManager.connect();
    } updatePopulationDisplay(data) {
        if (!this.populationDisplay) return;

        const countElement = this.populationDisplay.querySelector('#population-count');
        // const lastUpdateElement = this.populationDisplay.querySelector('#last-update'); // Removed

        if (countElement) {
            // Use totalPopulation from the new data structure
            const totalPop = data.totalPopulation || 0;
            countElement.textContent = totalPop.toLocaleString();
        }

        // if (lastUpdateElement) { // Removed
        //     // Use globalData.lastUpdated from the new data structure
        //     const lastUpdated = data.globalData ? data.globalData.lastUpdated : data.lastUpdated;
        //     const updateTime = new Date(lastUpdated).toLocaleTimeString();
        //     lastUpdateElement.textContent = `Last update: ${updateTime}`;
        // }
    }

    updateConnectionStatus(isConnected) {
        if (!this.populationDisplay) return;
        const countElement = this.populationDisplay.querySelector('#population-count');

        if (countElement) {
            if (isConnected) {
                countElement.classList.remove('disconnected');
                countElement.classList.add('connected');
            } else {
                countElement.classList.remove('connected');
                countElement.classList.add('disconnected');
            }
        }
    }

    cleanup() {
        if (this.populationUnsubscribe) {
            this.populationUnsubscribe();
        }
        populationManager.disconnect();
    }

    showMessage(message, type = 'info', duration = 3000) {
        // Create or get message container
        let messageContainer = document.getElementById('message-container');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.id = 'message-container';
            messageContainer.classList.add('message-container'); // Add class
            document.body.appendChild(messageContainer);
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.classList.add('message-element', type); // Add base and type class
        messageElement.textContent = message;

        messageContainer.appendChild(messageElement);

        // Animate in
        setTimeout(() => {
            messageElement.classList.add('visible');
        }, 10);

        // Auto remove
        setTimeout(() => {
            this.removeMessage(messageElement);
        }, duration);

        return messageElement;
    }

    removeMessage(messageElement) {
        if (messageElement && messageElement.parentNode) {
            messageElement.classList.remove('visible');
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.parentNode.removeChild(messageElement);
                }
            }, 300); // Corresponds to transition duration
        }
    }

    showLoadingIndicator(text = 'Loading...') {
        let loader = document.getElementById('loading-indicator');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loading-indicator';
            loader.classList.add('loading-indicator'); // Add class

            // Add spinner
            const spinner = document.createElement('div');
            spinner.classList.add('loading-indicator-spinner'); // Add class

            loader.appendChild(spinner);
            loader.appendChild(document.createTextNode(text));
            document.body.appendChild(loader);
        } else {
            loader.style.display = 'flex'; // Keep this for toggling visibility
            loader.lastChild.textContent = text;
        }

        return loader;
    }

    hideLoadingIndicator() {
        const loader = document.getElementById('loading-indicator');
        if (loader) {
            loader.style.display = 'none'; // Keep this for toggling visibility
        }
    }

    updateStats(stats) {
        // Update or create stats panel
        let statsPanel = document.getElementById('stats-panel');
        if (!statsPanel) {
            statsPanel = document.createElement('div');
            statsPanel.id = 'stats-panel';
            statsPanel.classList.add('stats-panel'); // Add class
            document.body.appendChild(statsPanel);
        }

        const statsText = Object.entries(stats)
            .map(([key, value]) => `${key}: ${value}`)
            .join('<br>');

        statsPanel.innerHTML = statsText;
    }

    getContainer() {
        const container = document.getElementById("container");
        if (!container) {
            console.error("Container element not found in HTML");
            return null;
        }
        return container;
    }

    isControlsPanelVisible() {
        return this.controlsPanel && !this.controlsPanel.classList.contains('collapsed');
    }
}

export default UIManager;
