import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../../src/storage/database.js';
import { OAuthService } from '../../src/services/oauth-service.js';
import { AuthService } from '../../src/services/auth-service.js';

test('OAuth authorization-code PKCE flow encrypts tokens and consumes state once', async () => {
  const store = new SqliteStore(':memory:');
  const calls = [];
  const service = new OAuthService(store, {
    demo: {
      authorizationUrl: 'http://127.0.0.1/authorize', tokenUrl: 'http://127.0.0.1/token',
      clientId: 'client', clientSecret: 'secret', scopes: ['read', 'write']
    }
  }, {
    masterKey: 'k'.repeat(32), allowPrivate: true,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'read write' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }
  });
  try {
    const auth = new AuthService(store);
    const created = auth.bootstrap('admin', 'admin-password-123');
    const user = auth.authenticate(created.token);
    const started = service.start(user, 'demo', 'http://localhost/oauth/demo/callback');
    const authUrl = new URL(started.authorizationUrl);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authUrl.searchParams.get('state'), started.state);
    const result = await service.callback('demo', started.state, 'authorization-code');
    assert.equal(result.userId, user.id);
    assert.equal(calls.length, 1);
    assert.equal(new URLSearchParams(calls[0].init.body).get('code_verifier').length > 40, true);
    assert.deepEqual(service.credential(user, 'demo'), {
      provider: 'demo', accessToken: 'access', refreshToken: 'refresh',
      expiresAt: result.expiresAt, scopes: ['read', 'write']
    });
    await assert.rejects(() => service.callback('demo', started.state, 'again'), /无效或已使用/);
  } finally { store.close(); }
});
