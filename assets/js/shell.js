// Shared adaptive shell wiring (WideNavigationRail, ShortNavigationBar, theme toggle, user badge).
// No HTML injection sinks; updates textContent, dataset, and ARIA attributes only.

const RAIL_STORAGE_KEY = 'uiRailCollapsed';

const THEME_META = Object.freeze({
    system: { icon: 'brightness_auto', label: 'System', aria: 'Design wechseln: aktuell System' },
    light: { icon: 'light_mode', label: 'Hell', aria: 'Design wechseln: aktuell Hell' },
    dark: { icon: 'dark_mode', label: 'Dunkel', aria: 'Design wechseln: aktuell Dunkel' }
});

function readRailCollapsed() {
    try {
        return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function writeRailCollapsed(collapsed) {
    try {
        if (collapsed) {
            window.localStorage.setItem(RAIL_STORAGE_KEY, '1');
        } else {
            window.localStorage.removeItem(RAIL_STORAGE_KEY);
        }
    } catch {
        // Ignore storage errors; rail still toggles for this page session.
    }
}

export function initShell() {
    const root = document.documentElement;
    const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
    const railToggleButtons = [...document.querySelectorAll('[data-rail-toggle]')];
    const userNameNodes = [...document.querySelectorAll('[data-user-name]')];
    const userAvatarNodes = [...document.querySelectorAll('[data-user-avatar]')];

    function syncThemeControls() {
        const mode = globalThis.uiTheme?.get?.() ?? 'system';
        const meta = THEME_META[mode] ?? THEME_META.system;
        for (const button of themeButtons) {
            button.setAttribute('aria-label', meta.aria);
            button.setAttribute('title', meta.aria);
            const icon = button.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = meta.icon;
            }
            const label = button.querySelector('[data-theme-label]');
            if (label) {
                label.textContent = meta.label;
            }
        }
    }

    function applyRailState(collapsed) {
        if (collapsed) {
            root.dataset.rail = 'collapsed';
        } else {
            root.removeAttribute('data-rail');
        }
        for (const button of railToggleButtons) {
            button.setAttribute('aria-expanded', String(!collapsed));
            const label = collapsed ? 'Navigation ausklappen' : 'Navigation einklappen';
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            const icon = button.querySelector('.material-symbols-outlined');
            if (icon) {
                icon.textContent = collapsed ? 'menu' : 'menu_open';
            }
        }
    }

    function syncUserBadge() {
        const status = globalThis.sessionGuard?.getStatus?.();
        const userName = status?.state === 'active' && status.userName ? status.userName : '';
        const initial = userName ? Array.from(userName)[0].toUpperCase() : 'U';
        for (const node of userNameNodes) {
            node.textContent = userName || 'Angemeldet';
        }
        for (const node of userAvatarNodes) {
            node.textContent = initial;
        }
    }

    for (const button of themeButtons) {
        button.addEventListener('click', () => {
            globalThis.uiTheme?.cycle?.();
            syncThemeControls();
        });
    }

    for (const button of railToggleButtons) {
        button.addEventListener('click', () => {
            const nextCollapsed = root.dataset.rail !== 'collapsed';
            writeRailCollapsed(nextCollapsed);
            applyRailState(nextCollapsed);
        });
    }

    document.addEventListener('themechange', syncThemeControls);
    document.addEventListener('sessionchange', syncUserBadge);
    window.addEventListener('storage', (event) => {
        if (event.key === RAIL_STORAGE_KEY || event.key === null) {
            applyRailState(readRailCollapsed());
        }
    });

    applyRailState(readRailCollapsed());
    syncThemeControls();
    syncUserBadge();
}
