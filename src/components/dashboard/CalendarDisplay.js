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
    }    /**
     * Create the date display element in the dashboard
     */
    createDateDisplay() {
        // Find the dashboard
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) {
            console.error('Dashboard not found');
            return;
        }        // Create date display element
        this.dateElement = document.createElement('div');
        this.dateElement.id = 'calendar-date-display';
        this.dateElement.className = 'calendar-date-display'; this.dateElement.innerHTML = `            <div id="calendar-circular-container" style="position: relative; width: 110px; height: 110px; margin: 0 auto; border-radius: 50%; overflow: hidden; background: rgba(255,255,255,0.2); border: 1px solid rgba(200,200,200,0.4); box-shadow: 0 1px 4px rgba(0,0,0,0.1);">                <div id="calendar-moon-phase-btn" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 64px; height: 64px; border-radius: 50%; background: #222; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border: 2px solid #444; cursor: pointer; padding: 0; overflow: hidden; box-sizing: border-box;">
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
                        <div style="display: flex; justify-content: center; align-items: center; margin-top: -3px;">
                            <span id="calendar-moon-emoji" style="font-size: 2rem; display: block; line-height: 1;">🌑</span>
                        </div>
                        <div style="margin-top: -4px;">
                            <span id="calendar-day-label" style="font-size: 0.9rem; display: block; line-height: 1;">Day 1</span>
                        </div>
                    </div>
                </div>
                <div id="calendar-month-steps"></div>
            </div>
            <div id="calendar-date-label" style="text-align: center; font-size: 0.9rem; color: #333; position: absolute; bottom: 2px; left: 0; right: 0;"></div>
        `;        // Insert the date display into the dashboard
        dashboard.insertBefore(this.dateElement, dashboard.firstChild);        // Position the calendar vertically centered and at the bottom edge of the dashboard
        this.dateElement.style.position = 'absolute';
        this.dateElement.style.left = '50%';
        this.dateElement.style.bottom = '0'; // Align to bottom edge of dashboard
        this.dateElement.style.transform = 'translateX(-50%) translateY(55%)'; // Center horizontally and push 55% of height downward
        this.dateElement.style.display = 'block';
        this.dateElement.style.padding = '0';
        this.dateElement.style.zIndex = '10';
        this.dateElement.style.borderRadius = '50%';
        this.dateElement.style.overflow = 'hidden';

        // Draw the month steps for the first time
        this.drawMonthSteps(1, 1, 4000); // default values, will be updated

        // --- Create and position the year label at the right edge ---
        // First, remove any existing year label
        const existingYearLabel = document.getElementById('calendar-year-inline');
        if (existingYearLabel && existingYearLabel.parentNode) {
            existingYearLabel.parentNode.removeChild(existingYearLabel);
        }

        // Create a new year label
        const yearLabel = document.createElement('span');
        yearLabel.id = 'calendar-year-inline';
        yearLabel.className = 'calendar-year-inline';
        yearLabel.style.fontSize = '1.1rem';
        yearLabel.style.color = '#333';
        yearLabel.style.fontWeight = 'bold';
        yearLabel.style.background = 'rgba(255,255,255,0.85)';
        yearLabel.style.padding = '2px 12px';
        yearLabel.style.borderRadius = '16px';
        yearLabel.style.verticalAlign = 'middle';
        yearLabel.style.zIndex = '20';
        yearLabel.style.display = 'inline-block';
        yearLabel.style.marginRight = '8px';

        // Find the help button
        const helpBtn = document.getElementById('toggle-help');

        // Create a container for elements at the right side of the dashboard
        const rightElements = document.createElement('div');
        rightElements.style.position = 'absolute';
        rightElements.style.right = '10px';
        rightElements.style.top = '10px';
        rightElements.style.display = 'flex';
        rightElements.style.alignItems = 'center';
        rightElements.id = 'dashboard-right-elements';

        // Remove existing container if it exists
        const existingRightElements = document.getElementById('dashboard-right-elements');
        if (existingRightElements && existingRightElements.parentNode) {
            existingRightElements.parentNode.removeChild(existingRightElements);
        }

        // Add the year label to the container first
        rightElements.appendChild(yearLabel);

        // If the help button exists, also move it to the container (after the year label)
        if (helpBtn && helpBtn.parentNode) {
            helpBtn.parentNode.removeChild(helpBtn);
            rightElements.appendChild(helpBtn);
        }

        // Add the container to the dashboard
        dashboard.appendChild(rightElements);
    }

    /**
     * Draw the 12-step circular month progress indicator
     */    drawMonthSteps(currentMonth, day, year) {
        const steps = 12;
        const radius = 44; // px, from center (doubled from previous size)
        const size = 8; // px, step dot size (doubled from previous size)
        const container = document.getElementById('calendar-month-steps');
        if (!container) return;
        container.innerHTML = '';
        container.style.position = 'absolute';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        for (let i = 0; i < steps; i++) {            const angle = (i / steps) * 2 * Math.PI - Math.PI / 2;
            const x = Math.cos(angle) * radius + 55 - size / 2; // Adjusted for 110px container
            const y = Math.sin(angle) * radius + 55 - size / 2; // Adjusted for 110px container
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
