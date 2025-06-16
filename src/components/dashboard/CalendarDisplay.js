/**
 * CalendarDisplay - Simple real-time date display for the dashboard
 * Shows only the current date in a clean, minimal format
 */
class CalendarDisplay {
    constructor(calendarManager) {
        this.calendarManager = calendarManager;
        this.dateElement = null;

        // Initialize the component
        this.init();
    }

    /**
     * Initialize the calendar display component
     */
    async init() {
        this.createDateDisplay();
        this.setupEventListeners();
        this.updateDisplay();
    }

    /**
     * Create the date display element in the dashboard
     */
    createDateDisplay() {
        // Find the dashboard
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) {
            console.error('Dashboard not found');
            return;
        }

        // Create date display element
        this.dateElement = document.createElement('div');
        this.dateElement.id = 'calendar-date-display';
        this.dateElement.className = 'calendar-date-display';
        this.dateElement.innerHTML = `
            <div id="calendar-circular-container" style="position: relative; width: 120px; height: 120px; margin: 0 auto;">
                <div id="calendar-moon-phase-btn" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 60px; height: 60px; border-radius: 50%; background: #222; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 2rem; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 2px solid #444; cursor: pointer;">
                    <span id="calendar-moon-emoji">🌑</span>
                    <span id="calendar-day-label" style="font-size: 0.9rem; margin-top: 2px;">Day 1</span>
                </div>
                <div id="calendar-month-steps"></div>
            </div>
            <div id="calendar-date-label" style="text-align: center; margin-top: 8px; font-size: 1.1rem; color: #333;"></div>
        `;

        // Insert the date display at the beginning of the dashboard
        dashboard.insertBefore(this.dateElement, dashboard.firstChild);
        // Restore original positioning, but move the calendar down 0px
        this.dateElement.style.position = 'absolute';
        this.dateElement.style.left = '50%';
        this.dateElement.style.top = '0px';
        this.dateElement.style.transform = 'translateX(-50%)';
        this.dateElement.style.zIndex = '10';
        // Remove circular container styles
        this.dateElement.style.width = '';
        this.dateElement.style.height = '';
        this.dateElement.style.borderRadius = '';
        this.dateElement.style.overflow = '';
        this.dateElement.style.background = '';
        this.dateElement.style.boxShadow = '';
        // Draw the month steps for the first time
        this.drawMonthSteps(1, 1, 4000); // default values, will be updated

        // --- Move the year label to be a sibling of the toggle-help button, immediately before it ---
        let yearLabel = document.getElementById('calendar-year-inline');
        if (!yearLabel) {
            yearLabel = document.createElement('span');
            yearLabel.id = 'calendar-year-inline';
            yearLabel.className = 'calendar-year-inline';
            yearLabel.style.cssText = 'margin-left: 12px; margin-right: 0; font-size: 1.1rem; color: #333; font-weight: bold; background: rgba(255,255,255,0.85); padding: 2px 12px; border-radius: 16px; vertical-align: middle; z-index: 20; display: inline-block;';
        }
        // Find the toggle-help button and insert the year label immediately before it in the DOM
        const helpBtn = document.getElementById('toggle-help');
        if (helpBtn && helpBtn.parentNode) {
            helpBtn.parentNode.insertBefore(yearLabel, helpBtn);
        } else {
            dashboard.appendChild(yearLabel);
        }
    }

    /**
     * Draw the 12-step circular month progress indicator
     */
    drawMonthSteps(currentMonth, day, year) {
        const steps = 12;
        const radius = 52; // px, from center
        const size = 16; // px, step dot size
        const container = document.getElementById('calendar-month-steps');
        if (!container) return;
        container.innerHTML = '';
        container.style.position = 'absolute';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * 2 * Math.PI - Math.PI / 2;
            const x = Math.cos(angle) * radius + 60 - size / 2;
            const y = Math.sin(angle) * radius + 60 - size / 2;
            const step = document.createElement('div');
            step.style.position = 'absolute';
            step.style.left = `${x}px`;
            step.style.top = `${y}px`;
            step.style.width = `${size}px`;
            step.style.height = `${size}px`;
            step.style.borderRadius = '50%';
            step.style.background = (i + 1) === currentMonth ? '#4caf50' : '#bbb';
            step.style.border = (i + 1) === currentMonth ? '2px solid #222' : '1px solid #888';
            step.style.display = 'flex';
            step.style.alignItems = 'center';
            step.style.justifyContent = 'center';
            step.style.fontSize = '0.8rem';
            step.style.transition = 'background 0.2s';
            // Remove label and number
            step.title = '';
            step.textContent = '';
            container.appendChild(step);
        }
    }

    /**
     * Setup event listeners for calendar updates
     */
    setupEventListeners() {
        if (!this.calendarManager) return;

        // Listen for calendar state changes
        this.calendarManager.on('stateChanged', (state) => {
            this.updateDateDisplay(state);
        });

        // Listen for calendar tick events
        this.calendarManager.on('tick', (state) => {
            this.updateDateDisplay(state);
        });
    }

    /**
     * Update the date display with current calendar state
     */
    async updateDisplay() {
        try {
            const state = await this.calendarManager.getState();
            this.updateDateDisplay(state);
        } catch (error) {
            console.error('Failed to get calendar state:', error);
        }
    }

    /**
     * Update the date display element
     */
    updateDateDisplay(state) {
        if (!this.dateElement || !state) return;

        // Handle different state structures
        let year, month, day;

        if (state.currentDate) {
            year = state.currentDate.year;
            month = state.currentDate.month;
            day = state.currentDate.day;
        } else {
            year = state.year;
            month = state.month;
            day = state.day;
        }

        // 8 moon phase emojis for 8 days
        const moonPhases = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
        let moonEmoji = moonPhases[(day - 1) % 8] || '🌑';

        // Update moon phase button
        const moonBtn = document.getElementById('calendar-moon-phase-btn');
        if (moonBtn) {
            const moonSpan = document.getElementById('calendar-moon-emoji');
            if (moonSpan) moonSpan.textContent = moonEmoji;
            const dayLabel = document.getElementById('calendar-day-label');
            if (dayLabel) dayLabel.textContent = '';
        }

        // Update circular month steps
        this.drawMonthSteps(month, day, year);

        // Update inline year label
        const yearLabel = document.getElementById('calendar-year-inline');
        if (yearLabel) {
            yearLabel.textContent = `Year: ${year}`;
        }

        // Remove year from below the calendar (keep only inline)
        const dateLabel = document.getElementById('calendar-date-label');
        if (dateLabel) {
            dateLabel.textContent = '';
        }
    }
}

export default CalendarDisplay;
