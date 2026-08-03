import { ConnectorAdapter } from './adapter.js';
import { AppError, ErrorCode, invariant } from '../errors.js';
import { meta } from './rest-apikey.js';

function substitute(template, params) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key) => {
    invariant(Object.hasOwn(params, key), ErrorCode.INVALID_INPUT, `缺少路径参数: ${key}`);
    return encodeURIComponent(String(params[key]));
  });
}

function buildUrl(baseUrl, template, params) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  const relative = substitute(template, params).replace(/^\/+/, '');
  const url = new URL(relative, new URL(basePath, base.origin));
  invariant(url.origin === base.origin, ErrorCode.INVALID_INPUT, '请求路径不得改变上游来源');
  return url;
}

function authHeaders(connector, env, url) {
  const headers = { ...(connector.headers || {}) };
  const auth = connector.auth;
  if (!auth) return headers;
  const secret = env[auth.env];
  invariant(secret, ErrorCode.CONFIGURATION_ERROR, `未配置环境变量: ${auth.env}`);
  if (auth.mode === 'bearer') headers[auth.header || 'Authorization'] = `Bearer ${secret}`;
  else if (auth.mode === 'header') headers[auth.header || 'X-API-Key'] = secret;
  else if (auth.mode === 'query') url.searchParams.set(auth.queryParam || 'api_key', secret);
  return headers;
}

export function validateActionInput(definition, input) {
  const allowed = new Set(definition.input.map((field) => field.name));
  for (const key of Object.keys(input || {})) {
    if (!allowed.has(key)) throw new AppError(ErrorCode.INVALID_INPUT, `未知 action 输入字段: ${key}`);
  }
  for (const field of definition.input) {
    const value = input?.[field.name];
    if (field.required && value == null) throw new AppError(ErrorCode.INVALID_INPUT, `缺少 action 输入字段: ${field.name}`);
    if (value != null && typeof value !== field.type) throw new AppError(ErrorCode.INVALID_INPUT, `${field.name} 必须是 ${field.type}`);
  }
}

export class RestApiKeyAdapter extends ConnectorAdapter {
  constructor() {
    super({ ...meta, supportsActions: true });
  }

  buildReadRequest(connector, endpointId, params = {}, env = {}) {
    const endpoint = connector.endpoints.find((item) => item.id === endpointId);
    invariant(endpoint, ErrorCode.NOT_FOUND, `未知 endpoint: ${endpointId}`);
    const url = buildUrl(connector.baseUrl, endpoint.path, params);
    return { url, method: 'GET', headers: authHeaders(connector, env, url) };
  }

  validateAction(connector, actionId, input = {}) {
    const definition = connector.actions?.find((item) => item.id === actionId);
    invariant(definition, ErrorCode.NOT_FOUND, `未知 action: ${actionId}`);
    validateActionInput(definition, input);
    return definition;
  }

  buildActionRequest(connector, actionId, input = {}, params = {}, env = {}) {
    const definition = this.validateAction(connector, actionId, input);
    const url = buildUrl(connector.baseUrl, definition.path, { ...params, ...input });
    const headers = authHeaders(connector, env, url);
    headers['Content-Type'] = 'application/json';
    return {
      url,
      method: definition.method,
      headers,
      body: definition.method === 'DELETE' && !Object.keys(input).length ? undefined : JSON.stringify(input),
      definition
    };
  }
}
