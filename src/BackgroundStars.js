/* Star background generator - Standalone version */
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

function createStars() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;

    for (let i = 0; i < STARS_CONFIG.COUNT; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;

        const size = STARS_CONFIG.SIZE.min + Math.random() * (STARS_CONFIG.SIZE.max - STARS_CONFIG.SIZE.min);
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;

        const color = STARS_CONFIG.COLORS[Math.floor(Math.random() * STARS_CONFIG.COLORS.length)];
        star.style.background = color;
        star.style.boxShadow = `0 0 ${size * 2}px ${color}`;

        star.style.animationDelay = `${Math.random() * STARS_CONFIG.ANIMATION.DELAY_MAX}s`;
        star.style.animationDuration = `${STARS_CONFIG.ANIMATION.DURATION_MIN +
            Math.random() * (STARS_CONFIG.ANIMATION.DURATION_MAX - STARS_CONFIG.ANIMATION.DURATION_MIN)
            }s`;

        starsContainer.appendChild(star);
    }
}

// Initialize stars when DOM is loaded (fallback)
document.addEventListener('DOMContentLoaded', createStars);

// Export for lazy loading
export default createStars;
