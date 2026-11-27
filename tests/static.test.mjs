import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const PAGES = ['index.html', 'Converter.html', 'TimeCalculator.html'];
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// Exact-case listing: GitHub Pages is case-sensitive, the developer's file system may not be.
const files = new Set(readdirSync(fileURLToPath(new URL('assets', ROOT)), { recursive: true, withFileTypes: false })
    .map((path) => `assets/${path.split('\\').join('/')}`)
    .concat(PAGES));

const css = [...files].filter((file) => file.endsWith('.css'));
const scripts = [...files].filter((file) => file.endsWith('.js'));

for (const page of PAGES) {
    const html = stripComments(read(page));
    const tags = html.match(/<[a-zA-Z][^>]*>/g);

    test(`${page}: CSP and referrer policy come before any resource`, () => {
        const meta = /<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)">/.exec(html);
        assert.ok(meta);
        const directives = Object.fromEntries(meta[1].split(';').map((part) => {
            const [name, ...values] = part.trim().split(/\s+/);
            return [name, values.join(' ')];
        }));
        assert.deepEqual(directives, {
            'default-src': "'none'",
            'script-src': "'self'",
            'style-src': "'self' https://fonts.googleapis.com",
            'font-src': 'https://fonts.gstatic.com',
            'img-src': "'self' data:",
            'connect-src': page === 'index.html' ? 'https://generativelanguage.googleapis.com' : "'none'",
            'base-uri': "'none'",
            'form-action': "'none'"
        });
        assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
        assert.ok(meta.index < html.search(/<(?:link|script)\b/));
    });

    test(`${page}: no inline scripts, styles or event handlers`, () => {
        for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
            assert.match(attributes, /\ssrc="assets\/js\/[\w-]+\.js"/);
            assert.equal(body.trim(), '');
        }
        for (const tag of tags) {
            assert.doesNotMatch(tag, /^<style\b/i, tag);
            assert.doesNotMatch(tag, /\sstyle\s*=/i, tag);
            assert.doesNotMatch(tag, /\son\w+\s*=/i, tag);
            assert.doesNotMatch(tag, /javascript:/i, tag);
        }
    });

    test(`${page}: local references exist and only Google Fonts is external`, () => {
        for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
            if (url.startsWith('https://')) {
                assert.ok(url.startsWith('https://fonts.googleapis.com/css2?'), url);
            } else if (!url.startsWith('#')) {
                const pathOnly = url.split('#', 1)[0];
                assert.ok(files.has(pathOnly), `missing: ${url}`);
            }
        }
    });

    test(`${page}: language, labels, icons, noscript and head metadata`, () => {
        assert.match(html, /<html lang="de"/);
        assert.match(html, /<noscript>/);
        assert.match(html, /<link rel="icon" href="assets\/favicon\.svg"/);
        assert.match(html, /<meta name="theme-color"/);
        for (const tag of tags.filter((candidate) => /^<(?:input|textarea|select)\b/.test(candidate))) {
            const id = /\sid="([^"]+)"/.exec(tag)?.[1];
            assert.ok(id, tag);
            assert.ok(html.includes(`<label for="${id}"`), `no label for ${id}`);
        }
        for (const tag of tags.filter((candidate) => candidate.includes('material-symbols-outlined'))) {
            assert.match(tag, /aria-hidden="true"/, tag);
        }
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
        assert.equal(new Set(ids).size, ids.length, 'duplicate id');
        for (const [, reference] of html.matchAll(/\s(?:aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
            assert.ok(ids.includes(reference), reference);
        }
    });

    test(`${page}: loads the shared session guard or route redirect synchronously`, () => {
        if (page === 'index.html') {
            const session = html.indexOf('<script src="assets/js/session.js"></script>');
            const guard = html.indexOf('<script src="assets/js/session-guard.js"></script>');
            assert.ok(session > -1 && guard > session && guard < html.indexOf('<body'));
        } else {
            const redirect = html.indexOf('<script src="assets/js/route-redirect.js"></script>');
            assert.ok(redirect > -1 && redirect < html.indexOf('<body'));
            assert.match(html, new RegExp(`data-redirect="${page === 'Converter.html' ? 'converter' : 'calculator'}"`));
        }
    });
}

test('the login form cannot put the password into the URL', () => {
    const html = read('index.html');
    assert.match(html, /<form [^>]*method="post"/);
    assert.doesNotMatch(html, /<form [^>]*action=/);
    assert.match(html, /<button type="submit"[^>]*\sdisabled>/);
});

