import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import '../assets/js/session.js';
import { createKeyControls, createKeyStore } from '../assets/js/key-store.js';
import { setupSecretField } from '../assets/js/secret-field.js';

const { Session } = globalThis;
const { KEYS, TIMEOUT_MS, WRITE_THROTTLE_MS, MAX_CLOCK_SKEW_MS } = Session;
const START = 1_800_000_000_000;
const FAKE_KEY = 'fake-api-key-for-tests';

function fakeStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    const writes = [];
    return {
        writes,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { writes.push(key); data.set(key, String(value)); },
        removeItem: (key) => { data.delete(key); }
    };
}

function setup() {
    const local = fakeStorage();
    const tab = fakeStorage();
    const clock = { time: START };
    const session = Session.create({ getLocal: () => local, getSession: () => tab, now: () => clock.time });
    const keyStore = createKeyStore({
        getLocal: () => local,
        getSession: () => tab,
        getUserName: () => session.check().userName,
        keys: KEYS
    });
    return { local, tab, clock, session, keyStore };
}

test('the timeout is 60 minutes and activity writes are throttled to 15 s', () => {
    assert.equal(TIMEOUT_MS, 60 * 60 * 1000);
    assert.equal(WRITE_THROTTLE_MS, 15 * 1000);
});

test('isExpired treats missing, malformed and far-future timestamps as expired', () => {
    for (const raw of [null, undefined, '', ' ', 'abc', '-1', '1e15', 'Infinity', 'NaN', 0, START]) {
        assert.equal(Session.isExpired(raw, START), true, String(raw));
    }
    assert.equal(Session.isExpired('0', START), true);
    assert.equal(Session.isExpired(String(START + MAX_CLOCK_SKEW_MS + 1), START), true);
    assert.equal(Session.isExpired(String(START + 1000), START), false);
    assert.equal(Session.isExpired(String(START - TIMEOUT_MS), START), false);
    assert.equal(Session.isExpired(String(START - TIMEOUT_MS - 1), START), true);
});

test('start, check and end', () => {
    const { session, local } = setup();
    assert.deepEqual(session.check(), { state: 'none' });
    assert.equal(session.start('Testperson'), true);
    assert.equal(local.writes.at(-1), KEYS.auth, 'isAuth must be written last');
    assert.deepEqual(session.check(), { state: 'active', userName: 'Testperson' });
    session.end();
    assert.deepEqual(session.check(), { state: 'none' });
    for (const key of [KEYS.auth, KEYS.user, KEYS.activity]) {
        assert.equal(local.getItem(key), null);
    }
});

test('a session without lastActivity is expired', () => {
    const { session, local } = setup();
    local.setItem(KEYS.auth, 'true');
    assert.equal(session.check().state, 'expired');
});

test('activity after expiry does not revive the session', () => {
    const { session, local, clock } = setup();
    session.start('Testperson');
    clock.time += TIMEOUT_MS + 1;
    assert.equal(session.touch().state, 'expired');
    assert.equal(local.getItem(KEYS.activity), null);
    assert.equal(session.touch().state, 'none');
    assert.equal(session.check().state, 'none');
    assert.equal(session.hasExpiredNotice(), true);
});

test('every tab sees the expiry notice until the next login or logout', () => {
    const { session, local, clock } = setup();
    const otherTab = Session.create({ getLocal: () => local, getSession: () => fakeStorage(), now: () => clock.time });
    session.start('Testperson');
    clock.time += TIMEOUT_MS + 1;
    assert.equal(otherTab.check().state, 'expired');
    assert.equal(session.check().state, 'none');
    assert.equal(session.hasExpiredNotice(), true);
    assert.equal(session.hasExpiredNotice(), true);

    session.start('Testperson');
    assert.equal(session.hasExpiredNotice(), false);
    clock.time += TIMEOUT_MS + 1;
    session.check();
    session.logout();
    assert.equal(otherTab.hasExpiredNotice(), false);
});

test('activity extends the session and writes at most every 15 s', () => {
    const { session, local, clock } = setup();
    session.start('Testperson');
    local.writes.length = 0;

    clock.time += WRITE_THROTTLE_MS - 1;
    session.touch();
    session.touch();
    assert.equal(local.writes.length, 0);

    clock.time += 1;
    session.touch();
    session.touch();
    assert.deepEqual(local.writes, [KEYS.activity]);

    clock.time += TIMEOUT_MS;
    assert.equal(session.check().state, 'active');
});

for (const [label, remember] of [['remembered', true], ['tab-only', false]]) {
    test(`logout and expiry remove the ${label} API key`, () => {
        for (const finish of ['end', 'expire']) {
            const { session, local, tab, clock, keyStore } = setup();
            session.start('Testperson');
            keyStore.save(FAKE_KEY, remember);
            assert.deepEqual(keyStore.load(), { key: FAKE_KEY, remember });
            if (finish === 'end') {
                session.end();
            } else {
                clock.time += TIMEOUT_MS + 1;
                session.check();
            }
            assert.equal(local.getItem(KEYS.apiKey), null);
            assert.equal(tab.getItem(KEYS.apiKey), null);
        }
    });
}

