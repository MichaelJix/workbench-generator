import { parseSpec } from './spec.js';

const PRESETS = {
  github: {
    label: 'GitHub', brand: '#181717', baseUrl: 'https://api.github.com',
    endpoints: [
      { id: 'repo', path: '/repos/{owner}/{repo}', method: 'GET' },
      { id: 'traffic', path: '/repos/{owner}/{repo}/traffic/views', method: 'GET' }
    ],
    sampleKpis: [
      { label: 'Stars', field: 'stargazers_count' },
      { label: 'Forks', field: 'forks_count' },
      { label: 'Open Issues', field: 'open_issues_count' }
    ],
    authEnv: 'GITHUB_TOKEN'
  },
  shopify: {
    label: 'Shopify', brand: '#95BF47',
    endpoints: [
      { id: 'shop', path: '/shop.json', method: 'GET' },
      { id: 'orders', path: '/orders.json?status=any', method: 'GET' }
    ],
    sampleKpis: [
      { label: '店铺名', field: 'shop.name' },
      { label: '主域名', field: 'shop.domain' }
    ],
    authEnv: 'SHOPIFY_TOKEN'
  },
  stripe: {
    label: 'Stripe', brand: '#635BFF', baseUrl: 'https://api.stripe.com/v1',
    endpoints: [
      { id: 'balance', path: '/balance', method: 'GET' },
      { id: 'charges', path: '/charges?limit=10', method: 'GET' }
    ],
    sampleKpis: [
      { label: '可用余额（最小货币单位）', field: 'available.0.amount' },
      { label: '待结算（最小货币单位）', field: 'pending.0.amount' }
    ],
    authEnv: 'STRIPE_SECRET'
  },
  custom: {
    label: '自定义 REST API', brand: '#2F80ED', baseUrl: '', endpoints: [],
    sampleKpis: [], authEnv: 'API_TOKEN'
  },
  wechat: {
    label: '微信公众号', brand: '#07C160', authEnv: 'WECHAT_SECRET'
  }
};

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'workbench';
}

function humanize(field) {
  return String(field).split(/[._]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function guessPlatform(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/微信|wechat|公众号|mp\b/.test(p)) return 'wechat';
  if (/github|仓库|repo|star|星标/.test(p)) return 'github';
  if (/shopify|shop|电商|商品|订单|店铺/.test(p)) return 'shopify';
  if (/stripe|支付|收款|账单/.test(p)) return 'stripe';
  return 'custom';
}

function authBlock(mode, env) {
  if (mode === 'bearer') return { mode: 'bearer', env, header: 'Authorization' };
  if (mode === 'header') return { mode: 'header', env, header: 'X-API-Key' };
  if (mode === 'query') return { mode: 'query', env, queryParam: 'api_key' };
  return null;
}

export function introspectSample(jsonValue) {
  const source = typeof jsonValue === 'string' ? jsonValue : JSON.stringify(jsonValue);
  if (source.length > 1_000_000) return { error: 'JSON 样本不能超过 1 MB' };
  let data;
  try { data = JSON.parse(source); } catch { return { error: 'JSON 解析失败，请检查格式' }; }

  const scalars = [];
  const arrays = [];
  let visited = 0;
  const walk = (obj, prefix, depth) => {
    if (++visited > 5000 || depth > 12) return;
    if (Array.isArray(obj)) {
      arrays.push({ path: prefix || '', len: obj.length, sample: obj[0] });
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) walk(obj[key], prefix ? prefix + '.' + key : key, depth + 1);
    } else if (prefix) {
      scalars.push({ path: prefix, type: obj === null ? 'null' : typeof obj, value: obj });
    }
  };
  walk(data, '', 0);
  return { scalars, arrays, truncated: visited > 5000 };
}

export function analyzePrompt(prompt) {
  const platform = guessPlatform(prompt);
  const preset = PRESETS[platform];
  const questions = [];

  if (platform === 'wechat') {
    questions.push({ id: 'account', q: '这个公众号叫什么名字？', type: 'text', hint: '仅用于工作台标题' });
    questions.push({
      id: 'focus', q: '最想看哪些运营数据？', type: 'choice', multi: true,
      options: ['粉丝增长', '图文阅读', '分享传播'], default: ['粉丝增长', '图文阅读']
    });
  } else {
    if (platform === 'github') {
      questions.push({ id: 'repository', q: '要查看哪个仓库？', type: 'text', hint: '例如 facebook/react' });
    } else if (platform === 'shopify') {
      questions.push({ id: 'shop', q: 'Shopify 店铺子域名是什么？', type: 'text', hint: '例如 your-store，不含 .myshopify.com' });
    } else if (platform === 'custom') {
      questions.push({ id: 'baseUrl', q: '你的 HTTPS API 根地址是？', type: 'text', hint: '例如 https://api.example.com/v1' });
      questions.push({ id: 'dataPath', q: '主接口路径是？', type: 'text', hint: '例如 /metrics' });
    }
    questions.push({
      id: 'auth', q: '接口怎么鉴权？', type: 'choice',
      options: [
        { value: 'bearer', label: 'Bearer Token' },
        { value: 'header', label: '自定义请求头 API Key' },
        { value: 'query', label: 'URL 参数 API Key' },
        { value: 'none', label: '无需鉴权' }
      ], default: 'bearer'
    });
    questions.push({
      id: 'sample', q: '请粘贴主接口返回的示例 JSON（可留空）。', type: 'text',
      hint: '{"value":123,"items":[{"name":"A"}]}'
    });
  }

  return {
    platform,
    intent: String(prompt || ''),
    presetLabel: preset.label,
    draftSpec: draftSpec(prompt, platform, preset),
    questions
  };
}

