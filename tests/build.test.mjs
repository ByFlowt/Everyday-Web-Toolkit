import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyLogin } from '../assets/js/auth.js';
import { build, collectUsers, createRecord } from '../scripts/build.mjs';
import { createStaticServer, resolveRequestPath } from '../scripts/serve.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const temporary = [];
after(() => Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true }))));

// Random, obviously fake values; the umlaut exercises UTF-8 in both PBKDF2 implementations.
const fakePassword = () => `fake-pässwort-${randomBytes(9).toString('hex')}`;

// Each test builds into its own directory: node runs test files in parallel.
async function outputDir() {
    const dir = await mkdtemp(join(tmpdir(), 'toolkit-build-'));
    temporary.push(dir);
    return join(dir, '_site');
}

function runBuild(outDir, secrets) {
    const env = { ...process.env, USERS: '', USER_TOBIAS: '', ...secrets };
    return new Promise((done) => {
        execFile(process.execPath, [SCRIPT, outDir], { env }, (error, stdout, stderr) => {
            done({ code: error ? error.code : 0, output: stdout + stderr });
        });
    });
}

async function listFiles(root) {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile())
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
        .sort();
}

test('build output has only allowlisted files and no plaintext password', async () => {
    const outDir = await outputDir();
    const first = fakePassword();
    const second = fakePassword();
    const result = await runBuild(outDir, {
        USERS: JSON.stringify({ Testperson: `  ${first}  ` }),
        USER_TOBIAS: second
    });
    assert.equal(result.code, 0, result.output);

    const files = await listFiles(outDir);
    const pages = ['Converter.html', 'TimeCalculator.html', 'index.html'];
    for (const file of files) {
        assert.ok(pages.includes(file) || /^assets\/(?:favicon\.svg|css\/[\w-]+\.css|js\/[\w-]+\.js)$/.test(file), file);
    }
    for (const required of [...pages, 'assets/favicon.svg', 'assets/js/users.js', 'assets/js/session.js']) {
        assert.ok(files.includes(required), required);
    }
    for (const file of files) {
        const content = await readFile(join(outDir, file));
        for (const secret of [first, second]) {
            for (const encoding of ['utf8', 'utf16le', 'latin1']) {
                assert.equal(content.includes(Buffer.from(secret, encoding)), false, `${file} (${encoding})`);
            }
            assert.equal(content.includes(Buffer.from(secret).toString('base64')), false, `${file} (base64)`);
        }
        assert.doesNotMatch(content.toString(), /RECOVERY_/);
    }
    assert.equal(result.output.includes(first) || result.output.includes(second), false);

    // Hashes from node:crypto verify with the browser's WebCrypto code.
    const { USERS } = await import(pathToFileURL(join(outDir, 'assets/js/users.js')));
    assert.deepEqual(USERS.map((user) => user.name), ['Testperson', 'Tobias']);
    assert.deepEqual(Object.keys(USERS[0]).sort(), ['hash', 'iterations', 'name', 'salt']);
    assert.equal(USERS[0].iterations, 600000);
    assert.equal(Buffer.from(USERS[0].salt, 'base64').length, 16);
    assert.equal(Buffer.from(USERS[0].hash, 'base64').length, 32);
    assert.notEqual(USERS[0].salt, USERS[1].salt);
    assert.equal(await verifyLogin(USERS, ' tEsTpErSoN ', ` ${first} `), 'Testperson');
    assert.equal(await verifyLogin(USERS, 'Testperson', second), null);
});

test('unknown and prototype-like user names are rejected', async () => {
    const password = fakePassword();
    const records = [createRecord({ name: 'Testperson', password })];
    for (const name of ['nobody', '__proto__', 'constructor', 'toString']) {
        assert.equal(await verifyLogin(records, name, password), null, name);
    }
    const proto = collectUsers({ USERS: `{"__proto__": "${password}"}` });
    assert.deepEqual(proto.map((user) => user.name), ['__proto__']);
    assert.equal(await verifyLogin(proto.map(createRecord), '__proto__', password), '__proto__');
});

test('USER_* overrides replace the USERS entry ignoring case', () => {
    const [old, replacement, other] = [fakePassword(), fakePassword(), fakePassword()];
    const users = collectUsers({
        USERS: JSON.stringify({ tobias: old, Jemand: other }),
        USER_TOBIAS: ` ${replacement}\n`
    });
    assert.deepEqual(users, [{ name: 'Tobias', password: replacement }, { name: 'Jemand', password: other }]);
    // An unset or blank override adds nobody.
    for (const blank of ['', '   ']) {
        const kept = collectUsers({ USERS: JSON.stringify({ Jemand: other }), USER_TOBIAS: blank });
        assert.deepEqual(kept, [{ name: 'Jemand', password: other }]);
    }
});

test('an override can replace a too short USERS entry', () => {
    const password = fakePassword();
    assert.equal(collectUsers({ USERS: '{"Tobias":"short"}', USER_TOBIAS: password })[0].password, password);
});

