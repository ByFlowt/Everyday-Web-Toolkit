import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    calculate, computeProgress, formatBalance, formatDuration, loadUserState, parseStartTime, parseStoredState, saveUserState, stateStorageKey
} from '../assets/js/time-calc.js';

function fakeStorage(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        keys: () => [...data.keys()].sort(),
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => { data.set(key, String(value)); },
        removeItem: (key) => { data.delete(key); }
    };
}

const input = (overrides = {}) => ({
    startTime: '08:00', workHours: '', breakMinutes: '', currentOvertime: '',
    dailyOvertimeCalc: '', toggleOvertime: false, ...overrides
});

test('uses the defaults of 7.5 h and 45 min', () => {
    const result = calculate(input());
    assert.equal(result.endTime, '16:15');
    assert.equal(result.dayOffset, 0);
    assert.equal(result.balance, '0h 0m');
});

test('balance rounding carries into hours and never shows -0', () => {
    assert.equal(formatBalance(1.999999 * 60), '2h 0m');
    assert.equal(formatBalance(119.6), '2h 0m');
    assert.equal(formatBalance(-0.2), '0h 0m');
    assert.equal(formatBalance(-0), '0h 0m');
    assert.equal(calculate(input({ currentOvertime: '-0.004' })).balance, '0h 0m');
});

test('negative balances keep their sign and round symmetrically', () => {
    assert.equal(formatBalance(-90), '-1h 30m');
    assert.equal(formatBalance(-90.5), '-1h 31m');
    assert.equal(formatBalance(90.5), '1h 31m');
    const result = calculate(input({ currentOvertime: '0.25', dailyOvertimeCalc: '-60', toggleOvertime: true }));
    assert.equal(result.balance, '-0h 45m');
    assert.equal(result.endTime, '15:15');
});

test('daily overtime only counts while the toggle is on', () => {
    assert.equal(calculate(input({ dailyOvertimeCalc: '60' })).endTime, '16:15');
    assert.equal(calculate(input({ dailyOvertimeCalc: '60', toggleOvertime: true })).endTime, '17:15');
});

test('reports an end time after midnight', () => {
    const night = calculate(input({ startTime: '22:00' }));
    assert.deepEqual([night.endTime, night.dayOffset], ['06:15', 1]);

    const exactlyMidnight = calculate(input({ startTime: '15:45' }));
    assert.deepEqual([exactlyMidnight.endTime, exactlyMidnight.dayOffset], ['00:00', 1]);

    const twoDays = calculate(input({
        startTime: '23:00', workHours: '12', breakMinutes: '120', dailyOvertimeCalc: '1440', toggleOvertime: true
    }));
    assert.deepEqual([twoDays.endTime, twoDays.dayOffset], ['13:00', 2]);
});

test('rejects a negative total duration', () => {
    const result = calculate(input({ dailyOvertimeCalc: '-600', toggleOvertime: true }));
    assert.equal(result.ok, false);
    assert.equal(result.invalid, true);
});

test('accepts a total duration of zero', () => {
    const result = calculate(input({ dailyOvertimeCalc: '-495', toggleOvertime: true }));
    assert.deepEqual([result.endTime, result.dayOffset], ['08:00', 0]);
});

test('validates ranges and ignores non-finite values', () => {
    for (const bad of [
        { workHours: '0' }, { workHours: '13' }, { breakMinutes: '-1' }, { breakMinutes: '121' },
        { currentOvertime: '100000' }, { dailyOvertimeCalc: '1441', toggleOvertime: true }
    ]) {
        assert.equal(calculate(input(bad)).invalid, true, JSON.stringify(bad));
    }
    for (const ignored of [{ workHours: 'abc' }, { workHours: 'Infinity' }, { breakMinutes: 'NaN' }, { workHours: '1e999' }]) {
        assert.equal(calculate(input(ignored)).endTime, '16:15', JSON.stringify(ignored));
    }
});

test('a break of zero is not replaced by the default', () => {
    assert.equal(calculate(input({ breakMinutes: '0' })).endTime, '15:30');
});

test('asks for a start time when it is missing or malformed', () => {
    for (const startTime of ['', '24:00', '8:00', '12:60', 'abc', undefined]) {
        const result = calculate(input({ startTime }));
        assert.equal(result.ok, false);
        assert.equal(result.invalid, undefined);
    }
    assert.equal(parseStartTime('23:59'), 1439);
    assert.equal(parseStartTime('07:30:00'), 450);
});