function draftSpec(prompt, platform, preset) {
  if (platform === 'wechat') {
    return {
      name: '公众号运营工作台',
      connector: { type: 'wechat-mp', appidEnv: 'WECHAT_APPID', secretEnv: preset.authEnv },
      pages: [{ id: 'home', title: '概览', widgets: ['KPI', '趋势', '文章', '渠道'] }]
    };
  }
  return {
    name: String(prompt || '') + ' 工作台',
    connector: { type: 'rest-apikey', baseUrl: preset.baseUrl || '(待填写)', auth: '(待选择)' },
    pages: [{ id: 'home', title: '概览', widgets: ['KPI', '明细'] }]
  };
}

function restLocation(platform, preset, answers) {
  if (platform === 'shopify') {
    const shop = String(answers.shop || 'your-store').toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!shop) throw new Error('Shopify 店铺子域名不能为空');
    return {
      baseUrl: `https://${shop}.myshopify.com/admin/api/2026-07`,
      params: {}
    };
  }
  if (platform === 'github') {
    const [owner = 'facebook', repo = 'react'] = String(answers.repository || 'facebook/react').split('/').filter(Boolean);
    return { baseUrl: preset.baseUrl, params: { owner, repo } };
  }
  return { baseUrl: answers.baseUrl || preset.baseUrl, params: {} };
}

export function buildSpec(prompt, answers = {}) {
  const detected = guessPlatform(prompt);
  const platform = Object.hasOwn(PRESETS, answers.platform) ? answers.platform : detected;
  const preset = PRESETS[platform];
  const name = String(answers.name || (platform === 'wechat'
    ? (answers.account ? answers.account + ' 运营工作台' : '公众号运营工作台')
    : (String(prompt || '自定义') + ' 工作台')));

  if (platform === 'wechat') {
    const focus = Array.isArray(answers.focus) ? answers.focus : ['粉丝增长', '图文阅读'];
    const kpis = [
      { type: 'kpi', label: '累计粉丝', endpoint: 'overview', field: 'kpis.cumulate' },
      { type: 'kpi', label: '今日净增', endpoint: 'overview', field: 'kpis.netToday' }
    ];
    if (focus.includes('粉丝增长')) kpis.push({ type: 'kpi', label: '新增关注', endpoint: 'overview', field: 'kpis.newUser' });
    if (focus.includes('分享传播')) kpis.push({ type: 'kpi', label: '分享次数', endpoint: 'overview', field: 'kpis.shares' });
    return parseSpec({
      name, slug: slug(name), theme: { brand: preset.brand },
      connector: { type: 'wechat-mp', appidEnv: 'WECHAT_APPID', secretEnv: preset.authEnv, account: answers.account || preset.label },
      pages: [{ id: 'home', title: '概览', widgets: [
        ...kpis,
        { type: 'lineChart', title: '粉丝与阅读趋势', endpoint: 'overview', mode: 'parallel', parallel: { base: 'chart', labels: 'labels', series: { read: 'read', follow: 'follow' } } },
        { type: 'list', title: '爆款文章 TOP', endpoint: 'overview', arrayField: 'top', titleField: 'title', subField: 'reads' },
        { type: 'table', title: '渠道来源', endpoint: 'overview', arrayField: 'channels', columns: [{ title: '渠道', field: 'name' }, { title: '占比(%)', field: 'percent' }] }
      ] }]
    });
  }

  const location = restLocation(platform, preset, answers);
  const authMode = answers.auth || 'bearer';
  const connector = {
    type: 'rest-apikey',
    baseUrl: location.baseUrl,
    auth: authBlock(authMode, answers.tokenEnv || preset.authEnv),
    headers: { 'User-Agent': 'workbench-generator', Accept: 'application/json' },
    endpoints: preset.endpoints?.length
      ? preset.endpoints
      : [{ id: 'data', path: String(answers.dataPath || '/'), method: 'GET' }]
  };
  const primaryEndpoint = connector.endpoints[0].id;
  const widgets = [];
  if (answers.sample) {
    const intro = introspectSample(answers.sample);
    if (intro.error) throw new Error(intro.error);
    for (const scalar of intro.scalars.slice(0, 6)) {
      widgets.push({ type: 'kpi', label: humanize(scalar.path), endpoint: primaryEndpoint, field: scalar.path });
    }
    const firstArray = intro.arrays[0];
    if (firstArray?.sample && typeof firstArray.sample === 'object' && !Array.isArray(firstArray.sample)) {
      const columns = Object.keys(firstArray.sample).slice(0, 8).map((key) => ({ title: key, field: key }));
      if (columns.length) widgets.push({ type: 'table', title: '明细', endpoint: primaryEndpoint, arrayField: firstArray.path, columns });
    }
  }
  if (!widgets.length) {
    const metrics = String(answers.metrics || '').split(/[，,\n]/).map((v) => v.trim()).filter(Boolean);
    const fallback = metrics.length
      ? metrics.slice(0, 6).map((field) => ({ label: field, field }))
      : preset.sampleKpis;
    for (const metric of fallback) widgets.push({ type: 'kpi', label: metric.label, endpoint: primaryEndpoint, field: metric.field });
  }
  if (!widgets.length) widgets.push({ type: 'kpi', label: '指标', endpoint: primaryEndpoint, field: 'value' });

  return parseSpec({
    name, slug: slug(name), theme: { brand: preset.brand }, connector,
    params: location.params,
    pages: [{ id: 'home', title: '概览', widgets }]
  });
}
