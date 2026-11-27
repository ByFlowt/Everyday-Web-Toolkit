// Session rules without any DOM access.
// Classic script (so the guard can run synchronously in <head>); also importable by node tests.
(function () {
    'use strict';

    const KEYS = Object.freeze({
        auth: 'isAuth',
        user: 'userName',
        activity: 'lastActivity',
        apiKey: 'geminiApiKey',
        // sessionStorage is per tab: remembers whose API key a tab is holding.
        apiKeyOwner: 'geminiApiKeyOwner',
        // Shared by all tabs: whichever tab notices the expiry first, every login page can say so.
        expiredNotice: 'sessionExpired',
        legacyUsers: 'usersOverride'
    });
    const TIMEOUT_MS = 60 * 60 * 1000;
    const WRITE_THROTTLE_MS = 15 * 1000;
    const MAX_CLOCK_SKEW_MS = 60 * 1000;

    function isExpired(rawTimestamp, now) {
        // Checked as a string first: Number(null) and Number('') are 0.
        if (typeof rawTimestamp !== 'string' || !/^\d+$/.test(rawTimestamp)) {
            return true;
        }
        const timestamp = Number(rawTimestamp);
        return timestamp - now > MAX_CLOCK_SKEW_MS || now - timestamp > TIMEOUT_MS;
    }

    function attempt(action) {
        try {
            action();
            return true;
        } catch {
            return false;
        }
    }

    // getLocal/getSession are functions because merely reading window.localStorage can throw.
    function create({ getLocal, getSession, now = Date.now }) {
        function clearApiKey() {
            attempt(() => getLocal().removeItem(KEYS.apiKey));
            attempt(() => getSession().removeItem(KEYS.apiKey));
            attempt(() => getSession().removeItem(KEYS.apiKeyOwner));
        }

        function end() {
            // isAuth goes first so other tabs never see a half-removed session as active.
            for (const key of [KEYS.auth, KEYS.user, KEYS.activity]) {
                attempt(() => getLocal().removeItem(key));
            }
            clearApiKey();
        }

        function discardForeignApiKey(userName) {
            attempt(() => {
                const tab = getSession();
                const owner = tab.getItem(KEYS.apiKeyOwner);
                if (owner !== null && owner !== userName) {
                    tab.removeItem(KEYS.apiKey);
                    tab.removeItem(KEYS.apiKeyOwner);
                }
            });
        }

        // Returns { state: 'active' | 'expired' | 'none' | 'unavailable', userName? }.
        function check() {
            try {
                const store = getLocal();
                if (store.getItem(KEYS.auth) !== 'true') {
                    clearApiKey();
                    return { state: 'none' };
                }
                if (isExpired(store.getItem(KEYS.activity), now())) {
                    end();
                    attempt(() => getLocal().setItem(KEYS.expiredNotice, '1'));
                    return { state: 'expired' };
                }
                const userName = store.getItem(KEYS.user) || '';
                discardForeignApiKey(userName);
                return { state: 'active', userName };
            } catch {
                end();
                return { state: 'unavailable' };
            }
        }

        // Records user activity. Expiry is checked first, so activity cannot revive a dead session.
        function touch() {
            const status = check();
            if (status.state !== 'active') {
                return status;
            }
            try {
                const store = getLocal();
                const time = now();
                if (time - Number(store.getItem(KEYS.activity)) >= WRITE_THROTTLE_MS) {
                    store.setItem(KEYS.activity, String(time));
                }
                return status;
            } catch {
                end();
                return { state: 'unavailable' };
            }
        }

        function start(userName) {
            clearExpiredNotice();
            const stored = attempt(() => {
                const store = getLocal();
                // isAuth is written last, see end().
                store.setItem(KEYS.activity, String(now()));
                store.setItem(KEYS.user, userName);
                store.setItem(KEYS.auth, 'true');
            });
            if (!stored) {
                end();
            }
            return stored;
        }

        function clearExpiredNotice() {
            attempt(() => getLocal().removeItem(KEYS.expiredNotice));
        }

        // True from an expiry until the next login or deliberate logout.
        function hasExpiredNotice() {
            let expired = false;
            attempt(() => { expired = getLocal().getItem(KEYS.expiredNotice) === '1'; });
            return expired;
        }

        // A deliberate logout, as opposed to end() after an expiry.
        function logout() {
            end();
            clearExpiredNotice();
        }

        // Earlier versions kept plaintext passwords under this key.
        function purgeLegacyData() {
            attempt(() => getLocal().removeItem(KEYS.legacyUsers));
        }

        return { check, touch, start, end, logout, hasExpiredNotice, purgeLegacyData };
    }

    globalThis.Session = Object.freeze({
        KEYS,
        TIMEOUT_MS,
        WRITE_THROTTLE_MS,
        MAX_CLOCK_SKEW_MS,
        isExpired,
        create
    });
})();
