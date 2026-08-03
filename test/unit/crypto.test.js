import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, hashPassword, sha256, verifyPassword } from '../../src/security/crypto.js';

test('password hashing uses salt and verifies without storing plaintext', () => {
  const password = 'correct-horse-battery-staple';
  const first = hashPassword(password);
  const second = hashPassword(password);
  assert.notEqual(first.hash, second.hash);
  assert.equal(verifyPassword(password, first.salt, first.hash), true);
  assert.equal(verifyPassword('wrong-password-value', first.salt, first.hash), false);
  assert.throws(() => hashPassword('too-short'));
});

test('AES-GCM credentials round-trip and reject a wrong key', () => {
  const key = 'a'.repeat(32);
  const payload = encryptSecret('oauth-access-token', key);
  assert.equal(payload.includes('oauth-access-token'), false);
  assert.equal(decryptSecret(payload, key), 'oauth-access-token');
  assert.throws(() => decryptSecret(payload, 'b'.repeat(32)), /无法解密凭据/);
  assert.equal(sha256('same'), sha256('same'));
});
