// World Configuration Slider Controls
// Extracted from inline JS in index.html

export function initializeSliders(): void {
    const landWaterSlider = document.getElementById('land-water-ratio') as HTMLInputElement | null;
    const landWaterValue = document.getElementById('land-water-value');
    const roughnessSlider = document.getElementById('roughness') as HTMLInputElement | null;
    const roughnessValue = document.getElementById('roughness-value');

    if (landWaterSlider && landWaterValue) {
        landWaterSlider.addEventListener('input', function () {
            landWaterValue.textContent = this.value + '%';
        });
    }

    if (roughnessSlider && roughnessValue) {
        roughnessSlider.addEventListener('input', function () {
            roughnessValue.textContent = this.value + '%';
        });
    }
}
