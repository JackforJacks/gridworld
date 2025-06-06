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
        this.dateElement.innerHTML = '<span id="calendar-current-date">Year 4000, Month 1, Day 1</span>';

        // Insert the date display at the beginning of the dashboard
        dashboard.insertBefore(this.dateElement, dashboard.firstChild);
    }    /**
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
    }    /**
     * Update the date display element
     */
    updateDateDisplay(state) {
        if (!this.dateElement || !state) return;

        // Handle different state structures
        let year, month, day;

        if (state.currentDate) {
            // From socket events that include currentDate
            year = state.currentDate.year;
            month = state.currentDate.month;
            day = state.currentDate.day;
        } else {
            // From direct state updates
            year = state.year;
            month = state.month;
            day = state.day;
        }

        const dateText = `Year ${year}, Month ${month}, Day ${day}`;

        const dateSpan = document.getElementById('calendar-current-date');
        if (dateSpan) {
            dateSpan.textContent = dateText;
        }
    }
}

export default CalendarDisplay;