test('the build fails on bad input without ever printing the secret', async () => {
    const secret = `Zq9${randomBytes(6).toString('hex')}`;
    const long = `${secret}-fake-long-value`;
    const cases = {
        'no users': {},
        'empty object': { USERS: '{}' },
        // The secret sits right next to the syntax error, where Node would quote it.
        'invalid JSON': { USERS: `{"a": "${secret}" x}` },
        'bare text': { USERS: secret },
        array: { USERS: JSON.stringify([long]) },
        string: { USERS: JSON.stringify(long) },
        null: { USERS: 'null' },
        'number value': { USERS: '{"a": 123456789012345}' },
        'empty value': { USERS: JSON.stringify({ a: '   ', b: long }) },
        'nested value': { USERS: JSON.stringify({ a: { password: long } }) },
        'empty name': { USERS: JSON.stringify({ ' ': long }) },
        duplicate: { USERS: JSON.stringify({ Anna: long, anna: long }) },
        'short in USERS': { USERS: JSON.stringify({ a: secret.slice(0, 11) }) },
        'short after trim': { USERS: JSON.stringify({ a: `   ${secret.slice(0, 11)}   ` }) },
        'short override': { USERS: JSON.stringify({ Tobias: long }), USER_TOBIAS: secret.slice(0, 11) }
    };
    await Promise.all(Object.entries(cases).map(async ([label, secrets]) => {
        const outDir = await outputDir();
        const result = await runBuild(outDir, secrets);
        assert.notEqual(result.code, 0, label);
        assert.match(result.output, /Build failed: /, label);
        assert.doesNotMatch(result.output, /unexpected/, label);
        // Not even a fragment of the secret.
        assert.equal(result.output.includes(secret.slice(0, 6)), false, label);
        await assert.rejects(access(outDir), label);
    }));
});

test('twelve characters are enough', () => {
    assert.equal(collectUsers({ USERS: JSON.stringify({ a: 'fake-12chars' }) }).length, 1);
});

test('error messages never quote a secret placed where the user name belongs', async () => {
    const secret = `Zq9${randomBytes(6).toString('hex')}`;
    const long = `${secret}-fake-long-value`;
    // Swapped or mistyped pairs: [USERS object, expected source in the message].
    const cases = {
        'swapped, short name as password': [{ [long]: 'Anna' }, 'USERS entry #1'],
        'swapped, symbols': [{ [`${secret}!#fake`]: 'Maximilian Mustermann' }, 'USERS entry #1'],
        'swapped, too long for a name': [{ [secret.repeat(3)]: 'Maximilian Mustermann' }, 'USERS entry #1'],
        'number as value': [{ [long]: 5 }, 'USERS entry #1'],
        'empty value': [{ ok: long, [long]: '' }, 'USERS entry #2'],
        duplicate: [{ [long]: long, [long.toUpperCase()]: long }, 'USERS entry #2'],
        'short password': [{ ok: long, [long]: 'short' }, 'USERS entry #2']
    };
    await Promise.all(Object.entries(cases).map(async ([label, [users, source]]) => {
        const result = await runBuild(await outputDir(), { USERS: JSON.stringify(users) });
        assert.notEqual(result.code, 0, label);
        assert.ok(result.output.includes(source), `${label}: ${source}`);
        assert.equal(result.output.toLowerCase().includes(secret.slice(0, 6).toLowerCase()), false, label);
    }));

    const override = await runBuild(await outputDir(), { USER_TOBIAS: secret.slice(0, 11) });
    assert.match(override.output, /USER_TOBIAS: the password needs at least 12 characters/);
});

test('user names are limited to name-like characters and 40 characters', () => {
    const password = fakePassword();
    const allowed = ['Jörg Müller-Lüdenscheidt', "O'Brien", 'a.b_c 42', 'Ανδρέας', 'Zoe\u0308', 'x'.repeat(40)];
    for (const name of allowed) {
        assert.equal(collectUsers({ USERS: JSON.stringify({ [name]: password }) })[0].name, name);
    }
    for (const name of ['x'.repeat(41), 'a@b', 'a!', 'a\tb', 'a\nb', 'a/b', 'a"b', '<a>', 'a=b', 'a\u{1F600}']) {
        assert.throws(() => collectUsers({ USERS: JSON.stringify({ [name]: password }) }),
            /^Error: USERS entry #1: the user name/, JSON.stringify(name));
    }
});

test('the build refuses to delete a directory that is not called _site', async () => {
    // A disposable directory: if the guard ever broke, nothing else would be lost.
    const victim = await mkdtemp(join(tmpdir(), 'toolkit-guard-'));
    temporary.push(victim);
    await writeFile(join(victim, 'keep.txt'), 'keep');
    await assert.rejects(build({ env: { USER_TOBIAS: fakePassword() }, outDir: victim }), /named _site/);
    assert.equal(await readFile(join(victim, 'keep.txt'), 'utf8'), 'keep');
});

test('the preview server rejects path traversal', () => {
    const root = join(tmpdir(), 'site-root');
    for (const url of [
        '/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json', '/..%5cpackage.json',
        '/%00', '/C:/Windows/win.ini', '/index.html:stream', '/%E0%A4%A', 'index.html'
    ]) {
        assert.equal(resolveRequestPath(root, url), null, url);
    }
    assert.equal(resolveRequestPath(root, '/'), join(root, 'index.html'));
    assert.equal(resolveRequestPath(root, '/assets/js/auth.js?v=1'), join(root, 'assets', 'js', 'auth.js'));
});

test('the preview server serves only the given directory', async () => {
    const outDir = await outputDir();
    await build({ env: { USER_TOBIAS: fakePassword() }, outDir });
    const server = createStaticServer(outDir);
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const page = await fetch(`${origin}/`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /text\/html/);
        assert.equal((await fetch(`${origin}/package.json`)).status, 404);
        assert.equal((await fetch(`${origin}/%2e%2e%2f_site%2findex.html`)).status, 404);
        assert.equal((await fetch(`${origin}/index.html`, { method: 'POST' })).status, 405);
    } finally {
        server.close();
    }
});
