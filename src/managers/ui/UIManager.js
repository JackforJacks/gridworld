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
    }

    initialize() { // sceneManager parameter removed
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

        // Create population display elements - now only the icon
        const populationWrapper = document.createElement('span');
        populationWrapper.id = 'population-panel'; // Keep ID for consistency if needed elsewhere
        populationWrapper.classList.add('population-panel-wrapper');

        // Icon for connection status
        populationWrapper.innerHTML = `<span id="connection-icon" class="population-panel-icon">👥</span>`;

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
            const stats = window.sceneManager.getPopulationStats();
            const growthStats = populationManager.getGrowthStats();
            this.showStatsModal(stats, growthStats);
            console.log('📊 Population Statistics:', { stats, growthStats });
        } catch (error) {
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

        const closeButton = document.createElement('button');
        closeButton.classList.add('stats-modal-close');
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => overlay.remove();
        header.appendChild(closeButton);

        // Modal Content
        const content = document.createElement('div');
        content.classList.add('stats-modal-content');

        // Add Total Population first
        content.innerHTML = `
            <p><strong>Total Population:</strong> <span id="stats-modal-total-population">${this.currentTotalPopulation.toLocaleString()}</span></p>
            <hr class="stats-modal-separator">
            <p><strong>Total Tiles:</strong> ${stats.totalTiles}</p>
            <p><strong>Habitable Tiles:</strong> ${stats.habitableTiles}</p>
            <p><strong>Populated Tiles:</strong> ${stats.populatedTiles}</p>
            <p><strong>High Pop Tiles (≥${stats.threshold}):</strong> ${stats.highPopulationTiles}</p>
            <p><strong>Red Tiles:</strong> ${stats.redTiles}</p>
            <p><strong>Average Pop/Tile:</strong> ${Math.round(growthStats.averagePopulationPerTile)}</p>
        `;

        modal.appendChild(header);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                overlay.remove();
            }
        });
    }

    connectToPopulationManager() {
        this.populationUnsubscribe = populationManager.subscribe((eventType, eventData) => {
            if (eventType === 'populationUpdate') {
                this.currentTotalPopulation = eventData.totalPopulation || 0;
                this.updateStatsModalPopulation(); // Update modal if open
            } else if (eventType === 'connected') {
                this.isConnected = eventData;
                this.updateConnectionVisuals(); // Update dashboard icon color
            }
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

    // updateStats(stats) { // This method is no longer used for the primary stats display
    //     // Update or create stats panel
    //     let statsPanel = document.getElementById('stats-panel');
    //     if (!statsPanel) {
    //         statsPanel = document.createElement('div');
    //         statsPanel.id = 'stats-panel';
    //         statsPanel.classList.add('stats-panel'); // Add class
    //         document.body.appendChild(statsPanel);
    //     }

    //     const statsText = Object.entries(stats)
    //         .map(([key, value]) => `${key}: ${value}`)
    //         .join('<br>');

    //     statsPanel.innerHTML = statsText;
    // }

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
