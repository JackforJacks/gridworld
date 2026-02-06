/* Star background generator - Optimized version */
const STARS_CONFIG = {
    COUNT: 200,  // Number of stars in background
    COLORS: ['#ffff99', '#ffffff', '#99ccff', '#ff9999'],
    SIZE: { min: 0.5, max: 3 },
    ANIMATION: {
        DELAY_MAX: 2,
        DURATION_MIN: 1,
        DURATION_MAX: 4
    }
};

let starsCreated = false;

/**
 * Create star background with optimized DOM insertion
 * Uses DocumentFragment to batch insertions and minimizes reflows
 */
function createStars() {
    if (starsCreated) return; // Prevent duplicate stars
    starsCreated = true;

    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;

    // Clear existing stars first
    starsContainer.innerHTML = '';

    // Use CSS instead of individual DOM elements where possible
    // Create a single CSS gradient for most stars, only animate a few
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < STARS_CONFIG.COUNT; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        
        // Use CSS custom properties sparingly
        const size = STARS_CONFIG.SIZE.min + Math.random() * (STARS_CONFIG.SIZE.max - STARS_CONFIG.SIZE.min);
        const left = Math.random() * 100;
        const top = Math.random() * 100;
        
        // Batch style changes
        star.style.cssText = `
            position: absolute;
            left: ${left}%;
            top: ${top}%;
            width: ${size}px;
            height: ${size}px;
            background: ${STARS_CONFIG.COLORS[Math.floor(Math.random() * STARS_CONFIG.COLORS.length)]};
            border-radius: 50%;
            opacity: ${0.5 + Math.random() * 0.5};
        `;

        // Only animate 20% of stars to reduce GPU load
        if (i < STARS_CONFIG.COUNT * 0.2) {
            star.style.animation = `twinkle ${STARS_CONFIG.ANIMATION.DURATION_MIN + Math.random() * (STARS_CONFIG.ANIMATION.DURATION_MAX - STARS_CONFIG.ANIMATION.DURATION_MIN)}s infinite alternate`;
            star.style.animationDelay = `${Math.random() * STARS_CONFIG.ANIMATION.DELAY_MAX}s`;
        }

        fragment.appendChild(star);
    }

    starsContainer.appendChild(fragment);
}

// Initialize stars when DOM is loaded
document.addEventListener('DOMContentLoaded', createStars);

// Export for lazy loading
export default createStars;
