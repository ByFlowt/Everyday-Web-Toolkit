// Where the Gemini API key lives: sessionStorage by default, localStorage only on opt-in.
// No DOM lookups; storages are injected as getters because accessing them can throw.
// Key names come from session.js, which also removes the key on logout.

export function createKeyStore({ getLocal, getSession, getUserName, keys }) {
    function load() {
        try {
            const remembered = getLocal().getItem(keys.apiKey);
            if (remembered !== null) {
                return { key: remembered, remember: true };
            }
            return { key: getSession().getItem(keys.apiKey) ?? '', remember: false };
        } catch {
            return { key: '', remember: false };
        }
    }

    function removeTabCopy() {
        getSession().removeItem(keys.apiKey);
        getSession().removeItem(keys.apiKeyOwner);
    }

    function clear() {
        try {
            getLocal().removeItem(keys.apiKey);
            removeTabCopy();
            return true;
        } catch {
            return false;
        }
    }

    // Always leaves at most one stored copy. Returns false if the browser refused.
    function save(key, remember) {
        if (!clear()) return false;
        if (!key) return true;
        try {
            if (remember) {
                getLocal().setItem(keys.apiKey, key);
            } else {
                getSession().setItem(keys.apiKey, key);
                getSession().setItem(keys.apiKeyOwner, getUserName());
            }
            return true;
        } catch {
            return false;
        }
    }

    // Another tab changed the remembered key. This tab's own copy goes, so a deleted key cannot come back.
    function adoptSharedChange() {
        try {
            removeTabCopy();
        } catch {
            // load() reports an empty key if storage is unusable.
        }
        return load();
    }

    return { load, save, clear, adoptSharedChange };
}

// Keeps the key field and the "remember" switch in step with storage.
export function createKeyControls({ keyStore, keys, input, rememberSwitch, isSessionValid, onSaveError }) {
    function show({ key, remember }) {
        input.value = key;
        rememberSwitch.checked = remember;
    }

    function restore() {
        if (isSessionValid()) {
            show(keyStore.load());
        }
    }

    // For user edits only: writing at any other time could undo a deletion made in another tab.
    function persist() {
        // Re-checked right now, so an expired session cannot write the key back.
        if (!isSessionValid()) {
            return;
        }
        if (!keyStore.save(input.value.trim(), rememberSwitch.checked)) {
            onSaveError();
        }
    }

    // For "storage" events; a null key means the whole storage was cleared.
    function sync(changedKey) {
        if ((changedKey === keys.apiKey || changedKey === null) && isSessionValid()) {
            show(keyStore.adoptSharedChange());
        }
    }

    return { restore, persist, sync };
}
