import { getPath, fmtNum, esc, badge, srcBadge } from './components.js';

// 折线图（面积 + 虚线双序列，支持 null 缺口）
export function chartSVG(read, follow) {
  const W = 640, H = 220, pad = 16;
  const r = (read || []).filter((v) => v != null);
  const f = (follow || []).filter((v) => v != null);
  const all = r.concat(f);
  if (!all.length) return '<div class="chart-empty">暂无数据</div>';
  const min = Math.min(...all), max = Math.max(...all); const span = (max - min) || 1;
  const n = Math.max((read || []).length, (follow || []).length) || 1;
  const x = (i) => pad + (i / (n - 1 || 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = (arr) => {
    let drawing = false;
    return (arr || []).map((v, i) => {
      if (v == null) { drawing = false; return ''; }
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    }).filter(Boolean).join(' ');
  };
  const rl = line(read), fl = line(follow);
  const area = rl ? `${rl} L${x((read || []).length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z` : '';
  const pts = (arr, color) => (arr || []).map((v, i) => v == null ? '' : `<circle class="chart-pt" data-idx="${i}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${color}"/>`).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--brand)" stop-opacity="0.22"/><stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#E5E8EB"/>
    ${area ? `<path d="${area}" fill="url(#ag)"/>` : ''}
    ${rl ? `<path d="${rl}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${fl ? `<path d="${fl}" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${pts(read, 'var(--brand)')}${pts(follow, '#3B82F6')}
  </svg>`;
}

export function renderWidget(w, data) {
  switch (w.type) {
    case 'kpi': return kpi(w, data);
    case 'lineChart': return lineChart(w, data);
    case 'list': return listW(w, data);
    case 'table': return tableW(w, data);
    case 'text': return `<div class="card"><p>${esc(w.text || '')}</p></div>`;
    default: return `<div class="card empty">未知组件：${esc(w.type)}</div>`;
  }
}

function kpi(w, data) {
  const v = data && data.error ? '—' : getPath(data, w.field);
  const val = (typeof v === 'number') ? fmtNum(v) : esc(v == null ? '—' : v);
  const trend = w.trend ? `<span class="kpi-trend">${esc(w.trend)}</span>` : '';
  return `<div class="card kpi"><div class="kpi-label">${esc(w.label || '')}</div><div class="kpi-value">${val}</div>${trend}</div>`;
}

function lineChart(w, data) {
  let labels = [], read = [], follow = [];
  if (w.mode === 'parallel') {
    const base = getPath(data, w.parallel.base || '');
    labels = getPath(base, w.parallel.labels) || [];
    for (const [name, field] of Object.entries(w.parallel.series || {})) {
      const arr = getPath(base, field) || [];
      if (name === 'read') read = arr; else if (name === 'follow') follow = arr;
    }
  } else {
    const arr = getPath(data, w.arrayField) || (Array.isArray(data) ? data : []);
    labels = arr.map((it) => getPath(it, w.xField));
    const s = (w.series || [])[0] || {};
    read = arr.map((it) => getPath(it, s.field));
  }
  const legend = w.mode === 'parallel'
    ? Object.keys(w.parallel.series).map((nm) => `<span><i class="lg ${nm}"></i>${esc(nm)}</span>`).join('')
    : `<span><i class="lg read"></i>${esc((w.series && w.series[0] && w.series[0].name) || '数值')}</span>`;
  return `<div class="card chart-card">
    <div class="chart-head"><span class="chart-title">${esc(w.title || '趋势')}</span><span class="legend">${legend}</span>${srcBadge(data)}</div>
    ${chartSVG(read, follow, labels)}
  </div>`;
}

function listW(w, data) {
  const arr = getPath(data, w.arrayField) || (Array.isArray(data) ? data : []);
  const items = arr.slice(0, w.limit || 20).map((it) =>
    `<li><div class="li-main">${esc(getPath(it, w.titleField) || '')}</div>${w.subField ? `<div class="li-sub">${esc(getPath(it, w.subField) || '')}</div>` : ''}</li>`
  ).join('');
  return `<div class="card"><div class="chart-title">${esc(w.title || '列表')}</div><ul class="li">${items || '<li class="muted">暂无数据</li>'}</ul></div>`;
}

function tableW(w, data) {
  const arr = getPath(data, w.arrayField) || (Array.isArray(data) ? data : []);
  const head = (w.columns || []).map((c) => `<th>${esc(c.title)}</th>`).join('');
  const rows = arr.slice(0, w.limit || 50).map((it) =>
    `<tr>${(w.columns || []).map((c) => `<td>${esc(getPath(it, c.field) ?? '')}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="card"><div class="chart-title">${esc(w.title || '表格')}</div><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows || '<tr><td class="muted">暂无数据</td></tr>'}</tbody></table></div>`;
}
