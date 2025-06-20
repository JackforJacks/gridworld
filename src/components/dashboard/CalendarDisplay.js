/**
 * CalendarDisplay - Interactive calendar widget for the dashboard
 * Shows current date information with a clean, visually appealing circular interface
 */
class CalendarDisplay {
    constructor(calendarManager) {
        this.calendarManager = calendarManager;
        this.dateElement = null;
        this.moonPhases = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

        // Default calendar dimensions
        this.calendarSize = 110; // px
        this.moonButtonSize = 64; // px
        this.monthStepRadius = 44; // px
        this.monthDotSize = 8; // px

        // Initialize the component
        this.init();
    }

    /**
     * Initialize the calendar display component
     */
    async init() {
        this.createDateDisplay();
        this.createDashboardElements();
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

        // Build the HTML structure
        this.dateElement.innerHTML = this.buildCalendarHTML();

        // Insert the date display into the dashboard
        dashboard.insertBefore(this.dateElement, dashboard.firstChild);

        // Draw the month steps for the first time
        this.drawMonthSteps(1, 1, 4000); // default values, will be updated
    }

    /**
     * Build the HTML structure for the calendar
     */
    buildCalendarHTML() {
        return `
            <div id="calendar-circular-container" class="calendar-circular-container">
                <div id="calendar-moon-phase-btn" class="calendar-moon-phase-btn">
                    <div class="moon-emoji-container">
                        <span id="calendar-moon-emoji" class="calendar-moon-emoji">🌑</span>
                    </div>
                    <div class="day-label-container">
                        <span id="calendar-day-label" class="calendar-day-label">Day 1</span>
                    </div>
                </div>
                <div id="calendar-month-steps" class="calendar-month-steps"></div>
            </div>
            <div id="calendar-date-label" class="calendar-date-label"></div>
        `;
    }

    /**
     * Create and position year label and other dashboard elements
     */
    createDashboardElements() {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard) return;

        // Create the right-aligned elements container
        const rightElements = this.createRightElementsContainer();

        // Create year label
        const yearLabel = this.createYearLabel();
        rightElements.appendChild(yearLabel);

        // Position help button if it exists
        this.positionHelpButton(rightElements);

        // Add the container to the dashboard
        dashboard.appendChild(rightElements);
    }

    /**
     * Create the container for right-aligned dashboard elements
     */
    createRightElementsContainer() {
        // Remove any existing container
        const existingRightElements = document.getElementById('dashboard-right-elements');
        if (existingRightElements && existingRightElements.parentNode) {
            existingRightElements.parentNode.removeChild(existingRightElements);
        }

        // Create a new container
        const rightElements = document.createElement('div');
        rightElements.id = 'dashboard-right-elements';
        rightElements.className = 'dashboard-right-elements';

        return rightElements;
    }

    /**
     * Create the year label element
     */
    createYearLabel() {
        // Remove any existing year label
        const existingYearLabel = document.getElementById('calendar-year-inline');
        if (existingYearLabel && existingYearLabel.parentNode) {
            existingYearLabel.parentNode.removeChild(existingYearLabel);
        }

        // Create a new year label
        const yearLabel = document.createElement('span');
        yearLabel.id = 'calendar-year-inline';
        yearLabel.className = 'calendar-year-inline';

        return yearLabel;
    }

    /**
     * Position the help button in the right elements container
     */
    positionHelpButton(container) {
        const helpBtn = document.getElementById('toggle-help');
        if (helpBtn && helpBtn.parentNode) {
            helpBtn.parentNode.removeChild(helpBtn);
            container.appendChild(helpBtn);
        }
    }/**
     * Draw the 12-step circular month progress indicator
     * @param {number} currentMonth - Current month (1-12)
     * @param {number} day - Current day of month
     * @param {number} year - Current year
     */
    drawMonthSteps(currentMonth, day, year) {
        const steps = 12; // 12 months
        const radius = this.monthStepRadius;
        const size = this.monthDotSize;
        const centerPoint = this.calendarSize / 2;

        const container = document.getElementById('calendar-month-steps');
        if (!container) return;

        // Clear previous month steps
        container.innerHTML = '';

        // Create month indicator dots
        for (let i = 0; i < steps; i++) {
            const monthNumber = i + 1;
            const isCurrentMonth = monthNumber === currentMonth;

            // Calculate position around the circle
            const angle = (i / steps) * 2 * Math.PI - Math.PI / 2; // Start from top (12 o'clock)
            const x = Math.cos(angle) * radius + centerPoint - size / 2;
            const y = Math.sin(angle) * radius + centerPoint - size / 2;

            // Create the step dot
            const step = this.createMonthStep(x, y, size, isCurrentMonth);
            container.appendChild(step);
        }
    }

    /**
     * Create a single month step indicator dot
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} size - Dot size
     * @param {boolean} isActive - Whether this is the current month
     * @returns {HTMLElement} - The created dot element
     */
    createMonthStep(x, y, size, isActive) {
        const step = document.createElement('div');
        step.className = isActive ? 'month-step month-step-active' : 'month-step month-step-inactive';

        // Set position using styles
        step.style.left = `${x}px`;
        step.style.top = `${y}px`;

        return step;
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
     * Extract date information from calendar state
     * @param {Object} state - Calendar state object
     * @returns {Object} - Extracted date values
     */
    extractDateInfo(state) {
        if (!state) return { year: 0, month: 1, day: 1 };

        // Handle different state structures
        if (state.currentDate) {
            return {
                year: state.currentDate.year,
                month: state.currentDate.month,
                day: state.currentDate.day
            };
        } else {
            return {
                year: state.year || 0,
                month: state.month || 1,
                day: state.day || 1
            };
        }
    }

    /**
     * Update the date display element with new state
     * @param {Object} state - Calendar state object
     */
    updateDateDisplay(state) {
        if (!this.dateElement || !state) return;

        // Extract date information
        const { year, month, day } = this.extractDateInfo(state);

        // Get moon phase emoji based on day
        const moonEmoji = this.getMoonPhaseEmoji(day);

        // Update UI elements
        this.updateMoonPhase(moonEmoji);
        this.updateYearLabel(year);
        this.drawMonthSteps(month, day, year);
    }

    /**
     * Get the appropriate moon phase emoji for the given day
     * @param {number} day - Current day
     * @returns {string} - Moon phase emoji
     */
    getMoonPhaseEmoji(day) {
        return this.moonPhases[(day - 1) % 8] || '🌑';
    }

    /**
     * Update the moon phase display
     * @param {string} emoji - Moon phase emoji to display
     */
    updateMoonPhase(emoji) {
        const moonSpan = document.getElementById('calendar-moon-emoji');
        if (moonSpan) moonSpan.textContent = emoji;

        const dayLabel = document.getElementById('calendar-day-label');
        if (dayLabel) dayLabel.textContent = '';
    }

    /**
     * Update the year label with current year
     * @param {number} year - Current year
     */
    updateYearLabel(year) {
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
