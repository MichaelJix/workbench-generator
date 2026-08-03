# MCP 与连接器开发指南（v1.0）

## 1. 分层约束

MCP factory 只负责输入/输出 schema、能力注解和 scope 检查；访谈、版本、审批与 OAuth 位于 `src/services/`；SQLite 位于 `src/storage/`；连接器请求构造位于 `src/core/connectors/`。不得在 HTTP/MCP handler 中拼接上游 URL、执行 SQL 或读取第三方密钥。

## 2. 两种 MCP 传输

- `src/mcp/server.mjs`：stdio。stdout 只能输出 MCP 帧，日志写 stderr。未设置 `WORKBENCH_TOKEN` 时提供 6 个无状态/文件系统工具；设置后加载自托管数据库并增加状态工具。
- `/mcp`：无状态 Streamable HTTP。每个 POST 都验证 Bearer token 和可选 Origin，且不提供文件系统工具。服务端使用 JSON response 模式，无 session ID。

每个工具必须有有界 Zod 输入、`outputSchema`、`structuredContent.result`、文本 `content` 以及准确的 `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`。业务异常返回 `isError: true` 和稳定错误码。

## 3. Spec 演进

- 当前 `specVersion` 为 1；入口必须经过 `migrateSpec()` 与 `parseSpec()`。
- 破坏性格式变更时，新增单步迁移器 `N -> N+1`，提升 `CURRENT_SPEC_VERSION`，保留旧版本测试夹具。
- 迁移不得修改调用者对象，不得静默删除未知业务数据；无法安全迁移时返回 `UNSUPPORTED_SPEC_VERSION`。
- Spec 只能保存环境变量名称或 OAuth provider 标识，不得保存明文凭据。

## 4. 新增连接器

1. 实现 `ConnectorAdapter`，提供唯一 `meta.id` 与能力描述。
2. 在 `createConnectorRegistry()` 注册；业务服务只通过 registry 查找。
3. 读取能力实现 `buildReadRequest(connector, endpointId, params, env)`。
4. 写能力同时实现 `validateAction()` 和 `buildActionRequest()`；输入只能来自 action 定义的白名单字段。
5. URL 必须由 `URL` API 构造，路径参数逐个编码，密钥在执行阶段从 env/加密凭据注入。
6. 增加契约测试：base path、路径编码、缺失密钥、未知字段、类型错误、SSRF 与响应限制。

REST action Spec 示例：

```json
{
  "id": "update_item",
  "label": "更新项目",
  "path": "/items/{id}",
  "method": "PATCH",
  "confirmation": "确认更新该项目？",
  "input": [
    { "name": "id", "label": "ID", "type": "string", "required": true },
    { "name": "enabled", "label": "启用", "type": "boolean", "required": true }
  ]
}
```

## 5. 外部写操作规则

连接器不得绕过 `ActionService`。标准流程为：

1. `request` 验证 workbench 所有权、action 存在性和输入白名单，创建 `pending`。
2. `approve` 创建随机票据，只存 SHA-256 摘要。
3. `execute` 核对票据后通过条件更新原子切换为 `executing` 并清除摘要。
4. 只有获得执行权的请求才能访问上游，之后写入 `executed` 或 `failed` 与审计记录。

任何重试设计都必须创建新的审批请求，不能复用旧票据。

## 6. OAuth provider

provider 配置最少包含 `authorizationUrl`、`tokenUrl`、`clientId`，可选 `clientSecret`、`scopes`。实现使用授权码、PKCE S256、随机一次性 state、10 分钟 state 有效期、15 秒 token 请求超时和 AES-256-GCM 存储。

非标准 provider（自定义 token 参数、签名、设备码）应实现独立 provider adapter，不要在通用服务堆叠平台条件分支。

## 7. 文件系统生成安全

`scaffold_workbench` 与 `build_workbench` 仅允许当前工作区的相对路径，拒绝 `..`、绝对路径和符号链接逃逸；默认拒绝非空目录；构建只运行生成器内部固定逻辑，不运行目标项目脚本。远程 HTTP MCP 永不注册这两个工具。

## 8. 测试门禁

新增能力至少包含：

- 单元：schema、迁移、适配器、密码/加密、错误映射。
- 集成：真实 SQLite、租户隔离、事务/条件更新、状态机。
- 全局：真实 HTTP socket、认证、Origin、Streamable HTTP 客户端。
- 回归：stdio MCP、生成目录安全、生成应用启动。

发布命令见 `docs/TESTING.md`。禁止测试访问真实第三方账号；使用注入的 executor/fetch 或本地模拟服务。
