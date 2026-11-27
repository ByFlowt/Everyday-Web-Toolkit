// Page script for TimeCalculator.html. The arithmetic lives in time-calc.js.
import { calculate, loadUserState, saveUserState } from './time-calc.js';

const TOAST_DELAY_MS = 800;
const TOAST_DURATION_MS = 2000;

const element = (id) => document.getElementById(id);
const fields = ['startTime', 'workHours', 'breakMinutes', 'currentOvertime', 'dailyOvertimeCalc'].map(element);
const dailyField = element('dailyOvertimeCalc');
const overtimeToggle = element('toggleOvertime');
const overtimeSection = element('overtimeSection');
const endTime = element('endTime');
const dayNote = element('dayNote');
const badge = element('overtimeBadge');
const toast = element('saveToast');

// session-guard.js reloads the page if another user signs in, so one page only ever serves one user.
const guard = globalThis.sessionGuard;
const pageUser = guard.isPageUserSignedIn() ? guard.getStatus().userName : null;

function readInputs() {
    const values = Object.fromEntries(fields.map((field) => [field.id, field.value]));
    return { ...values, toggleOvertime: overtimeToggle.checked };
}

// The result card is a live region: only touch it when something changed.
function setText(target, text) {
    if (target.textContent !== text) {
        target.textContent = text;
    }
}

function render() {
    const badFields = fields.filter((field) => field.validity.badInput).map((field) => field.id);
    const result = calculate({ ...readInputs(), badFields });
    if (!result.ok) {
        setText(endTime, '--:--');
        dayNote.hidden = true;
        setText(badge, result.message);
        badge.dataset.tone = result.invalid ? 'error' : 'neutral';
        return;
    }

    setText(endTime, `${result.endTime} Uhr`);
    dayNote.hidden = result.dayOffset === 0;
    setText(dayNote, result.dayOffset === 1 ? 'am nächsten Tag' : `${result.dayOffset} Tage später`);

    let tone = 'neutral';
    let suffix = '';
    if (result.dailyMinutes > 0) {
        tone = 'positive';
        suffix = ' (Aufgebaut 🚀)';
    } else if (result.dailyMinutes < 0) {
        tone = 'negative';
        suffix = ' (Abgebaut 📉)';
    }
    badge.dataset.tone = tone;
    setText(badge, `Neues Konto: ${result.balance}${suffix}`);
}

let toastDelay;
let toastHide;

// Shown once the user pauses, not on every keystroke.
function scheduleToast() {
    clearTimeout(toastDelay);
    toastDelay = setTimeout(() => {
        toast.classList.add('is-visible');
        clearTimeout(toastHide);
        toastHide = setTimeout(() => toast.classList.remove('is-visible'), TOAST_DURATION_MS);
    }, TOAST_DELAY_MS);
}

function save() {
    if (pageUser === null || !guard.isPageUserSignedIn()) {
        return;
    }
    // An unreadable field reports '', which must not overwrite the last good value.
    if (fields.some((field) => field.validity.badInput)) {
        clearTimeout(toastDelay);
        return;
    }
    try {
        saveUserState(localStorage, pageUser, readInputs());
        scheduleToast();
    } catch {
        // Storage full or blocked: the calculator still works, it just does not remember.
    }
}

function load() {
    if (pageUser === null) {
        return;
    }
    let state = {};
    try {
        state = loadUserState(localStorage, pageUser);
    } catch {
        // Start with an empty form.
    }
    // Every field is set, so nothing the browser may have restored survives.
    for (const field of fields) {
        field.value = state[field.id] ?? '';
    }
    overtimeToggle.checked = state.toggleOvertime === true;
    overtimeSection.hidden = !overtimeToggle.checked;
}

function update() {
    save();
    render();
}

for (const field of fields) {
    field.addEventListener('input', update);
    // A half-typed time raises no "input" event; check again when the field is left.
    field.addEventListener('blur', render);
}
overtimeToggle.addEventListener('change', () => {
    overtimeSection.hidden = !overtimeToggle.checked;
    if (!overtimeToggle.checked) {
        dailyField.value = '';
    }
    update();
});

// ---------- Tabs: automatic activation with roving tabindex ----------
const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(selected) {
    for (const tab of tabs) {
        const active = tab === selected;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        element(tab.getAttribute('aria-controls')).hidden = !active;
    }
}

tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
        const targets = {
            ArrowLeft: (index - 1 + tabs.length) % tabs.length,
            ArrowRight: (index + 1) % tabs.length,
            Home: 0,
            End: tabs.length - 1
        };
        if (!Object.hasOwn(targets, event.key)) {
            return;
        }
        event.preventDefault();
        const next = tabs[targets[event.key]];
        selectTab(next);
        next.focus();
    });
});

load();
render();