test('the API key field ships masked, disabled and ignored by password managers', () => {
    const html = read('index.html');
    const tag = /<input[^>]*id="apiKey"[^>]*>/.exec(html)[0];
    for (const attribute of [
        'type="text"', 'class="secret-input"', 'autocomplete="off"', 'autocapitalize="off"', 'spellcheck="false"',
        'data-1p-ignore', 'data-lpignore="true"', 'data-bwignore', 'disabled'
    ]) {
        assert.match(tag, new RegExp(`\\s${attribute}(?=[\\s>])`), attribute);
    }
    const styles = read('assets/css/converter.css');
    assert.match(styles, /\.secret-input\[type="text"\] \{\s*-webkit-text-security: disc;/);
    assert.match(styles, /@supports not \(-webkit-text-security: disc\)[\s\S]*?color: transparent;/);
});

test('the browser may not restore text or calculator values across users', () => {
    const html = read('index.html');
    assert.match(html, /<textarea id="inputText"[^>]*\sautocomplete="off"/);
    for (const id of ['startTime', 'workHours', 'breakMinutes', 'currentOvertime', 'toggleOvertime', 'dailyOvertimeCalc']) {
        const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
        assert.ok(tag, id);
        assert.match(tag, /\sautocomplete="off"/, tag);
    }
});

test('module imports resolve with exact case', () => {
    for (const script of scripts) {
        for (const [, specifier] of read(script).matchAll(/\bfrom\s+'([^']+)'/g)) {
            assert.ok(files.has(posix.join(posix.dirname(script), specifier)), `${script}: ${specifier}`);
        }
    }
});

test('page scripts avoid HTML injection sinks and third-party code', () => {
    for (const script of scripts) {
        assert.doesNotMatch(read(script), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/, script);
        assert.doesNotMatch(read(script), /esm\.(?:run|sh)|@google\/generative-ai|console\./, script);
    }
});

test('the committed user list is an empty placeholder', async () => {
    const { USERS } = await import('../assets/js/users.js');
    assert.deepEqual(USERS, []);
});

// ---------- Design tokens ----------
const theme = read('assets/css/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = (block) => Object.fromEntries(
    [...block.matchAll(/(--md-[\w-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1].slice(5), match[2]]));
const darkStart = theme.indexOf('@media (prefers-color-scheme: dark)');
const explicitDarkStart = theme.indexOf(':root[data-theme="dark"]');
const shapeStart = theme.indexOf('--shape-none');
const schemes = {
    light: declarations(theme.slice(0, darkStart)),
    dark: declarations(theme.slice(darkStart, explicitDarkStart)),
    explicitDark: declarations(theme.slice(explicitDarkStart, shapeStart))
};

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((start) => {
        const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

const SURFACES = ['surface', 'surface-dim', 'surface-container-lowest', 'surface-container-low',
    'surface-container', 'surface-container-high', 'surface-container-highest'];

test('light and dark define the same color roles', () => {
    assert.deepEqual(Object.keys(schemes.light).sort(), Object.keys(schemes.dark).sort());
    assert.deepEqual(schemes.explicitDark, schemes.dark);
    assert.equal(schemes.light.primary, '#00687a');
});

for (const [name, color] of Object.entries(schemes)) {
    test(`${name} scheme: text meets WCAG AA and outlines reach 3:1`, () => {
        const pairs = [['inverse-on-surface', 'inverse-surface']];
        for (const role of ['primary', 'secondary', 'tertiary', 'error']) {
            pairs.push([`on-${role}`, role], [`on-${role}-container`, `${role}-container`]);
        }
        for (const surface of SURFACES) {
            pairs.push(['on-surface', surface], ['on-surface-variant', surface], ['primary', surface]);
        }
        for (const [foreground, background] of pairs) {
            const ratio = contrast(color[foreground], color[background]);
            assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}`);
        }
        for (const surface of ['surface', 'surface-container']) {
            assert.ok(contrast(color.outline, color[surface]) >= 3, `outline on ${surface}`);
            assert.ok(contrast(color.secondary, color[surface]) >= 3, `focus ring on ${surface}`);
        }
    });
}

test('hex colors only appear in the theme token blocks', () => {
    for (const file of css.filter((path) => path !== 'assets/css/theme.css')) {
        assert.doesNotMatch(read(file), /#[0-9a-fA-F]{3,8}\b/, file);
    }
    const afterTokens = theme.slice(theme.indexOf('--shape-none'));
    assert.doesNotMatch(afterTokens, /:[^;{}]*#[0-9a-fA-F]{3,8}\b/);
});

test('every used custom property is defined', () => {
    const all = css.map(read).join('\n');
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const [, used] of all.matchAll(/var\((--[\w-]+)/g)) {
        assert.ok(defined.has(used), used);
    }
});

test('hidden elements stay hidden and reduced motion stops animations', () => {
    assert.match(theme, /\[hidden\]\s*\{\s*display: none !important;/);
    const reduced = theme.slice(theme.indexOf('@media (prefers-reduced-motion: reduce)'));
    assert.match(reduced, /animation: none !important;/);
    assert.match(reduced, /transition: none !important;/);
});
