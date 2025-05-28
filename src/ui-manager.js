// UI Manager Module
// Handles UI setup, controls panel, and user interface interactions

class UIManager {
    constructor() {
        this.controlsPanel = null;
        this.toggleHelpButton = null;
        this.isInitialized = false;
    }

    initialize() {
        this.setupControlsPanel();
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
    }

    expandControlsPanel() {
        if (!this.controlsPanel || !this.toggleHelpButton) return;
        
        this.controlsPanel.classList.remove('collapsed');
        this.toggleHelpButton.textContent = '×';
    }

    showMessage(message, type = 'info', duration = 3000) {
        // Create or get message container
        let messageContainer = document.getElementById('message-container');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.id = 'message-container';
            messageContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 300px;
            `;
            document.body.appendChild(messageContainer);
        }

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.style.cssText = `
            padding: 12px 16px;
            margin-bottom: 10px;
            border-radius: 4px;
            color: white;
            font-family: Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            opacity: 0;
            transform: translateX(100%);
            transition: all 0.3s ease;
            background-color: ${this.getMessageColor(type)};
        `;
        messageElement.textContent = message;

        messageContainer.appendChild(messageElement);

        // Animate in
        setTimeout(() => {
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateX(0)';
        }, 10);

        // Auto remove
        setTimeout(() => {
            this.removeMessage(messageElement);
        }, duration);

        return messageElement;
    }

    getMessageColor(type) {
        const colors = {
            'info': '#2196F3',
            'success': '#4CAF50',
            'warning': '#FF9800',
            'error': '#F44336'
        };
        return colors[type] || colors.info;
    }

    removeMessage(messageElement) {
        if (messageElement && messageElement.parentNode) {
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.parentNode.removeChild(messageElement);
                }
            }, 300);
        }
    }

    showLoadingIndicator(text = 'Loading...') {
        let loader = document.getElementById('loading-indicator');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loading-indicator';
            loader.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px 30px;
                border-radius: 8px;
                font-family: Arial, sans-serif;
                font-size: 16px;
                z-index: 10001;
                display: flex;
                align-items: center;
                gap: 15px;
            `;
            
            // Add spinner
            const spinner = document.createElement('div');
            spinner.style.cssText = `
                width: 20px;
                height: 20px;
                border: 2px solid #333;
                border-top: 2px solid #fff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            `;
            
            // Add CSS animation
            if (!document.getElementById('spinner-style')) {
                const style = document.createElement('style');
                style.id = 'spinner-style';
                style.textContent = `
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
            
            loader.appendChild(spinner);
            loader.appendChild(document.createTextNode(text));
            document.body.appendChild(loader);
        } else {
            loader.style.display = 'flex';
            loader.lastChild.textContent = text;
        }
        
        return loader;
    }

    hideLoadingIndicator() {
        const loader = document.getElementById('loading-indicator');
        if (loader) {
            loader.style.display = 'none';
        }
    }

    updateStats(stats) {
        // Update or create stats panel
        let statsPanel = document.getElementById('stats-panel');
        if (!statsPanel) {
            statsPanel = document.createElement('div');
            statsPanel.id = 'stats-panel';
            statsPanel.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: rgba(0, 0, 0, 0.7);
                color: white;
                padding: 10px 15px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
                z-index: 1000;
            `;
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
