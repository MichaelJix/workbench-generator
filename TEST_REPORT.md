# 自托管 v1.0 测试文档与结果

日期：2026-08-03  
运行时：Node.js 24.14.0  
测试框架：`node:test` + 官方 MCP SDK client

## 测试目标

验证 Spec 与连接器正确性、密钥处理、租户隔离、持久化、版本不可变性、审批状态机、并发防重放、OAuth PKCE、HTTP 权限边界、两种 MCP 传输，以及 npm 发布物在干净目录中的可安装与可运行性。

## 自动化测试分层

| 层级 | 数量 | 主要覆盖 | 结果 |
|---|---:|---|---|
| 单元 | 8 | Spec 迁移/拒绝、错误映射、密码、AES-GCM、REST adapter、registry | 8/8 通过 |
| 集成 | 5 | 登录、访谈、租户隔离、版本/回滚、action、防并发重放、SQLite 重开、OAuth | 5/5 通过 |
| 全局 | 2 | 真实 HTTP socket、bootstrap、scope、严格输入、审计、Streamable HTTP MCP、Origin | 2/2 通过 |
| 回归 | 12 | 组件字段、生成服务、目录安全、预设 URL、访谈、stdio MCP、三个示例、密钥拒绝 | 12/12 通过 |
| 合计 | 27 | 全部自动化案例 | 27/27 通过 |

## 关键测试案例

| 场景 | 期望 |
|---|---|
| 无 `specVersion` 的旧 Spec | 不修改原对象，确定性迁移到 v1 |
| 未来 Spec 版本/HTTP base URL/明文 secret header | 校验失败 |
| REST base URL 含 `/v1`，path 含参数 | 保留 base path，参数百分号编码 |
| 用户 B 读取用户 A 的工作台 | `NOT_FOUND` |
| 修改后回滚到 v1 | 创建 v3，精确恢复已删除字段 |
| 未审批 action 执行 | `APPROVAL_REQUIRED` |
| 相同票据并发执行两次 | 仅一次进入 executor，另一次 `TOKEN_REUSED` |
| 数据库关闭并重开 | 原 token 仍可认证，工作台仍存在 |
| OAuth state 再次使用 | `UNAUTHENTICATED`；已保存 token 可正确解密 |
| 只读 scope 创建访谈 | HTTP 403 |
| API 请求包含未知字段 | HTTP 400 `INVALID_INPUT` |
| 非允许 Origin 调用 `/mcp` | HTTP 403 |
| 远程 MCP 工具列表 | 含状态工具，不含文件系统工具 |
| 输出目录逃逸/符号链接/隐式覆盖 | 被拒绝 |
| 生成工作台 `/spec.json` | 可启动，且仅暴露脱敏 Spec |

## 发布物验证

| 检查 | 结果 |
|---|---|
| `npm run check` | 通过 |
| `npm test` | 27/27 通过 |
| `npm audit --omit=dev` | 0 个已知漏洞 |
| `npm pack --dry-run` | 仅包含白名单源码、文档、示例与部署文件 |
| tarball 干净目录安装 | 通过 |
| 安装后主 CLI `--help` | 通过 |
| 安装后生成示例并启动服务 | 通过，`/spec.json` 可访问 |
| 安装后 stdio MCP 握手 | 通过，6 个本地工具，`build_spec` 返回 Spec v1 |
| 安装后自托管服务 | 通过，`/health` 与首次 bootstrap 正常 |
| Docker build | 未执行：当前验证环境没有 Docker CLI |

## 手工/部署验收步骤

1. 使用随机主密钥启动服务，确认 `/health`。
2. 首次初始化管理员，确认第二次 bootstrap 返回 409。
3. 创建普通用户，验证不同用户看不到对方工作台。
4. 完成 GitHub/自定义 REST 访谈，在 UI 预览、编辑并检查版本递增。
5. 使用测试上游定义 action，确认申请、批准、执行与审计；确认旧票据不能重放。
6. 配置实际 OAuth provider，在测试租户完成授权、回调、重连和撤销。
7. 通过正式反向代理连接 `/mcp`，验证允许/拒绝 Origin、TLS 和限流策略。
8. 备份数据库与主密钥，恢复到新实例并验证 OAuth 凭据可解密。

## 未覆盖的外部条件

自动测试不使用真实 GitHub、Shopify、Stripe、微信或 OAuth 账号，不进行公网压力测试、浏览器兼容矩阵或渗透测试。这些验证依赖部署方域名、凭据、网络边界和合规要求，必须在正式上线前单独完成。
