/* Star background generator - Optimized version */
const STARS_CONFIG = {
    COUNT: 200,
    COLORS: ['#ffff99', '#ffffff', '#99ccff', '#ff9999'],
    SIZE: { min: 0.5, max: 3 },
    ANIMATION: {
        DELAY_MAX: 2,
        DURATION_MIN: 1,
        DURATION_MAX: 4
    }
};

/**
 * Create star background with optimized DOM insertion
 * Uses DocumentFragment to batch insertions and minimize reflows
 */
function createStars() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;

    // Use DocumentFragment to batch DOM operations
    // This reduces 200 reflows to just 1 reflow
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < STARS_CONFIG.COUNT; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.setProperty('--star-left', `${Math.random() * 100}%`);
        star.style.setProperty('--star-top', `${Math.random() * 100}%`);

        const size = STARS_CONFIG.SIZE.min + Math.random() * (STARS_CONFIG.SIZE.max - STARS_CONFIG.SIZE.min);
        star.style.setProperty('--star-size', `${size}px`);

        const color = STARS_CONFIG.COLORS[Math.floor(Math.random() * STARS_CONFIG.COLORS.length)];
        star.style.setProperty('--star-color', color);
        star.style.setProperty('--star-shadow-size', `${size * 2}px`);

        star.style.setProperty('--star-animation-delay', `${Math.random() * STARS_CONFIG.ANIMATION.DELAY_MAX}s`);
        star.style.setProperty('--star-animation-duration', `${STARS_CONFIG.ANIMATION.DURATION_MIN + Math.random() * (STARS_CONFIG.ANIMATION.DURATION_MAX - STARS_CONFIG.ANIMATION.DURATION_MIN)}s`);

        fragment.appendChild(star);
    }

    // Single DOM insertion - reduces reflow from 200 to 1
    starsContainer.appendChild(fragment);
}

// Initialize stars when DOM is loaded (fallback)
document.addEventListener('DOMContentLoaded', createStars);

// Export for lazy loading
export default createStars;
