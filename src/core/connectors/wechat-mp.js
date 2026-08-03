// 微信公众号连接器元数据（实现见模板 server.mjs，生成项目自带，零依赖）。
export const meta = {
  id: 'wechat-mp',
  label: '微信公众号',
  description: '需 AppID + AppSecret，服务端自动换取 access_token（带缓存）并调用 datacube 用户累计/净增与图文统计接口，输出归一化数据。',
  auth: { modes: ['appsecret'], appidEnv: 'WECHAT_APPID', secretEnv: 'WECHAT_SECRET' },
  endpoints: ['overview', 'status', 'connect'],
  sample: {
    type: 'wechat-mp',
    appidEnv: 'WECHAT_APPID',
    secretEnv: 'WECHAT_SECRET',
    account: '公众号名称'
  }
};
