import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/factory.js';
import { asAppError, AppError, ErrorCode } from '../core/errors.js';
import { ApiSchemas, parseApiInput } from './api-schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
};

function json(res, status, payload) {
  res.writeHead(status, { ...headers, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
const ok = (res, data, status = 200) => json(res, status, { ok: true, data });

function requireScope(user, scope) {
  if (!user.scopes?.includes(scope) && !user.scopes?.includes('admin')) {
    throw new AppError(ErrorCode.FORBIDDEN, `缺少权限: ${scope}`);
  }
}

async function body(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw new AppError(ErrorCode.INVALID_INPUT, 'Content-Type 必须是 application/json');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY) throw new AppError(ErrorCode.INVALID_INPUT, '请求体不能超过 1 MB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new AppError(ErrorCode.INVALID_INPUT, 'JSON 请求体格式错误'); }
}

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  return match?.[1];
}

function match(pathname, pattern) {
  const names = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_m, name) => { names.push(name); return '([^/]+)'; });
  const found = new RegExp(`^${source}$`).exec(pathname);
  return found ? Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(found[i + 1])])) : null;
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, relative);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return false;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { ...headers, 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
  return true;
}

export function createHttpServer(config, services) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return ok(res, { status: 'ok', version: '1.0.0' });
      if (req.method === 'POST' && url.pathname === '/api/bootstrap') {
        const input = parseApiInput(ApiSchemas.credentials, await body(req));
        return ok(res, services.auth.bootstrap(input.username, input.password), 201);
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const input = parseApiInput(ApiSchemas.credentials, await body(req));
        return ok(res, services.auth.login(input.username, input.password));
      }
      const oauthCallback = match(url.pathname, '/oauth/:provider/callback');
      if (req.method === 'GET' && oauthCallback) {
        const state = url.searchParams.get('state');
        const code = url.searchParams.get('code');
        if (!state || !code) throw new AppError(ErrorCode.INVALID_INPUT, 'OAuth 回调缺少 state 或 code');
        return ok(res, await services.oauth.callback(oauthCallback.provider, state, code));
      }
      if (url.pathname === '/mcp') return await handleMcp(req, res, config, services);

      if (url.pathname.startsWith('/api/')) {
        const user = services.auth.authenticate(bearer(req));
        if (req.method === 'GET' && url.pathname === '/api/me') return ok(res, user);
        if (req.method === 'POST' && url.pathname === '/api/users') {
          requireScope(user, 'admin');
          return ok(res, services.auth.createUser(user, parseApiInput(ApiSchemas.createUser, await body(req))), 201);
        }
        if (req.method === 'POST' && url.pathname === '/api/interviews') {
          requireScope(user, 'workbench:write');
          return ok(res, services.interviews.start(user, parseApiInput(ApiSchemas.interview, await body(req)).prompt), 201);
        }
        let params = match(url.pathname, '/api/interviews/:id/answers');
        if (req.method === 'POST' && params) { requireScope(user, 'workbench:write'); return ok(res, services.interviews.answer(user, params.id, parseApiInput(ApiSchemas.answers, await body(req)).answers)); }
        params = match(url.pathname, '/api/interviews/:id/finalize');
        if (req.method === 'POST' && params) { requireScope(user, 'workbench:write'); parseApiInput(ApiSchemas.empty, await body(req)); return ok(res, services.interviews.finalize(user, params.id), 201); }
        if (req.method === 'GET' && url.pathname === '/api/workbenches') { requireScope(user, 'workbench:read'); return ok(res, services.workbenches.list(user)); }
        if (req.method === 'POST' && url.pathname === '/api/workbenches') { requireScope(user, 'workbench:write'); return ok(res, services.workbenches.create(user, parseApiInput(ApiSchemas.createWorkbench, await body(req)).spec), 201); }
        params = match(url.pathname, '/api/workbenches/:id');
        if (req.method === 'GET' && params) { requireScope(user, 'workbench:read'); return ok(res, services.workbenches.get(user, params.id)); }
        if (req.method === 'PATCH' && params) {
          requireScope(user, 'workbench:write');
          const input = parseApiInput(ApiSchemas.reviseWorkbench, await body(req));
          return ok(res, services.workbenches.revise(user, params.id, input.patch, input.note));
        }
        if (req.method === 'PUT' && params) {
          requireScope(user, 'workbench:write');
          const input = parseApiInput(ApiSchemas.replaceWorkbench, await body(req));
          return ok(res, services.workbenches.replace(user, params.id, input.spec, input.note));
        }
        params = match(url.pathname, '/api/workbenches/:id/versions');
        if (req.method === 'GET' && params) { requireScope(user, 'workbench:read'); return ok(res, services.workbenches.versions(user, params.id)); }
        params = match(url.pathname, '/api/workbenches/:id/rollback');
        if (req.method === 'POST' && params) { requireScope(user, 'workbench:write'); return ok(res, services.workbenches.rollback(user, params.id, parseApiInput(ApiSchemas.rollback, await body(req)).version)); }
        if (req.method === 'POST' && url.pathname === '/api/actions') { requireScope(user, 'action:request'); return ok(res, services.actions.request(user, parseApiInput(ApiSchemas.requestAction, await body(req))), 201); }
        params = match(url.pathname, '/api/actions/:id/approve');
        if (req.method === 'POST' && params) { requireScope(user, 'action:approve'); parseApiInput(ApiSchemas.empty, await body(req)); return ok(res, services.actions.approve(user, params.id)); }
        params = match(url.pathname, '/api/actions/:id/reject');
        if (req.method === 'POST' && params) { requireScope(user, 'action:approve'); parseApiInput(ApiSchemas.empty, await body(req)); return ok(res, services.actions.reject(user, params.id)); }
        params = match(url.pathname, '/api/actions/:id/execute');
        if (req.method === 'POST' && params) { requireScope(user, 'action:approve'); return ok(res, await services.actions.execute(user, params.id, parseApiInput(ApiSchemas.approval, await body(req)).approvalToken)); }
        params = match(url.pathname, '/api/oauth/:provider/start');
        if (req.method === 'POST' && params) {
          requireScope(user, 'workbench:write');
          parseApiInput(ApiSchemas.empty, await body(req));
          const redirectUri = `${config.publicBaseUrl}/oauth/${encodeURIComponent(params.provider)}/callback`;
          return ok(res, services.oauth.start(user, params.provider, redirectUri));
        }
        if (req.method === 'GET' && url.pathname === '/api/audit') {
          requireScope(user, 'admin');
          if (user.role !== 'admin') throw new AppError(ErrorCode.FORBIDDEN, '只有管理员可以读取审计日志');
          return ok(res, services.store.listAudit(Math.min(100, Number(url.searchParams.get('limit') || 100))));
        }
        throw new AppError(ErrorCode.NOT_FOUND, 'API 路由不存在');
      }
      if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
      throw new AppError(ErrorCode.NOT_FOUND, '页面不存在');
    } catch (error) {
      const appError = asAppError(error);
      if (!res.headersSent) json(res, appError.status, { ok: false, error: { code: appError.code, message: appError.message, ...(appError.details ? { details: appError.details } : {}) } });
    }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return server;
}

async function handleMcp(req, res, config, services) {
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) throw new AppError(ErrorCode.FORBIDDEN, 'Origin 不允许');
  const user = services.auth.authenticate(bearer(req));
  if (req.method !== 'POST') throw new AppError(ErrorCode.INVALID_INPUT, '无状态 MCP 仅接受 POST');
  const parsedBody = await body(req);
  req.auth = { token: bearer(req), clientId: user.id, scopes: user.scopes };
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const mcp = createMcpServer({ services, user, filesystemTools: false });
  await mcp.connect(transport);
  try { await transport.handleRequest(req, res, parsedBody); }
  finally { await mcp.close(); }
}
