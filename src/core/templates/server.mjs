import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const MAX_UPSTREAM_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const PUBLIC = path.join(__dirname, 'public');
const DIST = path.join(__dirname, 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('PORT 必须是 1-65535 的整数');
  process.exit(1);
}

let SPEC;
try {
  SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'spec.json'), 'utf8'));
} catch (error) {
  console.error('无法读取 spec.json:', error.message);
  process.exit(1);
}
const CONN = SPEC.connector || {};
const PUBLIC_SPEC = {
  ...SPEC,
  connector: { type: CONN.type, ...(CONN.account ? { account: CONN.account } : {}) }
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
};

function send(res, code, body, type = 'application/json', extra = {}) {
  res.writeHead(code, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': type + '; charset=utf-8',
    ...extra
  });
  res.end(typeof body === 'string' && type !== 'application/json' ? body : JSON.stringify(body));
}

function fmtNum(value) {
  const n = Number(value) || 0;
  const absolute = Math.abs(n);
  if (absolute >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (absolute >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString('zh-CN');
}

function isBlockedIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 192 && b === 0)
      || (a === 198 && b === 51)
      || (a === 203 && b === 0);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
      || /^fe[89ab]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8:')
      || value.includes('::ffff:');
  }
  return true;
}

async function assertPublicTarget(url) {
  if (url.protocol !== 'https:') throw new Error('仅允许 HTTPS 上游');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('禁止访问本机或内网目标');
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new Error('目标解析到内网、保留或不可用地址');
  }
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_UPSTREAM_BYTES) throw new Error('上游响应超过 5 MB');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_BYTES) {
      await reader.cancel();
      throw new Error('上游响应超过 5 MB');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function safeFetch(initialUrl, options = {}) {
  const originalOrigin = initialUrl.origin;
  let url = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicTarget(url);
    const response = await fetch(url, {
      ...options,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('上游重定向缺少 Location');
      const next = new URL(location, url);
      if (next.origin !== originalOrigin) throw new Error('拒绝跨域重定向');
      url = next;
      continue;
    }
    if (!response.ok) throw new Error(`上游返回 HTTP ${response.status}`);
    return { response, body: await readLimited(response) };
  }
  throw new Error('上游重定向次数过多');
}

const wxCache = { token: null, expiresAt: 0 };
async function wxToken() {
  if (wxCache.token && Date.now() < wxCache.expiresAt) return wxCache.token;
  const appid = process.env[CONN.appidEnv || 'WECHAT_APPID'] || '';
  const secret = process.env[CONN.secretEnv || 'WECHAT_SECRET'] || '';
  if (!appid || !secret) return null;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.search = new URLSearchParams({ grant_type: 'client_credential', appid, secret }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const data = await response.json();
  if (!data.access_token) return null;
  wxCache.token = data.access_token;
  wxCache.expiresAt = Date.now() + Math.max(60, Number(data.expires_in || 7200) - 60) * 1000;
  return wxCache.token;
}

async function wxPost(api, data) {
  const token = await wxToken();
  if (!token) return { errcode: -1, errmsg: 'no_token' };
  const url = new URL(api, 'https://api.weixin.qq.com');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  return response.json();
}

const ymd = (date) => date.toISOString().slice(0, 10);
const daysAgo = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
};

function demoOverview(reason) {
  return {
    source: 'demo', note: reason,
    kpis: { cumulate: '—', netToday: '—', newUser: '—', shares: '—' },
    chart: { labels: [], read: [], follow: [] },
    channels: [], top: []
  };
}

async function wechatOverview() {
  const appid = process.env[CONN.appidEnv || 'WECHAT_APPID'] || '';
  const secret = process.env[CONN.secretEnv || 'WECHAT_SECRET'] || '';
  if (!appid || !secret) return demoOverview('未配置微信公众号环境变量');
  if (!(await wxToken())) return demoOverview('access_token 获取失败，请检查凭据与服务器 IP 白名单');

  const yesterday = ymd(daysAgo(1));
  const sevenDaysAgo = ymd(daysAgo(7));
  const [cum, users, articles] = await Promise.all([
    wxPost('/datacube/getusercumulate', { begin_date: sevenDaysAgo, end_date: yesterday }),
    wxPost('/datacube/getusersummary', { begin_date: sevenDaysAgo, end_date: yesterday }),
    wxPost('/datacube/getarticlesummary', { begin_date: yesterday, end_date: yesterday })
  ]);
  const apiError = [cum, users, articles].find((value) => value.errcode);
  if (apiError) return demoOverview(`微信接口错误 ${apiError.errcode}: ${apiError.errmsg || 'unknown'}`);

  const cumulative = cum.list || [];
  const summaries = users.list || [];
  const articleList = articles.list || [];
  const latest = cumulative.at(-1)?.cumulate_user || 0;
  const todayRows = summaries.filter((row) => row.ref_date === yesterday);
  const newUser = todayRows.reduce((sum, row) => sum + Number(row.new_user || 0), 0);
  const cancelled = todayRows.reduce((sum, row) => sum + Number(row.cancel_user || 0), 0);
  const labels = cumulative.map((row) => row.ref_date.slice(5));
  const follow = cumulative.map((row, index) => index === 0 ? null : row.cumulate_user - cumulative[index - 1].cumulate_user);

  const readsByDate = Object.create(null);
  for (const article of articleList) readsByDate[article.ref_date] = (readsByDate[article.ref_date] || 0) + Number(article.int_page_read_count || 0);
  const read = cumulative.map((row) => readsByDate[row.ref_date] ?? null);

  const channelTotals = { session: 0, feed: 0, friends: 0, other: 0 };
  for (const article of articleList) {
    channelTotals.session += Number(article.int_page_from_session_read_count || 0);
    channelTotals.feed += Number(article.int_page_from_feed_read_count || 0);
    channelTotals.friends += Number(article.int_page_from_friends_read_count || 0);
    channelTotals.other += Number(article.int_page_from_other_read_count || 0);
  }
  const total = Object.values(channelTotals).reduce((sum, value) => sum + value, 0) || 1;
  const channels = [
    ['公众号会话', channelTotals.session], ['朋友圈', channelTotals.feed],
    ['好友分享', channelTotals.friends], ['其他', channelTotals.other]
  ].map(([name, value]) => ({ name, percent: Math.round(value / total * 100) }));

  const byTitle = new Map();
  for (const article of articleList) {
    const key = article.title || article.msgid || '未命名';
    const current = byTitle.get(key) || { title: article.title || '未命名', reads: 0 };
    current.reads += Number(article.int_page_read_count || 0);
    byTitle.set(key, current);
  }
  const top = [...byTitle.values()].sort((a, b) => b.reads - a.reads).slice(0, 5)
    .map((article) => ({ title: article.title, reads: fmtNum(article.reads) }));
  const shares = articleList.reduce((sum, article) => sum + Number(article.share_count || 0), 0);

  return {
    source: 'wechat', updatedAt: new Date().toISOString(),
    kpis: { cumulate: fmtNum(latest), netToday: fmtNum(newUser - cancelled), newUser: fmtNum(newUser), shares: fmtNum(shares) },
    chart: { labels, read, follow }, channels, top
  };
}

function substitutePath(template, params) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, key) => {
    if (!Object.hasOwn(params, key)) throw new Error(`缺少路径参数: ${key}`);
    return encodeURIComponent(String(params[key]));
  });
}

