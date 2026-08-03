import { renderWidget } from './widgets.js';
import { esc } from './components.js';

let SPEC = null;
const cache = new Map();
const $ = (s, r = document) => r.querySelector(s);

async function boot() {
  try { SPEC = await (await fetch('/spec.json')).json(); }
  catch (e) { document.body.innerHTML = '<p style="padding:24px">无法加载 spec.json</p>'; return; }
  if (SPEC.theme && SPEC.theme.brand) document.documentElement.style.setProperty('--brand', SPEC.theme.brand);

  const app = $('#app');
  app.innerHTML = `
    <aside class="nav">
      <div class="nav-brand">${esc(SPEC.name)}</div>
      <nav id="nav"></nav>
      <div class="nav-foot">连接器：${esc(SPEC.connector.type)}</div>
    </aside>
    <main class="content"><div id="page"></div></main>`;

  const nav = $('#nav');
  (SPEC.pages || []).forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'nav-item' + (i === 0 ? ' active' : '');
    b.textContent = p.title;
    b.onclick = () => {
      nav.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      showPage(p);
    };
    nav.appendChild(b);
  });
  if (SPEC.pages && SPEC.pages[0]) showPage(SPEC.pages[0]);
}

async function fetchEp(id, params) {
  const key = id + JSON.stringify(params || {});
  if (cache.has(key)) return cache.get(key);
  const qs = new URLSearchParams(params || {});
  const url = '/api/connector/' + id + (qs.toString() ? '?' + qs : '');
  let j;
  try { const r = await fetch(url); j = await r.json().catch(() => ({ error: 'bad-json' })); }
  catch (e) { j = { error: String(e) }; }
  cache.set(key, j);
  return j;
}

async function showPage(page) {
  const host = $('#page');
  host.innerHTML = page.widgets.map((w, i) =>
    `<section class="card-wrap" data-w="${i}"><div class="card loading">加载中…</div></section>`
  ).join('');
  page.widgets.forEach(async (w, i) => {
    const el = host.querySelector(`[data-w="${i}"]`);
    if (!el) return;
    if (w.type === 'text') {
      el.innerHTML = renderWidget(w, null);
      return;
    }
    const data = await fetchEp(w.endpoint, w.params);
    if (!el.isConnected) return;
    if (data && data.error) { el.innerHTML = `<div class="card empty">接口错误：${esc(String(data.error))}</div>`; return; }
    el.innerHTML = renderWidget(w, data);
  });
}

boot();
