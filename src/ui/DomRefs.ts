// DomRefs - Centralized DOM element reference registry
// Avoids scattered document.getElementById() calls across modules
// Elements are lazily cached on first access

const cache = new Map<string, HTMLElement | null>();

function get(id: string): HTMLElement | null {
    if (cache.has(id)) return cache.get(id)!;
    const el = document.getElementById(id);
    cache.set(id, el);
    return el;
}

/** Clear the cache (call on HMR or major DOM changes) */
export function clearDomRefCache(): void {
    cache.clear();
}

/** Centralized DOM element references */
export const DomRefs = {
    // Layout
    get container() { return get('container'); },
    get stars() { return get('stars'); },

    // Main Menu
    get mainMenu() { return get('main-menu'); },
    get btnSingleplayer() { return get('btn-singleplayer'); },
    get btnNewGame() { return get('btn-new-game'); },
    get btnLoadGame() { return get('btn-load-game'); },
    get btnMultiplayer() { return get('btn-multiplayer'); },
    get btnStore() { return get('btn-store'); },
    get btnOptions() { return get('btn-options'); },
    get btnExit() { return get('btn-exit'); },

    // Dashboard
    get dashboard() { return get('dashboard'); },
    get popValue() { return get('pop-value'); },
    get menuBtn() { return get('menu-btn'); },
    get showStats() { return get('show-stats'); },
    get toggleHelp() { return get('toggle-help'); },

    // View Mode Selector
    get viewModeSelector() { return get('view-mode-selector'); },
    get viewModeTrigger() { return get('view-mode-trigger'); },
    get viewModeDropdown() { return get('view-mode-dropdown'); },
    get viewModeCurrent() { return get('view-mode-current'); },

    // Tile Info Panel
    get tileInfoPanel() { return get('tileInfoPanel'); },
    get tileInfoTitle() { return get('tileInfoTitle'); },
    get closeInfoPanel() { return get('closeInfoPanel'); },

    // Modals
    get menuModalOverlay() { return get('menu-modal-overlay'); },
    get helpModalOverlay() { return get('help-modal-overlay'); },
    get optionsModalOverlay() { return get('options-modal-overlay'); },
    get newGameSetupModal() { return get('new-game-setup-modal'); },
    get tileSearchModal() { return get('tile-search-modal'); },

    // Game Actions
    get resetData() { return get('reset-data'); },
    get saveGame() { return get('save-game'); },
    get loadGame() { return get('load-game'); },
    get backToMenu() { return get('back-to-menu'); },

    // Forms & Inputs
    get newGameForm() { return get('new-game-form') as HTMLFormElement | null; },
    get tileSearchInput() { return get('tile-search-input') as HTMLInputElement | null; },
    get tileSearchBtn() { return get('tile-search-btn'); },

    // Options
    get optionAnimateStars() { return get('option-animate-stars') as HTMLInputElement | null; },
    get optionShowMemory() { return get('option-show-memory') as HTMLInputElement | null; },

    // Sliders
    get landWaterRatio() { return get('land-water-ratio') as HTMLInputElement | null; },
    get landWaterValue() { return get('land-water-value'); },
    get roughness() { return get('roughness') as HTMLInputElement | null; },
    get roughnessValue() { return get('roughness-value'); },
};