function endpointUrl(endpoint, params) {
  const base = new URL(CONN.baseUrl);
  const basePath = base.pathname.endsWith('/') ? base.pathname : base.pathname + '/';
  const substituted = substitutePath(endpoint.path, params).replace(/^\/+/, '');
  const url = new URL(substituted, new URL(basePath, base.origin));
  if (url.origin !== base.origin) throw new Error('endpoint 不得改变上游来源');
  return url;
}

const responseCache = new Map();
async function proxyRest(endpointId, params) {
  const endpoint = (CONN.endpoints || []).find((item) => item.id === endpointId);
  if (!endpoint) throw new Error('未知 endpoint');
  const allParams = { ...(SPEC.params || {}), ...params };
  const url = endpointUrl(endpoint, allParams);
  const auth = CONN.auth || null;
  const headers = { ...(CONN.headers || {}) };
  const secret = auth?.env ? process.env[auth.env] || '' : '';
  if (auth && !secret) throw new Error(`未配置环境变量: ${auth.env}`);
  if (auth?.mode === 'bearer' && secret) headers[auth.header || 'Authorization'] = 'Bearer ' + secret;
  else if (auth?.mode === 'header' && secret) headers[auth.header || 'X-API-Key'] = secret;
  else if (auth?.mode === 'query' && secret) url.searchParams.set(auth.queryParam || 'api_key', secret);

  const cacheKey = endpointId + ':' + url.href;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const { response, body } = await safeFetch(url, { method: 'GET', headers });
  const contentType = response.headers.get('content-type') || '';
  let value;
  if (contentType.includes('json')) {
    try { value = JSON.parse(body.toString('utf8')); }
    catch { throw new Error('上游返回了无效 JSON'); }
  } else {
    value = { value: body.toString('utf8') };
  }
  const ttl = Math.max(0, Math.min(86400, Number(endpoint.cacheTtl || 0)));
  if (ttl) responseCache.set(cacheKey, { value, expiresAt: Date.now() + ttl * 1000 });
  return value;
}

function serveStatic(requestPath, res) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); }
  catch { return send(res, 400, { error: 'malformed_path' }); }
  let relative = decoded.replace(/^\/+/, '');
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  for (const root of [DIST, PUBLIC]) {
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': (MIME[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8'
      });
      return fs.createReadStream(file).pipe(res);
    }
  }
  const index = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(index)) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(index).pipe(res);
  }
  return send(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) return send(res, 405, { error: 'method_not_allowed' }, 'application/json', { Allow: 'GET, HEAD' });
    if (url.pathname === '/spec.json') return send(res, 200, PUBLIC_SPEC);
    if (url.pathname.startsWith('/api/connector/')) {
      const endpoint = url.pathname.slice('/api/connector/'.length);
      if (CONN.type === 'wechat-mp') {
        if (endpoint === 'overview') return send(res, 200, await wechatOverview());
        if (endpoint === 'status') return send(res, 200, {
          connected: Boolean(process.env[CONN.appidEnv] && process.env[CONN.secretEnv]),
          type: 'wechat-mp', account: CONN.account
        });
        if (endpoint === 'connect') return send(res, 200, { ok: Boolean(await wxToken()), account: CONN.account });
        return send(res, 404, { error: 'unknown_endpoint' });
      }
      return send(res, 200, await proxyRest(endpoint, Object.fromEntries(url.searchParams)));
    }
    return serveStatic(url.pathname, res);
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '上游请求超时' : String(error?.message || error);
    return send(res, 502, { error: message.slice(0, 240) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`工作台已启动: http://${HOST}:${PORT}  (连接器: ${CONN.type})`);
});
