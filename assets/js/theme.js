// Synchronous theme initializer (loaded in <head> after session-guard.js).
// Stores user preference in localStorage ('uiTheme': 'light' | 'dark'); absent means 'system'.
(function () {
    'use strict';

    const STORAGE_KEY = 'uiTheme';
    const ORDER = ['system', 'light', 'dark'];
    const root = document.documentElement;

    function readStored() {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY);
            return value === 'light' || value === 'dark' ? value : 'system';
        } catch {
            return 'system';
        }
    }

    function apply(mode) {
        if (mode === 'light' || mode === 'dark') {
            root.dataset.theme = mode;
        } else {
            root.removeAttribute('data-theme');
        }
        document.dispatchEvent(new CustomEvent('themechange', { detail: { mode } }));
    }

    function set(mode) {
        const normalized = mode === 'light' || mode === 'dark' ? mode : 'system';
        try {
            if (normalized === 'system') {
                window.localStorage.removeItem(STORAGE_KEY);
            } else {
                window.localStorage.setItem(STORAGE_KEY, normalized);
            }
        } catch {
            // Storage unavailable: apply for the current page load anyway.
        }
        apply(normalized);
        return normalized;
    }

    function cycle() {
        const current = readStored();
        const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        return set(next);
    }

    apply(readStored());

    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY || event.key === null) {
            apply(readStored());
        }
    });

    globalThis.uiTheme = Object.freeze({
        get: readStored,
        set,
        cycle,
        apply
    });
})();
