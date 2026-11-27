// Calculator view controller (embedded in index.html). The arithmetic lives in time-calc.js.
import { calculate, computeProgress, formatClock, formatDuration, loadUserState, saveUserState } from './time-calc.js';

const TOAST_DELAY_MS = 800;
const TOAST_DURATION_MS = 2000;
const PROGRESS_INTERVAL_MS = 30 * 1000;
const SVG_WIDTH = 240;
const SVG_START_X = 2;
const SVG_END_X = 238;
const SVG_CENTER_Y = 8;
const SVG_GAP = 5;
const WAVE_PERIOD = 24;

function buildWavyPath(endX, amplitude) {
    const start = -WAVE_PERIOD;
    if (endX <= SVG_START_X) {
        return '';
    }
    if (amplitude <= 0.15) {
        return `M ${start} ${SVG_CENTER_Y} L ${endX.toFixed(1)} ${SVG_CENTER_Y}`;
    }
    const parts = [`M ${start} ${SVG_CENTER_Y}`];
    for (let x = start; x < endX; x += WAVE_PERIOD / 2) {
        const nextX = Math.min(endX, x + WAVE_PERIOD / 2);
        const midX = (x + nextX) / 2;
        const sign = Math.round((x - start) / (WAVE_PERIOD / 2)) % 2 === 0 ? -1 : 1;
        const ctrlY = SVG_CENTER_Y + sign * amplitude * ((nextX - x) / (WAVE_PERIOD / 2));
        parts.push(`Q ${midX.toFixed(1)} ${ctrlY.toFixed(1)} ${nextX.toFixed(1)} ${SVG_CENTER_Y}`);
    }
    return parts.join(' ');
}

export function initCalculator() {
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
    const wavyTrack = element('wavyTrack');
    const wavyWave = element('wavyWave');
    const wavyStop = element('wavyStop');
    const toast = element('saveToast');

    const setNowButton = element('setNowButton');
    const resetCalcButton = element('resetCalcButton');
    const openInfoButton = element('openInfoButton');
    const closeInfoButton = element('closeInfoButton');
    const closeInfoIcon = element('closeInfoIcon');
    const infoDialog = element('infoDialog');

    const guard = globalThis.sessionGuard;
    let activeUser = null;
    let toastDelay;
    let toastHide;

    function readInputs() {
        const values = Object.fromEntries(fields.map((field) => [field.id, field.value]));
        return { ...values, toggleOvertime: overtimeToggle.checked };
    }

    function setText(target, text) {
        if (target.textContent !== text) {
            target.textContent = text;
        }
    }

    function nowMinutesOfDay() {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
    }

    function renderWavyBar(percent, state) {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        workdayProgress.setAttribute('aria-valuenow', String(clamped));
        workdayProgress.dataset.state = state;

        const span = SVG_END_X - SVG_START_X;
        const fillX = SVG_START_X + (span * clamped) / 100;
        const amplitude = clamped <= 6 || clamped >= 95 ? 0 : 4.2;

        if (clamped <= 0) {
            wavyWave.setAttribute('d', '');
            wavyTrack.setAttribute('x1', String(SVG_START_X));
            wavyTrack.setAttribute('x2', String(SVG_END_X));
            wavyStop.setAttribute('cx', String(SVG_END_X));
            return;
        }

        wavyWave.setAttribute('d', buildWavyPath(fillX, amplitude));
        const trackStart = Math.min(SVG_END_X, fillX + SVG_GAP);
        wavyTrack.setAttribute('x1', trackStart.toFixed(1));
        wavyTrack.setAttribute('x2', String(SVG_END_X));
        wavyStop.setAttribute('cx', String(clamped >= 99 ? fillX.toFixed(1) : SVG_END_X));
        wavyStop.setAttribute('r', clamped >= 100 ? '0' : '2');
        void SVG_WIDTH;
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
            renderWavyBar(0, 'before');
            setText(progressLabel, 'Fortschritt');
            setText(progressPercent, '0 %');
            return;
        }
        renderWavyBar(progress.percent, progress.state);
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

    function scheduleToast() {
        clearTimeout(toastDelay);
        toastDelay = setTimeout(() => {
            toast.classList.add('is-visible');
            clearTimeout(toastHide);
            toastHide = setTimeout(() => toast.classList.remove('is-visible'), TOAST_DURATION_MS);
        }, TOAST_DELAY_MS);
    }

    function save() {
        const status = guard.getStatus();
        if (status.state !== 'active' || !status.userName) {
            return;
        }
        if (fields.some((field) => field.validity.badInput)) {
            clearTimeout(toastDelay);
            return;
        }
        try {
            saveUserState(localStorage, status.userName, readInputs());
            scheduleToast();
        } catch {
            // Storage full or blocked: the calculator still works, it just does not remember.
        }
    }

    function loadForUser(userName) {
        let state = {};
        if (userName) {
            try {
                state = loadUserState(localStorage, userName);
            } catch {
                state = {};
            }
        }
        for (const field of fields) {
            field.value = state[field.id] ?? '';
        }
        overtimeToggle.checked = state.toggleOvertime === true;
        overtimeSection.hidden = !overtimeToggle.checked;
        render();
    }

    function syncSession() {
        const status = guard.getStatus();
        if (status.state !== 'active' || !status.userName) {
            activeUser = null;
            clearTimeout(toastDelay);
            clearTimeout(toastHide);
            toast.classList.remove('is-visible');
            if (infoDialog.open) {
                infoDialog.close();
            }
            loadForUser('');
            return;
        }
        if (activeUser !== status.userName) {
            activeUser = status.userName;
            loadForUser(activeUser);
        }
    }

    function update() {
        save();
        render();
    }

    for (const field of fields) {
        field.addEventListener('input', update);
        field.addEventListener('blur', render);
    }

    overtimeToggle.addEventListener('change', () => {
        overtimeSection.hidden = !overtimeToggle.checked;
        if (!overtimeToggle.checked) {
            dailyField.value = '';
        }
        update();
    });

    function startNow() {
        startField.value = formatClock(nowMinutesOfDay());
        update();
    }

    setNowButton.addEventListener('click', startNow);

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
    document.addEventListener('sessionchange', syncSession);
    window.addEventListener('pagehide', () => clearInterval(progressTimer));

    syncSession();

    return { startNow, refresh: render };
}
