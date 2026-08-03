import { randomUUID, createHash } from 'node:crypto';
import { AppError, ErrorCode, invariant } from '../core/errors.js';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../security/crypto.js';
import { assertPublicUrl } from '../security/outbound.js';

const challenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

export class OAuthService {
  constructor(store, providers, { masterKey, allowPrivate = false, fetchImpl = fetch } = {}) {
    this.store = store;
    this.providers = providers || {};
    this.masterKey = masterKey;
    this.allowPrivate = allowPrivate;
    this.fetch = fetchImpl;
  }

  start(user, providerId, redirectUri) {
    const provider = this.#provider(providerId);
    const state = randomToken(24);
    const verifier = randomToken(48);
    const now = this.store.now();
    this.store.insertOauthState({
      id: randomUUID(), userId: user.id, provider: providerId, stateHash: sha256(state), codeVerifier: verifier,
      redirectUri, expiresAt: new Date(Date.parse(now) + 600_000).toISOString(), createdAt: now
    });
    const url = new URL(provider.authorizationUrl);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: provider.clientId, redirect_uri: redirectUri,
      scope: (provider.scopes || []).join(' '), state, code_challenge: challenge(verifier), code_challenge_method: 'S256'
    }).toString();
    this.store.audit(user.id, 'oauth.started', 'oauth', providerId);
    return { authorizationUrl: url.href, state };
  }

  async callback(providerId, state, code) {
    const provider = this.#provider(providerId);
    const now = this.store.now();
    const pending = this.store.consumeOauthState(sha256(state || ''), now);
    invariant(pending && pending.provider === providerId, ErrorCode.UNAUTHENTICATED, 'OAuth state 无效或已使用');
    invariant(Date.parse(pending.expires_at) > Date.parse(now), ErrorCode.EXPIRED, 'OAuth state 已过期');
    await assertPublicUrl(provider.tokenUrl, { allowPrivate: this.allowPrivate });
    const response = await this.fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: pending.redirect_uri,
        client_id: provider.clientId, ...(provider.clientSecret ? { client_secret: provider.clientSecret } : {}),
        code_verifier: pending.code_verifier
      }),
      redirect: 'manual', signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new AppError(ErrorCode.UPSTREAM_FAILED, `OAuth token endpoint 返回 HTTP ${response.status}`);
    const token = await response.json();
    invariant(token.access_token, ErrorCode.UPSTREAM_FAILED, 'OAuth 响应缺少 access_token');
    const expiresAt = token.expires_in ? new Date(Date.parse(now) + Number(token.expires_in) * 1000).toISOString() : null;
    this.store.upsertOauthCredential({
      userId: pending.user_id, provider: providerId,
      accessTokenEnc: encryptSecret(token.access_token, this.masterKey),
      refreshTokenEnc: token.refresh_token ? encryptSecret(token.refresh_token, this.masterKey) : null,
      expiresAt, scopesJson: JSON.stringify(String(token.scope || '').split(/\s+/).filter(Boolean)),
      createdAt: now, updatedAt: now
    });
    this.store.audit(pending.user_id, 'oauth.connected', 'oauth', providerId, { expiresAt });
    return { userId: pending.user_id, provider: providerId, expiresAt };
  }

  credential(user, providerId) {
    const row = this.store.getOauthCredential(user.id, providerId);
    invariant(row, ErrorCode.NOT_FOUND, 'OAuth 凭据不存在');
    return {
      provider: providerId,
      accessToken: decryptSecret(row.access_token_enc, this.masterKey),
      refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc, this.masterKey) : null,
      expiresAt: row.expires_at,
      scopes: JSON.parse(row.scopes_json)
    };
  }

  #provider(id) {
    const provider = this.providers[id];
    invariant(provider, ErrorCode.NOT_FOUND, `OAuth provider 未配置: ${id}`);
    for (const key of ['authorizationUrl', 'tokenUrl', 'clientId']) {
      invariant(provider[key], ErrorCode.CONFIGURATION_ERROR, `${id}.${key} 未配置`);
    }
    for (const key of ['authorizationUrl', 'tokenUrl']) {
      let url;
      try { url = new URL(provider[key]); }
      catch { throw new AppError(ErrorCode.CONFIGURATION_ERROR, `${id}.${key} 不是有效 URL`); }
      const protocolAllowed = url.protocol === 'https:' || (this.allowPrivate && url.protocol === 'http:');
      invariant(protocolAllowed && !url.username && !url.password, ErrorCode.CONFIGURATION_ERROR, `${id}.${key} 必须使用 HTTPS 且不得包含凭据`);
    }
    return provider;
  }
}

export function parseOAuthProviders(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    invariant(parsed && typeof parsed === 'object' && !Array.isArray(parsed), ErrorCode.CONFIGURATION_ERROR, 'OAUTH_PROVIDERS_JSON 必须是对象');
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(ErrorCode.CONFIGURATION_ERROR, 'OAUTH_PROVIDERS_JSON 不是有效 JSON');
  }
}
