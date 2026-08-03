// 通用组件工具
export function getPath(o, p) {
  if (o == null) return o;
  if (!p) return o;
  const tokens = String(p).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return tokens.reduce((a, k) => {
    if (a == null) return undefined;
    return Array.isArray(a) ? a[+k] : a[k];
  }, o);
}
export function fmtNum(n) {
  n = Number(n) || 0; const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (a >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString('zh-CN');
}
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
export function badge(text, kind) {
  return `<span class="badge ${kind || ''}">${esc(text)}</span>`;
}
export function srcBadge(data) {
  if (data && data.source === 'wechat') return badge('实时 · 微信', 'live');
  if (data && data.source === 'demo') return badge('演示数据', 'demo');
  return badge('实时 API', 'live');
}