test('a tab drops its API key after a logout elsewhere or a change of user', () => {
    const { session, local, tab, keyStore } = setup();
    session.start('Erste');
    keyStore.save(FAKE_KEY, false);

    // Another tab logged out: only the shared storage changed.
    local.removeItem(KEYS.auth);
    session.check();
    assert.equal(tab.getItem(KEYS.apiKey), null);

    session.start('Erste');
    keyStore.save(FAKE_KEY, false);
    // This tab missed the logout and the next user's login.
    local.setItem(KEYS.user, 'Zweite');
    session.check();
    assert.equal(tab.getItem(KEYS.apiKey), null);
});

test('key store keeps one copy; switching "remember" off removes the persistent one', () => {
    const { session, local, tab, keyStore } = setup();
    session.start('Testperson');
    keyStore.save(FAKE_KEY, false);
    assert.equal(local.getItem(KEYS.apiKey), null);
    keyStore.save(FAKE_KEY, true);
    assert.equal(tab.getItem(KEYS.apiKey), null);
    keyStore.save(FAKE_KEY, false);
    assert.equal(local.getItem(KEYS.apiKey), null);
    assert.equal(tab.getItem(KEYS.apiKey), FAKE_KEY);
    keyStore.clear();
    assert.deepEqual(keyStore.load(), { key: '', remember: false });
});

test('a pre-existing localStorage key counts as remembered', () => {
    const { local, keyStore } = setup();
    local.setItem(KEYS.apiKey, FAKE_KEY);
    assert.deepEqual(keyStore.load(), { key: FAKE_KEY, remember: true });
});

test('the legacy password override is deleted', () => {
    const { session, local } = setup();
    local.setItem('usersOverride', '{"fake":"fake-value"}');
    session.purgeLegacyData();
    assert.equal(local.getItem('usersOverride'), null);
});

// One browser tab on the converter page: shared localStorage, own sessionStorage, fake form controls.
function converterTab(local, clock) {
    const tab = fakeStorage();
    const session = Session.create({ getLocal: () => local, getSession: () => tab, now: () => clock.time });
    const keyStore = createKeyStore({
        getLocal: () => local, getSession: () => tab, getUserName: () => 'Testperson', keys: KEYS
    });
    const input = { value: '' };
    const rememberSwitch = { checked: false };
    const errors = [];
    const controls = createKeyControls({
        keyStore, keys: KEYS, input, rememberSwitch,
        isSessionValid: () => session.check().state === 'active',
        onSaveError: () => errors.push(true)
    });
    const type = (key, remember = rememberSwitch.checked) => {
        input.value = key;
        rememberSwitch.checked = remember;
        controls.persist();
    };
    return { tab, session, keyStore, input, rememberSwitch, controls, type, errors };
}

function twoTabs() {
    const local = fakeStorage();
    const clock = { time: START };
    const first = converterTab(local, clock);
    const second = converterTab(local, clock);
    first.session.start('Testperson');
    first.type(FAKE_KEY, true);
    second.controls.restore();
    local.writes.length = 0;
    return { local, clock, first, second };
}

for (const [label, change] of [
    ['"Key löschen"', (tab) => tab.keyStore.clear()],
    ['switching "remember" off', (tab) => tab.type(FAKE_KEY, false)]
]) {
    test(`${label} in another tab updates both controls and cannot be undone`, () => {
        const { local, first, second } = twoTabs();
        assert.deepEqual([second.input.value, second.rememberSwitch.checked], [FAKE_KEY, true]);
        change(first);
        local.writes.length = 0;
        second.controls.sync(KEYS.apiKey);
        assert.deepEqual([second.input.value, second.rememberSwitch.checked], ['', false]);
        assert.deepEqual(local.writes, [], 'syncing must not write');
        assert.equal(local.getItem(KEYS.apiKey), null);
        assert.equal(second.tab.getItem(KEYS.apiKey), null);
    });
}

test('a tab adopts a key remembered elsewhere and drops its own copy for good', () => {
    const { first, second } = twoTabs();
    first.keyStore.clear();
    second.controls.sync(KEYS.apiKey);
    second.type('fake-old-tab-key', false);

    first.type(FAKE_KEY, true);
    second.controls.sync(KEYS.apiKey);
    assert.deepEqual([second.input.value, second.rememberSwitch.checked], [FAKE_KEY, true]);
    assert.equal(second.tab.getItem(KEYS.apiKey), null);

    first.keyStore.clear();
    second.controls.sync(null);
    assert.equal(second.input.value, '', 'the old tab copy must not come back');
});

