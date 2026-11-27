// Page script for TimeCalculator.html. The arithmetic lives in time-calc.js.
import { initShell } from './shell.js';
import { calculate, computeProgress, formatClock, formatDuration, loadUserState, saveUserState } from './time-calc.js';

initShell();

const TOAST_DELAY_MS = 800;
const TOAST_DURATION_MS = 2000;
const PROGRESS_INTERVAL_MS = 30 * 1000;

const element = (id) => document.getElementById(id);
const fields = ['startTime', 'workHours', 'breakMinutes', 'currentOvertime', 'dailyOvertimeCalc'].map(element);
const startField = element('startTime');
const dailyField = element('dailyOvertimeCalc');
const overtimeToggle = element('toggleOvertime');
const overtimeSection = element('overtimeSection');
const endTime = element('endTime');
const dayNote = element('dayNote');
const badge = element('overtimeBadge');
const badgeIcon = element('badgeIcon');
const badgeText = element('badgeText');
const summaryCard = element('summaryCard');
const summaryStart = element('summaryStart');
const summaryDuration = element('summaryDuration');
const summaryBreak = element('summaryBreak');
const progressLabel = element('progressLabel');
const progressPercent = element('progressPercent');
const workdayProgress = element('workdayProgress');
const toast = element('saveToast');

const setNowButton = element('setNowButton');
const resetCalcButton = element('resetCalcButton');
const openInfoButton = element('openInfoButton');
const closeInfoButton = element('closeInfoButton');
const closeInfoIcon = element('closeInfoIcon');
const infoDialog = element('infoDialog');

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

function nowMinutesOfDay() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}

function updateSummary(result) {
    if (!result.ok) {
        summaryCard.hidden = true;
        return;
    }
    summaryCard.hidden = false;
    setText(summaryStart, `${startField.value.slice(0, 5)} Uhr`);
    setText(summaryDuration, formatDuration(result.durationMinutes));
    setText(summaryBreak, `${result.breakMinutes} Min.`);

    const progress = computeProgress({
        startTime: startField.value,
        durationMinutes: result.durationMinutes,
        nowMinutes: nowMinutesOfDay()
    });
    if (!progress) {
        workdayProgress.value = 0;
        setText(progressLabel, 'Fortschritt');
        setText(progressPercent, '0 %');
        return;
    }
    workdayProgress.value = progress.percent;
    setText(progressPercent, `${progress.percent} %`);
    if (progress.state === 'done') {
        setText(progressLabel, 'Feierabend erreicht');
    } else if (progress.state === 'before') {
        setText(progressLabel, `Beginnt in ${formatDuration(progress.startsInMinutes)}`);
    } else {
        setText(progressLabel, `Noch ${formatDuration(progress.remainingMinutes)}`);
    }
}

function render() {
    const badFields = fields.filter((field) => field.validity.badInput).map((field) => field.id);
    const result = calculate({ ...readInputs(), badFields });
    if (!result.ok) {
        setText(endTime, '--:--');
        dayNote.hidden = true;
        setText(badgeText, result.message);
        setText(badgeIcon, result.invalid ? 'error_outline' : 'schedule');
        badge.dataset.tone = result.invalid ? 'error' : 'neutral';
        updateSummary(result);
        return;
    }

    setText(endTime, `${result.endTime} Uhr`);
    dayNote.hidden = result.dayOffset === 0;
    setText(dayNote, result.dayOffset === 1 ? 'am nächsten Tag' : `${result.dayOffset} Tage später`);

    let tone = 'neutral';
    let icon = 'check_circle';
    let suffix = '';
    if (result.dailyMinutes > 0) {
        tone = 'positive';
        icon = 'trending_up';
        suffix = ' · Aufbau';
    } else if (result.dailyMinutes < 0) {
        tone = 'negative';
        icon = 'trending_down';
        suffix = ' · Abbau';
    }
    badge.dataset.tone = tone;
    setText(badgeIcon, icon);
    setText(badgeText, `Neues Konto: ${result.balance}${suffix}`);
    updateSummary(result);
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

setNowButton.addEventListener('click', () => {
    startField.value = formatClock(nowMinutesOfDay());
    update();
});

for (const chipButton of document.querySelectorAll('[data-overtime-delta]')) {
    chipButton.addEventListener('click', () => {
        const delta = Number(chipButton.dataset.overtimeDelta);
        const current = Number(dailyField.value);
        const base = Number.isFinite(current) && dailyField.value.trim() !== '' ? current : 0;
        const next = Math.max(-1440, Math.min(1440, Math.round(base + delta)));
        dailyField.value = String(next);
        update();
    });
}

for (const resetButton of document.querySelectorAll('[data-overtime-reset]')) {
    resetButton.addEventListener('click', () => {
        dailyField.value = '0';
        update();
    });
}

resetCalcButton.addEventListener('click', () => {
    for (const field of fields) {
        field.value = '';
    }
    overtimeToggle.checked = false;
    overtimeSection.hidden = true;
    update();
});

openInfoButton.addEventListener('click', () => {
    infoDialog.showModal();
});
closeInfoButton.addEventListener('click', () => {
    infoDialog.close();
});
closeInfoIcon.addEventListener('click', () => {
    infoDialog.close();
});
infoDialog.addEventListener('click', (event) => {
    if (event.target === infoDialog) {
        infoDialog.close();
    }
});

const progressTimer = setInterval(render, PROGRESS_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        render();
    }
});
window.addEventListener('pagehide', () => clearInterval(progressTimer));

load();
render();
