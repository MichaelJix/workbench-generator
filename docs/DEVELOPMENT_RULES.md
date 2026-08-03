# 开发规则

## 代码规则

1. 只使用 ESM；Node.js 最低版本为 24。
2. 业务函数不得直接读取 `process.env`，配置通过构造参数注入。
3. HTTP 和 MCP 层不得直接执行 SQL、拼接上游 URL或处理密钥。
4. 所有可预期失败使用 `AppError` 和稳定错误码；不得依赖错误文本做程序判断。
5. 所有 JSON 输入必须有 Zod schema 和大小上限。
6. 跨表或“读取后写入”的数据库操作必须使用事务或单条条件更新；所有表使用外键。
7. 时间统一保存为 UTC ISO 8601，测试通过注入 clock 保持确定性。
8. token 只保存不可逆摘要；可恢复凭据必须经 AES-256-GCM 加密。
9. 任何外部写操作必须经过 `pending → approved → executing → executed|failed` 状态机；审批票据必须在副作用前原子消费。
10. 新增连接器必须实现统一适配器并附契约测试。

## API 规则

- 成功：`{ "ok": true, "data": ... }`。
- 失败：`{ "ok": false, "error": { "code", "message", "details?" } }`。
- 创建返回 201；输入错误 400；未认证 401；无权限 403；不存在 404；冲突 409。
- 所有列表接口必须有明确上限；v1 默认最多 100 条。
- 远程请求必须校验 Origin、Bearer token、JSON content type 和请求体上限。

## Git 与发布规则

- 变更必须包含测试；缺陷修复先增加失败测试。
- `main` 必须通过 Node 24 测试、全局测试、依赖审计和打包预览。
- 禁止提交数据库、`.env`、token、OAuth 凭据、日志和 `node_modules`。
- Spec 破坏性变更必须增加迁移器并提升 `specVersion`。
