# 自托管 HTTP API

成功响应为 `{ "ok": true, "data": ... }`，失败响应为 `{ "ok": false, "error": { "code", "message", "details?" } }`。除健康检查、首次初始化和 OAuth 回调外，API 均要求 `Authorization: Bearer <token>`。

| 方法与路径 | Scope | 用途 |
|---|---|---|
| `GET /health` | 公开 | 健康与版本 |
| `POST /api/bootstrap` | 仅首次 | 创建首个管理员与 token |
| `POST /api/login` | 公开 | 密码登录并签发 24 小时 token |
| `GET /api/me` | 已认证 | 当前用户与 scopes |
| `POST /api/users` | `admin` | 创建用户与初始 token |
| `POST /api/interviews` | `workbench:write` | 创建访谈 |
| `POST /api/interviews/:id/answers` | `workbench:write` | 合并答案 |
| `POST /api/interviews/:id/finalize` | `workbench:write` | 生成并保存工作台 |
| `GET /api/workbenches` | `workbench:read` | 当前用户工作台列表 |
| `POST /api/workbenches` | `workbench:write` | 从完整 Spec 创建 |
| `GET /api/workbenches/:id` | `workbench:read` | 当前版本与 Spec |
| `PATCH /api/workbenches/:id` | `workbench:write` | JSON Merge Patch 新版本 |
| `PUT /api/workbenches/:id` | `workbench:write` | 完整替换为新版本 |
| `GET /api/workbenches/:id/versions` | `workbench:read` | 版本元数据 |
| `POST /api/workbenches/:id/rollback` | `workbench:write` | 精确恢复旧 Spec，并创建新版本 |
| `POST /api/actions` | `action:request` | 创建待审批写操作 |
| `POST /api/actions/:id/approve` | `action:approve` | 返回一次性票据 |
| `POST /api/actions/:id/reject` | `action:approve` | 拒绝操作 |
| `POST /api/actions/:id/execute` | `action:approve` | 原子消费票据并执行 |
| `POST /api/oauth/:provider/start` | `workbench:write` | 创建 PKCE 授权 URL |
| `GET /oauth/:provider/callback` | state | 交换并加密保存凭据 |
| `GET /api/audit?limit=100` | `admin` | 最近审计记录，最多 100 条 |
| `POST /mcp` | 已认证 | 无状态 Streamable HTTP MCP |

请求体上限为 1 MB，必须使用 `Content-Type: application/json`。资源 ID 始终绑定当前用户；不存在和他人资源均返回 `NOT_FOUND`，避免资源枚举。

## 写操作状态机

`pending → approved → executing → executed|failed`，或 `pending → rejected`。批准票据只返回一次；`executing` 在外部请求之前通过 SQLite 条件更新获得，因此并发执行只有一个请求能消费票据。

## PATCH 与 PUT

- `PATCH` 请求：`{ "patch": { ... }, "note": "..." }`，遵循 JSON Merge Patch 语义，数组整体替换，`null` 删除字段。
- `PUT` 请求：`{ "spec": { ... }, "note": "..." }`，完整替换当前 Spec，适合管理 UI 编辑。
- 两者都不会修改历史版本；回滚同样创建递增的新版本。
