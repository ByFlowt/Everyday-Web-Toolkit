// Connects the session rules to the page. Classic script, loaded in <head> after session.js.
// <html data-page="protected"> redirects without a session; other pages get data-view and a "sessionchange" event.
(function () {
    'use strict';

    const CHECK_INTERVAL_MS = 15 * 1000;
    const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];

    const root = document.documentElement;
    const isProtected = root.dataset.page === 'protected';
    const session = globalThis.Session.create({
        getLocal: () => window.localStorage,
        getSession: () => window.sessionStorage
    });

    let status = { state: 'none' };
    let userAtLoad = null;

    function applyToProtectedPage() {
        if (status.state !== 'active') {
            root.removeAttribute('data-auth');
            window.location.replace('index.html');
            return;
        }
        if (userAtLoad === null) {
            userAtLoad = status.userName;
        } else if (userAtLoad !== status.userName) {
            // Someone else signed in from another tab: drop everything this page holds in memory.
            root.removeAttribute('data-auth');
            window.location.reload();
            return;
        }
        root.dataset.auth = 'ok';
    }

    function apply(next) {
        status = next;
        if (isProtected) {
            applyToProtectedPage();
            return;
        }
        root.dataset.view = status.state === 'active' ? 'dashboard' : 'login';
        document.dispatchEvent(new CustomEvent('sessionchange'));
    }

    function refresh() {
        apply(session.check());
    }

    // Re-checks right now. True only while an active user (matching userAtLoad on protected pages) is signed in.
    function isPageUserSignedIn() {
        refresh();
        if (status.state !== 'active') {
            return false;
        }
        return isProtected ? status.userName === userAtLoad : Boolean(status.userName);
    }

    function onActivity() {
        if (status.state !== 'active') {
            return;
        }
        const next = session.touch();
        if (next.state !== 'active' || next.userName !== status.userName) {
            apply(next);
        }
    }

    function logout() {
        session.logout();
        apply({ state: 'none' });
    }

    session.purgeLegacyData();
    refresh();

    for (const type of ACTIVITY_EVENTS) {
        window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    setInterval(refresh, CHECK_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refresh();
        }
    });
    // Keeps a back/forward-cache snapshot from flashing protected content before "pageshow" runs.
    window.addEventListener('pagehide', () => {
        root.removeAttribute('data-auth');
        root.removeAttribute('data-view');
    });
    document.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-logout]')) {
            logout();
        }
    });

    globalThis.sessionGuard = Object.freeze({
        getStatus: () => status,
        refresh,
        isPageUserSignedIn,
        start: (userName) => session.start(userName),
        hasExpiredNotice: () => session.hasExpiredNotice()
    });
})();
