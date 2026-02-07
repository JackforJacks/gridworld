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
    isPaused?: boolean;
    totalDays?: number;
    totalTicks?: number;
    startTime?: string | null;
    lastTickTime?: string | null;
    config?: Record<string, unknown>;
    formatted?: Record<string, string | undefined>;
    currentSpeed?: string;
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
    private stopButton: HTMLButtonElement | null;
    private calendarMode: 'stopped' | 'running' | 'fast';
    private savedCalendarMode: 'stopped' | 'running' | 'fast' | null = null;
    private monthStepElements: HTMLDivElement[] = [];
    private lastDisplayedMonth: number = -1;
    private lastDisplayedDay: number = -1;
    private lastDisplayedYear: number = -1;

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

        // Control button references
        this.stopButton = null;
        this.calendarMode = 'stopped'; // 'stopped' | 'running' | 'fast'

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
        const rightElements = document.getElementById('dashboard-right-elements');
        if (!rightElements) return;

        // Insert dynamic elements (controls + year label) before the menu button
        const menuBtn = document.getElementById('menu-btn');

        // Create control button (start/stop/fast)
        const controlsContainer = document.createElement('div');
        controlsContainer.id = 'calendar-controls';
        controlsContainer.className = 'calendar-controls';

        this.stopButton = document.createElement('button');
        this.stopButton.id = 'calendar-control-btn';
        this.stopButton.className = 'calendar-control-btn';
        this.stopButton.textContent = '⏹️';
        this.stopButton.title = 'Calendar Stopped - Click to Run';
        this.stopButton.addEventListener('click', () => this.cycleCalendarMode());
        controlsContainer.appendChild(this.stopButton);

        // Create year label
        const yearLabel = document.createElement('span');
        yearLabel.id = 'calendar-year-inline';
        yearLabel.className = 'calendar-year-inline';

        // Insert before menu button (or append if menu button not found)
        rightElements.insertBefore(controlsContainer, menuBtn);
        rightElements.insertBefore(yearLabel, menuBtn);
    }

    /**
     * Cycle through calendar modes: stopped -> running -> fast -> stopped
     */
    private async cycleCalendarMode(): Promise<void> {
        if (!this.calendarManager) return;

        try {
            switch (this.calendarMode) {
                case 'stopped':
                    // Start at normal speed (1 day/sec)
                    await this.calendarManager.setSpeed('1_day');
                    await this.calendarManager.start();
                    this.calendarMode = 'running';
                    break;
                case 'running':
                    // Switch to fast mode (1 month/sec)
                    await this.calendarManager.setSpeed('1_month');
                    this.calendarMode = 'fast';
                    break;
                case 'fast':
                    // Stop the calendar
                    await this.calendarManager.stop();
                    this.calendarMode = 'stopped';
                    break;
            }
            this.updateModeButton();
        } catch (error: unknown) {
            console.error('Error cycling calendar mode:', error);
        }
    }

    /**
     * Pause the calendar, saving the current mode so it can be resumed later.
     */
    async pauseCalendar(): Promise<void> {
        if (this.calendarMode === 'stopped' || this.savedCalendarMode !== null) return;
        this.savedCalendarMode = this.calendarMode;
        try {
            await this.calendarManager?.stop();
        } catch { /* silent */ }
        this.calendarMode = 'stopped';
        this.updateModeButton();
    }

    /**
     * Resume the calendar to the mode it was in before pauseCalendar() was called.
     */
    async resumeCalendar(): Promise<void> {
        if (this.savedCalendarMode === null || !this.calendarManager) return;
        const mode = this.savedCalendarMode;
        this.savedCalendarMode = null;
        try {
            if (mode === 'running') {
                await this.calendarManager.setSpeed('1_day');
                await this.calendarManager.start();
                this.calendarMode = 'running';
            } else if (mode === 'fast') {
                await this.calendarManager.setSpeed('1_month');
                await this.calendarManager.start();
                this.calendarMode = 'fast';
            }
            this.updateModeButton();
        } catch { /* silent */ }
    }

    /**
     * Update the mode button icon and title based on current mode
     */
    private updateModeButton(): void {
        if (!this.stopButton) return;

        switch (this.calendarMode) {
            case 'stopped':
                this.stopButton.textContent = '⏹️';
                this.stopButton.title = 'Calendar Stopped - Click to Run';
                break;
            case 'running':
                this.stopButton.textContent = '▶️';
                this.stopButton.title = 'Running (1 day/sec) - Click for Fast';
                break;
            case 'fast':
                this.stopButton.textContent = '⏩';
                this.stopButton.title = 'Fast (1 month/sec) - Click to Stop';
                break;
        }
    }

    /**
     * Update control button states based on calendar state.
     * Skipped while the calendar is paused by a modal so the saved mode is preserved.
     */
    private updateControlButtons(state: CalendarState): void {
        if (this.savedCalendarMode !== null) return;

        const isRunning = state.isRunning !== false && state.isPaused !== true;
        const currentSpeed = state.currentSpeed || '1_day';

        // Determine mode from state
        if (!isRunning) {
            this.calendarMode = 'stopped';
        } else if (currentSpeed === '1_month' || currentSpeed === '1 Month/sec') {
            this.calendarMode = 'fast';
        } else {
            this.calendarMode = 'running';
        }

        this.updateModeButton();
    }

    /**
     * Draw the 12-step circular month progress indicator.
     * Elements are created once and cached; subsequent calls only toggle CSS classes.
     * @param currentMonth - Current month (1-12)
     * @param _day - Current day of month (unused)
     * @param _year - Current year (unused)
     */
    private drawMonthSteps(currentMonth: number, _day: number, _year: number): void {
        // Skip if month hasn't changed
        if (currentMonth === this.lastDisplayedMonth && this.monthStepElements.length === 12) return;
        this.lastDisplayedMonth = currentMonth;

        // Build elements once, then reuse
        if (this.monthStepElements.length !== 12) {
            const container = document.getElementById('calendar-month-steps');
            if (!container) return;

            container.innerHTML = '';
            this.monthStepElements = [];

            const steps = 12;
            const radius = this.monthStepRadius;
            const size = this.monthDotSize;
            const centerPoint = this.calendarSize / 2;

            for (let i = 0; i < steps; i++) {
                const angle = (i / steps) * 2 * Math.PI - Math.PI / 2;
                const x = Math.cos(angle) * radius + centerPoint - size / 2;
                const y = Math.sin(angle) * radius + centerPoint - size / 2;

                const step = document.createElement('div');
                step.style.left = `${x}px`;
                step.style.top = `${y}px`;
                container.appendChild(step);
                this.monthStepElements.push(step);
            }
        }

        // Toggle active class on cached elements
        for (let i = 0; i < 12; i++) {
            const isActive = i + 1 === currentMonth;
            this.monthStepElements[i].className = isActive
                ? 'month-step month-step-active'
                : 'month-step month-step-inactive';
        }
    }

    /**
     * Setup event listeners for calendar updates
     */
    private setupEventListeners(): void {
        if (!this.calendarManager) return;

        // Store handler so we can remove it later in destroy()
        // Only subscribe to stateChanged – calendarTick already triggers
        // updateState() inside CalendarManager which emits stateChanged,
        // so subscribing to both would call updateDateDisplay twice per tick.
        this.stateChangedHandler = (...args: unknown[]): void => {
            const state = args[0] as CalendarState;
            this.updateDateDisplay(state);
        };

        this.tickHandler = null; // Not used – stateChanged covers ticks

        // Listen for calendar state changes (fires on every tick + manual actions)
        this.calendarManager.on('stateChanged', this.stateChangedHandler);
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

        // Skip redundant DOM writes when nothing changed
        if (day === this.lastDisplayedDay && month === this.lastDisplayedMonth && year === this.lastDisplayedYear) {
            // Only update control buttons (isRunning may have toggled)
            this.updateControlButtons(state);
            return;
        }
        this.lastDisplayedDay = day;
        // lastDisplayedMonth and lastDisplayedYear updated in their respective methods

        // Get moon phase emoji based on day
        const moonEmoji = this.getMoonPhaseEmoji(day);

        // Update UI elements
        this.updateMoonPhase(moonEmoji);
        this.updateYearLabel(year, month);
        this.drawMonthSteps(month, day, year);

        // Update control buttons state
        this.updateControlButtons(state);
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
        if (year === this.lastDisplayedYear && month === this.lastDisplayedMonth) return;
        this.lastDisplayedYear = year;

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

        // Remove dynamically inserted elements
        document.getElementById('calendar-controls')?.remove();
        document.getElementById('calendar-year-inline')?.remove();

        // Clear references
        this.calendarManager = null;
        this.dateElement = null;
        this.stopButton = null;
    }
}

export default CalendarDisplay;
