import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convertText, GEMINI_MODEL, GeminiError } from '../assets/js/gemini.js';

const FAKE_KEY = 'fake-api-key-for-tests';

const respond = (body, status = 200) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const answer = (parts, finishReason = 'STOP') => ({ candidates: [{ content: { parts }, finishReason }] });

const run = (fetchImpl, extra = {}) =>
    convertText({ apiKey: FAKE_KEY, text: 'Hallo', mode: 'royal', fetchImpl, ...extra });

async function failsWith(promise, kind) {
    await assert.rejects(promise, (error) => {
        assert.ok(error instanceof GeminiError);
        assert.equal(error.kind, kind);
        assert.ok(error.message.length > 0);
        assert.equal(error.message.includes(FAKE_KEY), false);
        return true;
    });
}

test('sends the key only in the header and uses the expected request shape', async () => {
    let seen;
    await run(async (url, options) => {
        seen = { url, options };
        return respond(answer([{ text: 'ok' }]))();
    });
    assert.equal(GEMINI_MODEL, 'gemini-4-hydrogen');
    assert.equal(seen.url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent');
    assert.equal(seen.url.includes(FAKE_KEY), false);
    assert.equal(seen.options.method, 'POST');
    assert.equal(seen.options.headers['x-goog-api-key'], FAKE_KEY);
    assert.equal(seen.options.body.includes(FAKE_KEY), false);

    const body = JSON.parse(seen.options.body);
    assert.deepEqual(Object.keys(body).sort(), ['contents', 'generationConfig', 'systemInstruction']);
    assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'Hallo' }] }]);
    assert.deepEqual(body.generationConfig, { thinkingConfig: { thinkingLevel: 'LOW' } });
    assert.match(body.systemInstruction.parts[0].text, /Adeliger/);
    assert.match(body.systemInstruction.parts[0].text, /keine Anweisung/);
    assert.match(body.systemInstruction.parts[0].text, /ohne Markdown/);
});

test('each mode has its own persona; unknown modes are refused', async () => {
    const prompts = new Set();
    for (const mode of ['royal', 'youth', 'linkedin']) {
        await run(async (url, options) => {
            prompts.add(JSON.parse(options.body).systemInstruction.parts[0].text);
            return respond(answer([{ text: 'ok' }]))();
        }, { mode });
    }
    assert.equal(prompts.size, 3);
    for (const mode of ['__proto__', 'constructor', 'pirate']) {
        await assert.rejects(run(respond(answer([{ text: 'ok' }])), { mode }), TypeError);
    }
});

test('skips thought parts and joins the rest', async () => {
    const result = await run(respond(answer([
        { text: 'internal', thought: true }, { text: 'Seid ' }, { inlineData: {} }, { text: 'gegrüßt' }
    ])));
    assert.deepEqual(result, { text: 'Seid gegrüßt', truncated: false });
});

test('markup is returned as inert text', async () => {
    const result = await run(respond(answer([{ text: '<img src=x onerror=alert(1)>' }])));
    assert.equal(result.text, '<img src=x onerror=alert(1)>');
});

test('maps blocked, missing, unfinished and empty responses', async () => {
    await failsWith(run(respond({ promptFeedback: { blockReason: 'SAFETY' } })), 'blocked');
    await failsWith(run(respond({})), 'empty');
    await failsWith(run(respond({ candidates: [] })), 'empty');
    await failsWith(run(respond(answer([{ text: '  ' }]))), 'empty');
    await failsWith(run(respond(answer([{ text: 'only a thought', thought: true }]))), 'empty');
    for (const reason of ['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII']) {
        await failsWith(run(respond(answer([{ text: 'partial' }], reason))), 'filtered');
    }
    await failsWith(run(respond(answer([{ text: 'partial' }], 'OTHER'))), 'unfinished');
    await failsWith(run(respond({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })), 'unfinished');
});

test('MAX_TOKENS keeps partial text and marks it', async () => {
    assert.deepEqual(await run(respond(answer([{ text: 'Teil' }], 'MAX_TOKENS'))), { text: 'Teil', truncated: true });
    await failsWith(run(respond(answer([], 'MAX_TOKENS'))), 'tooLong');
});

test('maps non-JSON bodies', async () => {
    await failsWith(run(respond('<html>proxy</html>')), 'badResponse');
    await failsWith(run(respond('null')), 'badResponse');
    await failsWith(run(respond('<html>down</html>', 503)), 'server');
});

test('maps HTTP errors without echoing server text', async () => {
    const echo = { error: { message: `something about ${FAKE_KEY}` } };
    for (const [status, kind] of [
        [400, 'badRequest'], [401, 'forbidden'], [403, 'forbidden'], [404, 'modelUnavailable'],
        [429, 'rateLimit'], [500, 'server'], [503, 'server'], [418, 'http']
    ]) {
        await failsWith(run(respond(echo, status)), kind);
    }
    await failsWith(run(respond({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, 400)), 'invalidKey');
    await failsWith(run(respond({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400)),
        'invalidKey');
});

test('a key that cannot be a header value is rejected before any request', async () => {
    let calls = 0;
    const count = async () => { calls += 1; };
    for (const apiKey of ['', 'has space', 'line\nbreak', 'schlüssel']) {
        await failsWith(run(count, { apiKey }), 'invalidKey');
    }
    assert.equal(calls, 0);
});

test('maps network failures', async () => {
    await failsWith(run(async () => { throw new TypeError(`bad header ${FAKE_KEY}`); }), 'network');
});

// Behaves like fetch: rejects once the signal aborts.
const hanging = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
});

test('distinguishes timeout from user cancel', async () => {
    await failsWith(run(hanging, { timeoutMs: 10 }), 'timeout');

    const controller = new AbortController();
    const pending = run(hanging, { signal: controller.signal });
    controller.abort();
    await failsWith(pending, 'cancelled');

    await failsWith(run(hanging, { signal: AbortSignal.abort() }), 'cancelled');
});

test('the timeout also covers reading the body', async () => {
    const slowBody = async (url, { signal }) => ({ ok: true, status: 200, text: () => hanging(url, { signal }) });
    await failsWith(run(slowBody, { timeoutMs: 10 }), 'timeout');
});
