const crypto = require('crypto');
const {
  generateCsrfToken,
  generateOpaqueToken,
  hashCsrfToken,
} = require('../../backend/src/modules/auth/sessionService');

describe('session token material', () => {
  it('generates an independent 256-bit CSRF token for every session', () => {
    const token = generateCsrfToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateCsrfToken()).not.toBe(token);
  });

  it('generates an independent 256-bit opaque session token', () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateOpaqueToken()).not.toBe(token);
  });

  it('stores only the SHA-256 hash of a CSRF token', () => {
    const token = generateCsrfToken();
    const hash = hashCsrfToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(crypto.createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hash).not.toContain(token);
  });
});
