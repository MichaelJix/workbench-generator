import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError, ErrorCode } from '../core/errors.js';

const MAX_BYTES = 5 * 1024 * 1024;

function blockedIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
      || /^fe[89ab]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8:') || value.includes('::ffff:');
  }
  return true;
}

export async function assertPublicUrl(url, { allowPrivate = false } = {}) {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== 'https:' && !(allowPrivate && parsed.protocol === 'http:')) {
    throw new AppError(ErrorCode.INVALID_INPUT, '上游 URL 必须使用 HTTPS');
  }
  if (allowPrivate) return parsed;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address))) {
    throw new AppError(ErrorCode.FORBIDDEN, '上游地址指向内网、环回或保留网络');
  }
  return parsed;
}

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new AppError(ErrorCode.UPSTREAM_FAILED, '上游响应超过 5 MB');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new AppError(ErrorCode.UPSTREAM_FAILED, '上游响应超过 5 MB');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function executeOutbound(request, { allowPrivate = false } = {}) {
  const url = await assertPublicUrl(request.url, { allowPrivate });
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) throw new AppError(ErrorCode.UPSTREAM_FAILED, '写操作不允许重定向');
  const body = await readLimited(response);
  if (!response.ok) throw new AppError(ErrorCode.UPSTREAM_FAILED, `上游返回 HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json')) {
    try { return { status: response.status, data: JSON.parse(body.toString('utf8')) }; }
    catch { throw new AppError(ErrorCode.UPSTREAM_FAILED, '上游返回无效 JSON'); }
  }
  return { status: response.status, data: body.toString('utf8') };
}