test('unparsable input is reported instead of silently using a default', () => {
    for (const [field, name] of [
        ['startTime', 'Anfangszeit'], ['workHours', 'Reguläre Arbeitszeit'], ['breakMinutes', 'Pausenzeit'],
        ['currentOvertime', 'Bisherige Überstunden']
    ]) {
        const result = calculate(input({ [field]: '', badFields: [field] }));
        assert.deepEqual([result.ok, result.invalid], [false, true], field);
        assert.ok(result.message.includes(name), result.message);
    }
    const daily = { badFields: ['dailyOvertimeCalc'] };
    assert.equal(calculate(input({ ...daily, toggleOvertime: true })).invalid, true);
    // The hidden field does not count while the toggle is off.
    assert.equal(calculate(input(daily)).endTime, '16:15');
    assert.equal(calculate(input({ badFields: [] })).endTime, '16:15');
});

test('state is stored per user name, ignoring case', () => {
    const storage = fakeStorage();
    saveUserState(storage, 'Anna', { startTime: '07:00' });
    saveUserState(storage, 'Ben', { startTime: '09:00' });
    assert.equal(stateStorageKey('ANNA'), 'timeCalcState:anna');
    assert.deepEqual(loadUserState(storage, 'anna'), { startTime: '07:00' });
    assert.deepEqual(loadUserState(storage, 'Ben'), { startTime: '09:00' });
    assert.deepEqual(loadUserState(storage, 'Cleo'), {});
});

test('the legacy shared state moves once to the current user', () => {
    const storage = fakeStorage({ timeCalcState: '{"currentOvertime":"3"}' });
    assert.deepEqual(loadUserState(storage, 'Anna'), { currentOvertime: '3' });
    assert.deepEqual(storage.keys(), ['timeCalcState:anna']);
    assert.deepEqual(loadUserState(storage, 'Ben'), {});
});

test('migration never overwrites a state the user already has', () => {
    const storage = fakeStorage({ timeCalcState: '{"startTime":"06:00"}', 'timeCalcState:anna': '{"startTime":"08:00"}' });
    assert.deepEqual(loadUserState(storage, 'Anna'), { startTime: '08:00' });
    assert.deepEqual(storage.keys(), ['timeCalcState:anna']);
});

test('the legacy state survives if it cannot be copied', () => {
    const storage = fakeStorage({ timeCalcState: '{"startTime":"06:00"}' });
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    assert.throws(() => loadUserState(storage, 'Anna'));
    assert.deepEqual(storage.keys(), ['timeCalcState']);
});

test('stored state: unreadable or non-object values become empty', () => {
    for (const raw of [null, undefined, '', '{', 'null', '5', '"text"', '[1]', 'true']) {
        assert.deepEqual(parseStoredState(raw), {}, String(raw));
    }
});

test('stored state: zero is restored and unknown or mistyped fields are dropped', () => {
    const state = parseStoredState(JSON.stringify({
        startTime: '07:00', workHours: 8, breakMinutes: 0, currentOvertime: '0',
        dailyOvertimeCalc: { nested: true }, toggleOvertime: 'yes', extra: 'x'
    }));
    assert.deepEqual(state, { startTime: '07:00', workHours: '8', breakMinutes: '0', currentOvertime: '0' });
    assert.equal(parseStoredState('{"toggleOvertime":true}').toggleOvertime, true);
});

test('calculate returns durationMinutes and formatDuration formats hours and minutes', () => {
    const result = calculate(input());
    assert.equal(result.durationMinutes, 495);
    assert.equal(result.breakMinutes, 45);
    assert.equal(formatDuration(495), '8h 15m');
    assert.equal(formatDuration(-5), '0h 0m');
});

test('computeProgress handles before, working, done, and overnight shifts', () => {
    assert.deepEqual(computeProgress({ startTime: '08:00', durationMinutes: 480, nowMinutes: 450 }), {
        totalMinutes: 480, percent: 0, remainingMinutes: 480, state: 'before', startsInMinutes: 30
    });
    assert.deepEqual(computeProgress({ startTime: '08:00', durationMinutes: 480, nowMinutes: 720 }), {
        totalMinutes: 480, percent: 50, remainingMinutes: 240, state: 'working'
    });
    assert.deepEqual(computeProgress({ startTime: '08:00', durationMinutes: 480, nowMinutes: 1000 }), {
        totalMinutes: 480, percent: 100, remainingMinutes: 0, state: 'done'
    });
    assert.deepEqual(computeProgress({ startTime: '22:00', durationMinutes: 480, nowMinutes: 120 }), {
        totalMinutes: 480, percent: 50, remainingMinutes: 240, state: 'working'
    });
    assert.equal(computeProgress({ startTime: '', durationMinutes: 480, nowMinutes: 500 }), null);
});
