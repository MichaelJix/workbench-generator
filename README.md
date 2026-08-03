# workbench-generator

自托管的 MCP 工作台生成平台。用户描述一句需求并回答少量结构化问题后，系统会生成严格校验、可版本化的工作台 Spec；同一套领域服务同时提供管理 UI、HTTP API、本地 stdio MCP 和远程 Streamable HTTP MCP。

## v1.0 能力

- 一句话访谈、持久化会话、Spec 预览、完整替换、JSON Merge Patch 修订和回滚。
- SQLite 多用户数据隔离、scrypt 密码、摘要化 API token、权限 scope 与审计日志。
- GitHub、Shopify、Stripe、微信公众号、自定义 HTTPS REST 预设。
- 外部写操作必须经过申请、批准和一次性票据；票据在副作用前原子消费，防并发重放。
- OAuth 2.1 风格的授权码 + PKCE 流程；上游 token 通过 AES-256-GCM 加密保存。
- 本地 stdio MCP、带 Bearer 认证及 Origin 校验的无状态 Streamable HTTP MCP。
- Docker Compose、健康检查、管理界面、四层自动化测试和 GitHub Actions CI。
- 仍保留从 Spec 生成零第三方运行时依赖独立工作台的 CLI/MCP 工具。

## 运行要求

- Node.js 24 或更高版本（使用内置 `node:sqlite`）。
- 生产环境需要 HTTPS 反向代理和至少 32 字符的随机主密钥。

## 快速启动

### Docker Compose

```bash
cp .env.example .env
# 将 WORKBENCH_MASTER_KEY 替换为随机值，例如：openssl rand -base64 48
docker compose up --build -d
```

默认只映射到宿主机 `127.0.0.1:3080`。打开 `http://127.0.0.1:3080`，使用“首次初始化管理员”；初始化端点只能成功一次。

### Node.js

```bash
npm ci --omit=dev
export WORKBENCH_MASTER_KEY="replace-with-a-random-secret-at-least-32-characters"
npm run serve
```

也可以先通过 CLI 初始化：

```bash
WORKBENCH_ADMIN_PASSWORD='a-strong-password-at-least-12' \
WORKBENCH_MASTER_KEY='a-random-master-key-at-least-32-characters' \
npx workbench-generator init admin
```

命令会输出只显示一次的 Bearer token，请立即放入密钥管理器，并从环境中移除初始密码。

## MCP 配置

### 本地 stdio（无持久化平台状态）

```json
{
  "mcpServers": {
    "workbench-generator": {
      "command": "npx",
      "args": ["-y", "workbench-generator", "mcp"]
    }
  }
}
```

此模式提供 6 个本地生成工具，并允许在当前工作区生成文件。

### stdio 连接自托管状态

向 MCP 进程设置 `WORKBENCH_TOKEN`、`WORKBENCH_MASTER_KEY`、`WORKBENCH_DATABASE` 后，会额外提供访谈、工作台和审批工具。token 不会传给上游连接器。

### 远程 Streamable HTTP

- URL：`https://your-host.example/mcp`
- Header：`Authorization: Bearer <token>`
- 浏览器来源必须加入 `ALLOWED_ORIGINS`。
- 远程模式不暴露文件系统生成工具。

## 工具

| 类别 | 工具 |
|---|---|
| 无状态设计 | `list_connectors`、`interview_workbench`、`build_spec`、`introspect_sample` |
| 本地文件系统 | `scaffold_workbench`、`build_workbench` |
| 持久化访谈 | `interview_start`、`interview_answer`、`interview_finalize` |
| 工作台 | `workbench_list`、`workbench_get`、`workbench_revise` |
| 审批动作 | `action_request`、`action_approve`、`action_execute` |

所有 JSON 工具同时返回文本 `content` 和机器可读的 `structuredContent.result`。

## 独立工作台生成

```bash
npx workbench-generator interview "做一个 GitHub 仓库星标看板"
npx workbench-generator create ./examples/github-repo.json -o ./my-workbench
cd my-workbench && node server.mjs
```

目标目录非空时默认失败。`--force` 只覆盖生成器管理的文件；路径逃逸、绝对路径和符号链接逃逸均会被拒绝。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `3080` | HTTP 端口 |
| `WORKBENCH_DATABASE` | `./data/workbench.db` | SQLite 文件 |
| `WORKBENCH_MASTER_KEY` | 无 | 必填，至少 32 字符；加密 OAuth 凭据 |
| `ALLOWED_ORIGINS` | 本机两个来源 | 逗号分隔的 MCP 浏览器来源 |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:PORT` | OAuth 回调外部地址 |
| `ALLOW_PRIVATE_UPSTREAM` | `false` | 仅可信内网测试使用 |
| `OAUTH_PROVIDERS_JSON` | `{}` | OAuth provider 配置对象 |

OAuth provider 示例：

```json
{
  "github": {
    "authorizationUrl": "https://github.com/login/oauth/authorize",
    "tokenUrl": "https://github.com/login/oauth/access_token",
    "clientId": "...",
    "clientSecret": "...",
    "scopes": ["read:user"]
  }
}
```

不要把真实配置提交到 Git；生产环境应从编排平台的 secret 注入。

## 备份与升级

停止写入后备份 SQLite 文件及其 `-wal`/`-shm` 文件，或使用 SQLite 在线备份工具。恢复时必须同时恢复原 `WORKBENCH_MASTER_KEY`，否则 OAuth 凭据无法解密。升级前先备份数据卷，并阅读发行说明中的数据库与 Spec 迁移说明。

## 安全边界

- 默认监听本机；公网部署必须由反向代理终止 TLS。
- token 仅保存 SHA-256 摘要，OAuth token 使用 AES-256-GCM；管理 UI 只在当前标签页保存登录 token。
- REST 上游默认仅 HTTPS，执行前解析 DNS 并拒绝私网、环回、链路本地和保留地址；响应上限 5 MB、超时 15 秒、写操作拒绝重定向。
- 写操作输入由 Spec 白名单校验，未批准不能执行，批准票据不可重放。
- `ALLOW_PRIVATE_UPSTREAM=true` 会关闭关键 SSRF 防护，只能用于受控测试环境。

完整威胁模型见 [SECURITY.md](./SECURITY.md)，接口见 [docs/API.md](./docs/API.md)，开发与测试规则见 [docs/DEVELOPMENT_RULES.md](./docs/DEVELOPMENT_RULES.md) 和 [docs/TESTING.md](./docs/TESTING.md)。

## 开发验证

```bash
npm ci
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```

## 许可证

[MIT](./LICENSE)
