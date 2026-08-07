const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
    return `scrypt$${salt}$${derivedKey}`;
}

function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;

    const parts = storedHash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

    const [, salt, expectedHex] = parts;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);

    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function safeEqualText(left, right) {
    const a = Buffer.from(String(left ?? ''), 'utf8');
    const b = Buffer.from(String(right ?? ''), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
    hashPassword,
    verifyPassword,
    safeEqualText
};
