import CalendarManager from '../../managers/calendar/CalendarManager';

/**
 * Calendar date information extracted from state
 */
interface CalendarDateInfo {
    year: number;
    month: number;
    day: number;
}

/**
 * Calendar state object from CalendarManager
 */
interface CalendarState {
    year?: number;
    month?: number;
    day?: number;
    currentDate?: CalendarDateInfo;
    isRunning?: boolean;
    totalDays?: number;
    totalTicks?: number;
    startTime?: string | null;
    lastTickTime?: string | null;
    config?: Record<string, unknown>;
    formatted?: Record<string, string | undefined>;
}

/**
 * State change event handler type - uses unknown to match CalendarManager's callback type
 */
type StateChangeHandler = (...args: unknown[]) => void;

/**
 * CalendarDisplay - Interactive calendar widget for the dashboard
 * Shows current date information with a clean, visually appealing circular interface
 */
class CalendarDisplay {
    private calendarManager: CalendarManager | null;
    private dateElement: HTMLDivElement | null;
    private readonly moonPhases: readonly string[];
    private readonly calendarSize: number;
    private readonly moonButtonSize: number;
    private readonly monthStepRadius: number;
    private readonly monthDotSize: number;
    private stateChangedHandler: StateChangeHandler | null;
    private tickHandler: StateChangeHandler | null;

    constructor(calendarManager: CalendarManager) {
        this.calendarManager = calendarManager;
        this.dateElement = null;
        this.moonPhases = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'] as const;

        // Default calendar dimensions
        this.calendarSize = 110; // px
        this.moonButtonSize = 64; // px
        this.monthStepRadius = 44; // px
        this.monthDotSize = 8; // px

        // Event handler references (for cleanup)
        this.stateChangedHandler = null;
        this.tickHandler = null;

        // Initialize the component
        this.init();
    }

    /**
     * Initialize the calendar display component
     */
    private async init(): Promise<void> {
        this.createDateDisplay();
        this.createDashboardElements();
        this.setupEventListeners();
        this.updateDisplay();
    }

    /**
     * Create the date display element in the dashboard
     */
    private createDateDisplay(): void {
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
    private buildCalendarHTML(): string {
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
    private createDashboardElements(): void {
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
    private createRightElementsContainer(): HTMLDivElement {
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
    private createYearLabel(): HTMLSpanElement {
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
    private positionHelpButton(container: HTMLElement): void {
        const helpBtn = document.getElementById('toggle-help');
        if (helpBtn && helpBtn.parentNode) {
            helpBtn.parentNode.removeChild(helpBtn);
            container.appendChild(helpBtn);
        }
    }

    /**
     * Draw the 12-step circular month progress indicator
     * @param currentMonth - Current month (1-12)
     * @param _day - Current day of month (unused)
     * @param _year - Current year (unused)
     */
    private drawMonthSteps(currentMonth: number, _day: number, _year: number): void {
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
     * @param x - X position
     * @param y - Y position
     * @param _size - Dot size (unused, controlled by CSS)
     * @param isActive - Whether this is the current month
     * @returns The created dot element
     */
    private createMonthStep(x: number, y: number, _size: number, isActive: boolean): HTMLDivElement {
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
    private setupEventListeners(): void {
        if (!this.calendarManager) return;

        // Store handlers so we can remove them later in destroy()
        this.stateChangedHandler = (...args: unknown[]): void => {
            const state = args[0] as CalendarState;
            this.updateDateDisplay(state);
        };

        this.tickHandler = (...args: unknown[]): void => {
            const state = args[0] as CalendarState;
            this.updateDateDisplay(state);
        };

        // Listen for calendar state changes
        this.calendarManager.on('stateChanged', this.stateChangedHandler);

        // Listen for calendar tick events
        this.calendarManager.on('tick', this.tickHandler);
    }

    /**
     * Update the date display with current calendar state
     */
    private async updateDisplay(): Promise<void> {
        try {
            const state = await this.calendarManager?.getState();
            if (state) {
                // Cast to local CalendarState type - compatible structure
                this.updateDateDisplay(state as unknown as CalendarState);
            }
        } catch (error: unknown) {
            console.error('Failed to get calendar state:', error);
        }
    }

    /**
     * Extract date information from calendar state
     * @param state - Calendar state object
     * @returns Extracted date values
     */
    private extractDateInfo(state: CalendarState | null): CalendarDateInfo {
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
     * @param state - Calendar state object
     */
    private updateDateDisplay(state: CalendarState): void {
        if (!this.dateElement || !state) return;

        // Extract date information
        const { year, month, day } = this.extractDateInfo(state);

        // Get moon phase emoji based on day
        const moonEmoji = this.getMoonPhaseEmoji(day);

        // Update UI elements
        this.updateMoonPhase(moonEmoji);
        this.updateYearLabel(year, month);
        this.drawMonthSteps(month, day, year);
    }

    /**
     * Get the appropriate moon phase emoji for the given day
     * @param day - Current day
     * @returns Moon phase emoji
     */
    private getMoonPhaseEmoji(day: number): string {
        return this.moonPhases[(day - 1) % 8] || '🌑';
    }

    /**
     * Update the moon phase display
     * @param emoji - Moon phase emoji to display
     */
    private updateMoonPhase(emoji: string): void {
        const moonSpan = document.getElementById('calendar-moon-emoji');
        if (moonSpan) moonSpan.textContent = emoji;

        const dayLabel = document.getElementById('calendar-day-label');
        if (dayLabel) dayLabel.textContent = '';
    }

    /**
     * Get season emoji from month number
     * @param month - Month number (1-12)
     * @returns Season emoji
     */
    private getSeasonEmoji(month: number): string {
        // Winter (months 12, 1, 2), Spring (3-5), Summer (6-8), Autumn (9-11)
        if (month === 12 || month === 1 || month === 2) return '❄️';
        if (month >= 3 && month <= 5) return '🌸';
        if (month >= 6 && month <= 8) return '☀️';
        return '🍂';
    }

    /**
     * Update the year label with current year and season
     * @param year - Current year
     * @param month - Current month (1-12)
     */
    private updateYearLabel(year: number, month: number): void {
        const yearLabel = document.getElementById('calendar-year-inline');
        if (yearLabel) {
            yearLabel.textContent = `${this.getSeasonEmoji(month)} ${year}`;
        }

        // Remove year from below the calendar (keep only inline)
        const dateLabel = document.getElementById('calendar-date-label');
        if (dateLabel) {
            dateLabel.textContent = '';
        }
    }

    /**
     * Clean up event listeners and resources
     */
    public destroy(): void {
        if (this.calendarManager) {
            if (this.stateChangedHandler) {
                this.calendarManager.off('stateChanged', this.stateChangedHandler);
                this.stateChangedHandler = null;
            }
            if (this.tickHandler) {
                this.calendarManager.off('tick', this.tickHandler);
                this.tickHandler = null;
            }
        }

        // Remove DOM element if present
        if (this.dateElement && this.dateElement.parentNode) {
            this.dateElement.parentNode.removeChild(this.dateElement);
        }

        // Clear references
        this.calendarManager = null;
        this.dateElement = null;
    }
}

export default CalendarDisplay;
