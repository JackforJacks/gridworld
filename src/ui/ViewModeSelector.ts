// View Mode Selector - Custom dropdown component
// Extracted from inline JS in index.html

let currentValue = 'terrain';

export function initializeViewModeSelector(): void {
    const wrapper = document.querySelector('.custom-select-wrapper') as HTMLElement | null;
    const trigger = document.getElementById('view-mode-trigger');
    const dropdown = document.getElementById('view-mode-dropdown');
    const currentText = document.getElementById('view-mode-current');
    const options = document.querySelectorAll('.custom-select-option');

    if (!wrapper || !trigger || !dropdown || !currentText) {
        return;
    }

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        wrapper.classList.toggle('open');
    });

    // Prevent mousedown from propagating (better responsiveness)
    trigger.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // Select option
    options.forEach((option) => {
        option.addEventListener('click', function (this: HTMLElement, e: Event) {
            e.preventDefault();
            e.stopPropagation();
            const value = this.getAttribute('data-value') || '';
            const text = this.textContent || '';

            currentValue = value;
            currentText.textContent = text;

            options.forEach((opt) => opt.classList.remove('selected'));
            this.classList.add('selected');

            wrapper.classList.remove('open');

            document.dispatchEvent(new CustomEvent('viewModeChange', {
                detail: { value, text }
            }));
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target as Node)) {
            wrapper.classList.remove('open');
        }
    });

    // Set initial selected state
    const initialOption = dropdown.querySelector('[data-value="terrain"]');
    if (initialOption) {
        initialOption.classList.add('selected');
    }
}

export function getCurrentViewModeValue(): string {
    return currentValue;
}
