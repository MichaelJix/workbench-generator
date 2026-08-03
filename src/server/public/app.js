const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('workbench-token') || '';
let interview;
let selectedWorkbench;
$('token').value = token;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const value = await response.json();
  if (!value.ok) throw new Error(`${value.error.code}: ${value.error.message}`);
  return value.data;
}
const report = (value) => { $('status').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const credentials = () => ({ username: $('username').value.trim(), password: $('password').value });
const saveToken = (value) => { token = value; $('token').value = value; sessionStorage.setItem('workbench-token', value); };

async function authenticate(path) {
  try {
    const result = await api(path, { method: 'POST', body: JSON.stringify(credentials()) });
    saveToken(result.token); report({ user: result.user, expiresAt: result.expiresAt }); await refresh();
  } catch (error) { report(error.message); }
}
$('login').onclick = () => authenticate('/api/login');
$('bootstrap').onclick = () => authenticate('/api/bootstrap');
$('save-token').onclick = () => { saveToken($('token').value.trim()); report('token 仅保存在当前浏览器标签页'); };

function questionControl(question) {
  const label = document.createElement('label'); label.textContent = question.q;
  let input;
  if (question.type === 'choice') {
    input = document.createElement('select');
    input.multiple = Boolean(question.multi);
    for (const option of question.options || []) {
      const value = typeof option === 'string' ? option : option.value;
      const node = document.createElement('option'); node.value = value; node.textContent = typeof option === 'string' ? option : option.label;
      const defaults = Array.isArray(question.default) ? question.default : [question.default]; node.selected = defaults.includes(value); input.appendChild(node);
    }
  } else {
    input = document.createElement('input'); input.placeholder = question.hint || ''; input.value = question.default || '';
  }
  input.dataset.id = question.id; input.dataset.multi = String(Boolean(question.multi)); label.appendChild(input); return label;
}

$('start').onclick = async () => {
  try {
    interview = await api('/api/interviews', { method: 'POST', body: JSON.stringify({ prompt: $('prompt').value }) });
    $('questions').replaceChildren(...interview.questions.map(questionControl));
    const button = document.createElement('button'); button.textContent = '提交答案并生成'; button.onclick = finalize;
    $('questions').appendChild(button); report(interview);
  } catch (error) { report(error.message); }
};
async function finalize() {
  try {
    const controls = [...$('questions').querySelectorAll('input[data-id],select[data-id]')];
    const answers = Object.fromEntries(controls.map((input) => [input.dataset.id,
      input.dataset.multi === 'true' ? [...input.selectedOptions].map((option) => option.value) : input.value]));
    await api(`/api/interviews/${interview.id}/answers`, { method: 'POST', body: JSON.stringify({ answers }) });
    const result = await api(`/api/interviews/${interview.id}/finalize`, { method: 'POST', body: '{}' });
    report(result); await refresh(); await selectWorkbench(result.workbench.id);
  } catch (error) { report(error.message); }
}

function renderPreview(spec) {
  const root = $('preview'); root.replaceChildren();
  const heading = document.createElement('h3'); heading.textContent = spec.name; root.appendChild(heading);
  for (const page of spec.pages) {
    const pageNode = document.createElement('section'); pageNode.className = 'preview-page';
    const title = document.createElement('strong'); title.textContent = page.title; pageNode.appendChild(title);
    const grid = document.createElement('div'); grid.className = 'widget-grid';
    for (const widget of page.widgets) {
      const card = document.createElement('div'); card.className = 'widget';
      const type = document.createElement('small'); type.textContent = widget.type;
      const label = document.createElement('div'); label.textContent = widget.label || widget.title || widget.text || 'Widget';
      card.append(type, label); grid.appendChild(card);
    }
    pageNode.appendChild(grid); root.appendChild(pageNode);
  }
}
async function selectWorkbench(id) {
  try {
    selectedWorkbench = await api(`/api/workbenches/${id}`);
    $('editor').classList.remove('hidden'); $('spec-editor').value = JSON.stringify(selectedWorkbench.spec, null, 2);
    $('revision-note').value = ''; renderPreview(selectedWorkbench.spec); report(selectedWorkbench);
  } catch (error) { report(error.message); }
}
async function refresh() {
  try {
    const items = await api('/api/workbenches');
    $('workbenches').replaceChildren(...items.map((item) => {
      const button = document.createElement('button'); button.className = 'workbench';
      button.textContent = `${item.name} · v${item.currentVersion}`; button.onclick = () => selectWorkbench(item.id); return button;
    }));
  } catch (error) { report(error.message); }
}
$('save-spec').onclick = async () => {
  try {
    if (!selectedWorkbench) throw new Error('请先选择工作台');
    const patch = JSON.parse($('spec-editor').value);
    selectedWorkbench = await api(`/api/workbenches/${selectedWorkbench.id}`, {
      method: 'PUT', body: JSON.stringify({ spec: patch, note: $('revision-note').value || 'admin UI revision' })
    });
    $('spec-editor').value = JSON.stringify(selectedWorkbench.spec, null, 2); renderPreview(selectedWorkbench.spec);
    report(selectedWorkbench); await refresh();
  } catch (error) { report(error.message); }
};
$('refresh').onclick = refresh;
