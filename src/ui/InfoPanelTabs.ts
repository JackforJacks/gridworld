// Info Panel Tab/Page Switching Logic
// Extracted from inline JS in index.html

const PAGES = 6;
const CLOSE_DEBOUNCE = 300;

declare global {
    interface Window {
        __tileSelectorJustClosed?: number;
    }
}

function switchPage(pageNum: number): void {
    if (window.__tileSelectorJustClosed && Date.now() - window.__tileSelectorJustClosed < CLOSE_DEBOUNCE) return;

    const panel = document.getElementById('tileInfoPanel');
    if (!panel) return;

    panel.classList.remove('hidden');
    panel.style.cssText = 'opacity:1;transform:translateY(0);pointer-events:auto;display:flex;';

    for (let i = 1; i <= PAGES; i++) {
        const page = document.getElementById('info-panel-page-' + i);
        const btn = document.getElementById('info-btn-' + i);
        if (page) page.classList.toggle('hidden', i !== pageNum);
        if (btn) btn.classList.toggle('active', i === pageNum);
    }
}

export function initializeInfoPanelTabs(): void {
    for (let i = 1; i <= PAGES; i++) {
        const btn = document.getElementById('info-btn-' + i);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                switchPage(i);
            });
        }
    }
}
