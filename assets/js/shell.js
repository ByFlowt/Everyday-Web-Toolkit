// Shared adaptive shell & zero-reload SPA hash router (WideNavigationRail + FloatingNavigationBar).
// No HTML injection sinks; updates textContent, hidden, dataset, and ARIA attributes only.

const RAIL_STORAGE_KEY = 'uiRailCollapsed';
const VALID_ROUTES = new Set(['dashboard', 'converter', 'calculator']);

const ROUTE_TITLES = Object.freeze({
    dashboard: { mobile: 'Übersicht', doc: 'Übersicht · Everyday Web Toolkit' },
    converter: { mobile: 'Konverter', doc: 'Sprach-Konverter · Everyday Web Toolkit' },
    calculator: { mobile: 'Arbeitszeit', doc: 'Arbeitszeit-Rechner · Everyday Web Toolkit' }
});

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

export function parseRoute(hash = window.location.hash) {
    const clean = String(hash ?? '').replace(/^#\/?/, '').trim().toLowerCase();
    return VALID_ROUTES.has(clean) ? clean : 'dashboard';
}

export function initShell() {
    const root = document.documentElement;
    const themeButtons = [...document.querySelectorAll('[data-theme-toggle]')];
    const railToggleButtons = [...document.querySelectorAll('[data-rail-toggle]')];
    const userNameNodes = [...document.querySelectorAll('[data-user-name]')];
    const userAvatarNodes = [...document.querySelectorAll('[data-user-avatar]')];
    const routeLinks = [...document.querySelectorAll('[data-route-link]')];
    const routeViews = [...document.querySelectorAll('.app-view[data-route]')];
    const mobileTitle = document.getElementById('mobileTopTitle');

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
            for (const label of button.querySelectorAll('[data-theme-label]')) {
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

    let currentRoute = parseRoute();

    function applyRoute(route, { focusHeading = false } = {}) {
        const target = VALID_ROUTES.has(route) ? route : 'dashboard';
        currentRoute = target;

        for (const view of routeViews) {
            view.hidden = view.dataset.route !== target;
        }
        for (const link of routeLinks) {
            if (link.dataset.routeLink === target) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        }

        const titles = ROUTE_TITLES[target] ?? ROUTE_TITLES.dashboard;
        if (mobileTitle) {
            mobileTitle.textContent = titles.mobile;
        }
        if (globalThis.sessionGuard?.getStatus?.().state === 'active') {
            document.title = titles.doc;
        } else {
            document.title = 'Everyday Web Toolkit';
        }

        if (focusHeading) {
            const activeView = routeViews.find((view) => view.dataset.route === target);
            const heading = activeView?.querySelector('h1');
            if (heading) {
                heading.focus();
            }
        }

        document.dispatchEvent(new CustomEvent('routechange', { detail: { route: target } }));
    }

    function navigate(route, { focusHeading = true } = {}) {
        const target = VALID_ROUTES.has(route) ? route : 'dashboard';
        const nextHash = `#${target}`;
        if (window.location.hash !== nextHash) {
            window.location.hash = nextHash;
            if (focusHeading) {
                const activeView = routeViews.find((view) => view.dataset.route === target);
                activeView?.querySelector('h1')?.focus();
            }
        } else {
            applyRoute(target, { focusHeading });
        }
    }

    function setNavBusy(route, busy) {
        for (const dot of document.querySelectorAll(`[data-nav-busy="${route}"]`)) {
            dot.hidden = !busy;
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

    window.addEventListener('hashchange', () => {
        applyRoute(parseRoute());
    });
    document.addEventListener('themechange', syncThemeControls);
    document.addEventListener('sessionchange', () => {
        syncUserBadge();
        applyRoute(parseRoute());
    });
    window.addEventListener('storage', (event) => {
        if (event.key === RAIL_STORAGE_KEY || event.key === null) {
            applyRailState(readRailCollapsed());
        }
    });

    applyRailState(readRailCollapsed());
    syncThemeControls();
    syncUserBadge();
    applyRoute(currentRoute);

    return {
        getRoute: () => currentRoute,
        navigate,
        setNavBusy
    };
}
