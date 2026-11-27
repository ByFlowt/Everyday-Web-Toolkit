// Password check against the salted PBKDF2-HMAC-SHA256 records written by scripts/build.mjs.
// No DOM access.

export const ITERATIONS = 600000;
const HASH_BITS = 256;
const SALT_BYTES = 16;

export function isCryptoAvailable() {
    return Boolean(globalThis.crypto?.subtle);
}

function fromBase64(value) {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function deriveHash(password, salt, iterations) {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, keyMaterial, HASH_BITS
    );
    return new Uint8Array(bits);
}

function equalBytes(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let difference = 0;
    for (let i = 0; i < a.length; i += 1) {
        difference |= a[i] ^ b[i];
    }
    return difference === 0;
}

// Resolves to the stored user name, or null for an unknown user or a wrong password.
export async function verifyLogin(records, name, password) {
    const wanted = name.trim().toLowerCase();
    const record = records.find((entry) => entry.name.toLowerCase() === wanted);
    if (!record) {
        // Dummy derivation: unknown users take as long as wrong passwords.
        await deriveHash(password.trim(), new Uint8Array(SALT_BYTES), records[0]?.iterations ?? ITERATIONS);
        return null;
    }
    const hash = await deriveHash(password.trim(), fromBase64(record.salt), record.iterations);
    return equalBytes(hash, fromBase64(record.hash)) ? record.name : null;
}