test('unrelated storage changes leave the controls alone', () => {
    const { second } = twoTabs();
    second.input.value = 'fake-unsaved';
    second.controls.sync(KEYS.activity);
    assert.equal(second.input.value, 'fake-unsaved');
});

test('restoring never writes, and an expired session cannot write the key back', () => {
    const { local, clock, first } = twoTabs();
    first.controls.restore();
    assert.deepEqual(local.writes, []);

    // The tab slept: nothing has checked the session since it expired.
    clock.time += TIMEOUT_MS + 1;
    first.type(FAKE_KEY, true);
    assert.equal(local.getItem(KEYS.apiKey), null);
    assert.equal(first.tab.getItem(KEYS.apiKey), null);
    assert.deepEqual(first.errors, []);
});

test('the converter writes the key only on user edits, never when converting', () => {
    const source = readFileSync(new URL('../assets/js/converter.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /keyStore\.save/);
    assert.deepEqual(source.match(/.*keyControls\.persist.*/g).map((line) => line.trim()), [
        "keyInput.addEventListener('input', keyControls.persist);",
        "rememberSwitch.addEventListener('change', keyControls.persist);"
    ]);
});

// Runs the real classic scripts against a minimal fake page.
function loadGuard() {
    const local = fakeStorage();
    const calls = { replaced: 0, reloaded: 0 };
    const root = { dataset: { page: 'protected' }, removeAttribute: () => { delete root.dataset.auth; } };
    const context = createContext({
        window: {
            localStorage: local,
            sessionStorage: fakeStorage(),
            location: { replace: () => { calls.replaced += 1; }, reload: () => { calls.reloaded += 1; } },
            addEventListener: () => {}
        },
        document: { documentElement: root, addEventListener: () => {} },
        setInterval: () => {}
    });
    const signIn = (name, age = 0) => {
        local.setItem(KEYS.activity, String(Date.now() - age));
        local.setItem(KEYS.user, name);
        local.setItem(KEYS.auth, 'true');
    };
    const run = () => {
        for (const file of ['session.js', 'session-guard.js']) {
            runInContext(readFileSync(new URL(`../assets/js/${file}`, import.meta.url), 'utf8'), context);
        }
        return context.sessionGuard;
    };
    return { signIn, run, calls, root };
}

test('guard: the page user check re-reads the session and notices expiry', () => {
    const page = loadGuard();
    page.signIn('Erste');
    const guard = page.run();
    assert.equal(guard.isPageUserSignedIn(), true);
    page.signIn('Erste', TIMEOUT_MS + 1000);
    assert.equal(guard.isPageUserSignedIn(), false);
    assert.equal(page.calls.replaced, 1);
    assert.equal(page.root.dataset.auth, undefined);
});

test('guard: another user signing in invalidates the page and reloads it', () => {
    const page = loadGuard();
    page.signIn('Erste');
    const guard = page.run();
    page.signIn('Zweite');
    assert.equal(guard.isPageUserSignedIn(), false);
    assert.ok(page.calls.reloaded >= 1);
    assert.equal(page.root.dataset.auth, undefined);
});

function fakeInput() {
    const classes = new Set();
    return {
        type: 'text', autocomplete: 'off', disabled: true,
        classList: {
            toggle: (name, on) => { classes[on ? 'add' : 'delete'](name); },
            contains: (name) => classes.has(name)
        }
    };
}

test('API key field with CSS masking stays a text field', () => {
    const input = fakeInput();
    const field = setupSecretField(input, (element) => {
        assert.equal(element.disabled, true, 'still disabled while the mask is checked');
        return true;
    });
    assert.deepEqual([input.type, input.autocomplete, input.disabled, field.isVisible()], ['text', 'off', false, false]);
    field.setVisible(true);
    assert.deepEqual([input.type, field.isVisible()], ['text', true]);
    field.setVisible(false);
    assert.deepEqual([input.type, field.isVisible()], ['text', false]);
});

test('API key field without CSS masking falls back to a new-password field', () => {
    const input = fakeInput();
    const field = setupSecretField(input, () => false);
    assert.deepEqual([input.type, input.autocomplete, input.disabled], ['password', 'new-password', false]);
    field.setVisible(true);
    assert.deepEqual([input.type, field.isVisible()], ['text', true]);
    field.setVisible(false);
    assert.deepEqual([input.type, field.isVisible()], ['password', false]);
});

test('throwing storage counts as logged out', () => {
    const blocked = () => { throw new Error('SecurityError'); };
    const session = Session.create({ getLocal: blocked, getSession: blocked });
    assert.deepEqual(session.check(), { state: 'unavailable' });
    assert.deepEqual(session.touch(), { state: 'unavailable' });
    assert.equal(session.start('Testperson'), false);
    assert.equal(session.hasExpiredNotice(), false);
    assert.doesNotThrow(() => { session.logout(); session.purgeLegacyData(); });
});
