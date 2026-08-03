// 通用 REST + API Key 连接器元数据（实现见模板 server.mjs，生成项目自带，零依赖）。
export const meta = {
  id: 'rest-apikey',
  label: '通用 REST + API Key',
  description: '适用于大多数 SaaS / 开放 API。支持无鉴权、Bearer Token、自定义请求头或查询参数鉴权。路径支持 {param} 占位符。',
  auth: { modes: ['none', 'bearer', 'header', 'query'], secretEnv: 'API_KEY', headerName: 'Authorization' },
  endpointFields: ['path', 'method', 'cacheTtl'],
  sample: {
    type: 'rest-apikey',
    baseUrl: 'https://api.github.com',
    auth: { mode: 'bearer', env: 'GITHUB_TOKEN', header: 'Authorization' },
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'workbench' },
    endpoints: [{ id: 'repo', path: '/repos/{owner}/{repo}', method: 'GET' }]
  }
};
