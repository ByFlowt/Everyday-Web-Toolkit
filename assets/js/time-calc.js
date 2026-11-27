// End-of-workday arithmetic in plain minutes (independent of dates and DST). No DOM access.

const MINUTES_PER_DAY = 24 * 60;

export const DEFAULTS = Object.freeze({
    workHours: 7.5,
    breakMinutes: 45,
    currentOvertime: 0,
    dailyOvertime: 0
});

const RANGES = Object.freeze({
    workHours: { min: 1, max: 12, label: 'Die reguläre Arbeitszeit muss zwischen 1 und 12 Stunden liegen.' },
    breakMinutes: { min: 0, max: 120, label: 'Die Pausenzeit muss zwischen 0 und 120 Minuten liegen.' },
    currentOvertime: { min: -10000, max: 10000, label: 'Das Überstundenkonto muss zwischen -10000 und 10000 Stunden liegen.' },
    dailyOvertime: { min: -1440, max: 1440, label: 'Die geplanten Überstunden müssen zwischen -1440 und 1440 Minuten liegen.' }
});

const FIELD_NAMES = Object.freeze({
    startTime: 'Anfangszeit',
    workHours: 'Reguläre Arbeitszeit',
    breakMinutes: 'Pausenzeit',
    currentOvertime: 'Bisherige Überstunden',
    dailyOvertimeCalc: 'Geplante Überstunden heute'
});
const TEXT_FIELDS = Object.keys(FIELD_NAMES);

// Earlier versions kept one state for everybody under this key.
const LEGACY_STORAGE_KEY = 'timeCalcState';

// Empty and non-finite values fall back to the default.
function toNumber(value, fallback) {
    const text = String(value ?? '').trim();
    const number = Number(text);
    return text !== '' && Number.isFinite(number) ? number : fallback;
}

export function parseStartTime(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(String(value ?? ''));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Rounds the total first and splits afterwards, so "1h 60m" and "-0h 0m" cannot occur.
export function formatBalance(totalMinutes) {
    const rounded = Math.round(Math.abs(totalMinutes));
    const sign = totalMinutes < 0 && rounded !== 0 ? '-' : '';
    return `${sign}${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

export function formatDuration(totalMinutes) {
    const rounded = Math.max(0, Math.round(totalMinutes));
    return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

export function formatClock(minutesOfDay) {
    const hours = String(Math.floor(minutesOfDay / 60)).padStart(2, '0');
    const minutes = String(minutesOfDay % 60).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function calculate(input) {
    // A number or time input holding unparsable text reports an empty value: say so instead of using a default.
    const badField = (input.badFields ?? [])
        .find((field) => field !== 'dailyOvertimeCalc' || input.toggleOvertime);
    if (badField !== undefined) {
        return { ok: false, invalid: true, message: `Ungültige Eingabe bei „${FIELD_NAMES[badField]}“.` };
    }

    const start = parseStartTime(input.startTime);
    if (start === null) {
        return { ok: false, message: 'Bitte Anfangszeit eingeben' };
    }

    const values = {
        workHours: toNumber(input.workHours, DEFAULTS.workHours),
        breakMinutes: toNumber(input.breakMinutes, DEFAULTS.breakMinutes),
        currentOvertime: toNumber(input.currentOvertime, DEFAULTS.currentOvertime),
        dailyOvertime: input.toggleOvertime
            ? toNumber(input.dailyOvertimeCalc, DEFAULTS.dailyOvertime)
            : DEFAULTS.dailyOvertime
    };
    for (const [field, range] of Object.entries(RANGES)) {
        if (values[field] < range.min || values[field] > range.max) {
            return { ok: false, invalid: true, message: range.label };
        }
    }

    const dailyMinutes = Math.round(values.dailyOvertime);
    const breakMinutes = Math.round(values.breakMinutes);
    const duration = Math.round(values.workHours * 60) + breakMinutes + dailyMinutes;
    if (duration < 0) {
        return { ok: false, invalid: true, message: 'Der Abbau ist größer als Arbeitszeit und Pause zusammen.' };
    }

    const end = start + duration;
    return {
        ok: true,
        endTime: formatClock(end % MINUTES_PER_DAY),
        dayOffset: Math.floor(end / MINUTES_PER_DAY),
        balance: formatBalance(values.currentOvertime * 60 + dailyMinutes),
        dailyMinutes,
        durationMinutes: duration,
        breakMinutes
    };
}

// Computes workday progress relative to the current minute of day (0..1439).
export function computeProgress({ startTime, durationMinutes, nowMinutes }) {
    const start = parseStartTime(startTime);
    if (start === null || !Number.isFinite(durationMinutes) || durationMinutes < 0) {
        return null;
    }
    const total = Math.round(durationMinutes);
    if (total === 0) {
        return { totalMinutes: 0, percent: 100, remainingMinutes: 0, state: 'done' };
    }

    const end = start + total;
    let elapsed = nowMinutes - start;
    if (end > MINUTES_PER_DAY && nowMinutes < start && nowMinutes <= end - MINUTES_PER_DAY) {
        elapsed += MINUTES_PER_DAY;
    }

    if (elapsed < 0) {
        return { totalMinutes: total, percent: 0, remainingMinutes: total, state: 'before', startsInMinutes: -elapsed };
    }
    if (elapsed >= total) {
        return { totalMinutes: total, percent: 100, remainingMinutes: 0, state: 'done' };
    }
    return {
        totalMinutes: total,
        percent: Math.round((elapsed / total) * 100),
        remainingMinutes: total - elapsed,
        state: 'working'
    };
}

// One state per user name, ignoring case. This separates the UI only; it does not protect anything.
export function stateStorageKey(userName) {
    return `${LEGACY_STORAGE_KEY}:${userName.toLowerCase()}`;
}

// The first user to load takes over the old shared state, which is then removed.
export function loadUserState(storage, userName) {
    const key = stateStorageKey(userName);
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
        if (storage.getItem(key) === null) {
            storage.setItem(key, legacy);
        }
        storage.removeItem(LEGACY_STORAGE_KEY);
    }
    return parseStoredState(storage.getItem(key));
}

export function saveUserState(storage, userName, state) {
    storage.setItem(stateStorageKey(userName), JSON.stringify(state));
}

// Returns only known fields with the expected types; anything unreadable becomes {}.
export function parseStoredState(raw) {
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return {};
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return {};
    }
    const state = {};
    for (const field of TEXT_FIELDS) {
        if (typeof data[field] === 'string' || Number.isFinite(data[field])) {
            state[field] = String(data[field]);
        }
    }
    if (typeof data.toggleOvertime === 'boolean') {
        state.toggleOvertime = data.toggleOvertime;
    }
    return state;
}
