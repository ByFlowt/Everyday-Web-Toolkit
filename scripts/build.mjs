// Builds the deployable site into _site/ from an explicit allowlist.
// Usage: node scripts/build.mjs [path/to/_site]
// Reads USERS (JSON object name -> password) and the USER_* overrides from the environment.
// Only salted PBKDF2 hashes reach the output. Never log any secret value.
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITERATIONS } from '../assets/js/auth.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGES = ['index.html', 'Converter.html', 'TimeCalculator.html'];
const ASSET_DIR = 'assets';
const ASSET_TYPES = new Set(['.css', '.js', '.svg']);
const MIN_PASSWORD_LENGTH = 12;
const MAX_NAME_LENGTH = 40;
// Names are published, so anything that does not look like a name is refused.
const NAME_PATTERN = /^[\p{L}\p{M}\p{Nd} ._'-]+$/u;
const OVERRIDES = Object.freeze({ USER_TOBIAS: 'Tobias' });

// Messages of this class are safe to print. They never quote anything from a secret: if a name and its
// password are swapped, the "name" is the password. Entries are identified by position or variable name.
class BuildError extends Error {}

function parseUsersSecret(raw) {
    if (!raw.trim()) return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Do not forward the parser's message: Node quotes part of the input in it.
        throw new BuildError('USERS is not valid JSON.');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new BuildError('USERS must be a JSON object that maps user names to passwords.');
    }
    return parsed;
}

// Merges all sources into [{ name, password }]. Names are unique ignoring case.
export function collectUsers(env) {
    const users = new Map();

    Object.entries(parseUsersSecret(env.USERS ?? '')).forEach(([rawName, value], index) => {
        const source = `USERS entry #${index + 1}`;
        const name = rawName.trim();
        if (!name) {
            throw new BuildError(`${source}: the user name is empty.`);
        }
        if ([...name].length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
            throw new BuildError(`${source}: the user name may have up to ${MAX_NAME_LENGTH} characters: `
                + "letters, digits, spaces and . _ - ' only.");
        }
        if (typeof value !== 'string' || !value.trim()) {
            throw new BuildError(`${source}: the password must be a non-empty string.`);
        }
        const earlier = users.get(name.toLowerCase());
        if (earlier) {
            throw new BuildError(`${source} has the same user name as ${earlier.source} (names ignore case).`);
        }
        users.set(name.toLowerCase(), { name, password: value.trim(), source });
    });

    // An unset GitHub secret arrives as an empty string.
    for (const [variable, name] of Object.entries(OVERRIDES)) {
        const password = (env[variable] ?? '').trim();
        if (password) {
            users.set(name.toLowerCase(), { name, password, source: variable });
        }
    }

    if (users.size === 0) {
        throw new BuildError('No users configured. Set USERS and/or USER_TOBIAS.');
    }
    for (const { password, source } of users.values()) {
        if ([...password].length < MIN_PASSWORD_LENGTH) {
            throw new BuildError(`${source}: the password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
    }
    return [...users.values()].map(({ name, password }) => ({ name, password }));
}

export function createRecord({ name, password }) {
    const salt = randomBytes(16);
    return {
        name,
        salt: salt.toString('base64'),
        iterations: ITERATIONS,
        hash: pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256').toString('base64')
    };
}

async function isAllowedAsset(source) {
    if (basename(source).startsWith('.')) return false;
    const info = await lstat(source);
    return info.isDirectory() || (info.isFile() && ASSET_TYPES.has(extname(source)));
}

async function stampBuiltAssets(target) {
    const assetsRoot = join(target, ASSET_DIR);
    const entries = await readdir(assetsRoot, { recursive: true, withFileTypes: true });
    const assetPaths = entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.css') || entry.name.endsWith('.js')))
        .map((entry) => join(entry.parentPath, entry.name))
        .sort();

    const digest = createHash('sha256');
    for (const file of assetPaths) {
        digest.update(file.slice(assetsRoot.length));
        digest.update(await readFile(file));
    }
    const version = digest.digest('hex').slice(0, 8);

    for (const page of PAGES) {
        const pagePath = join(target, page);
        const html = await readFile(pagePath, 'utf8');
        const stamped = html.replace(/((?:href|src)="assets\/(?:css|js)\/[\w-]+\.(?:css|js))"/g, `$1?v=${version}"`);
        await writeFile(pagePath, stamped);
    }

    for (const file of assetPaths) {
        if (!file.endsWith('.js')) continue;
        const source = await readFile(file, 'utf8');
        const stamped = source.replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${version}'`);
        if (stamped !== source) {
            await writeFile(file, stamped);
        }
    }
}

export async function build({ env = process.env, outDir = join(ROOT, '_site') } = {}) {
    const target = resolve(outDir);
    // The target is deleted first, so only a folder literally named _site is accepted.
    if (basename(target) !== '_site') {
        throw new BuildError('The output directory must be named _site.');
    }
    const records = collectUsers(env).map(createRecord);

    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    for (const page of PAGES) {
        await cp(join(ROOT, page), join(target, page));
    }
    await cp(join(ROOT, ASSET_DIR), join(target, ASSET_DIR), { recursive: true, filter: isAllowedAsset });
    // Must come after the asset copy, which brings the empty placeholder along.
    await writeFile(
        join(target, ASSET_DIR, 'js', 'users.js'),
        `// Generated by scripts/build.mjs.\nexport const USERS = ${JSON.stringify(records, null, 2)};\n`
    );
    await stampBuiltAssets(target);
    return { outDir: target, userCount: records.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { outDir, userCount } = await build({ outDir: process.argv[2] });
        console.log(`Built ${outDir} with ${userCount} user(s).`);
    } catch (error) {
        const detail = error instanceof BuildError ? error.message : `unexpected ${error.code ?? error.name}`;
        console.error(`Build failed: ${detail}`);
        process.exitCode = 1;
    }
}
