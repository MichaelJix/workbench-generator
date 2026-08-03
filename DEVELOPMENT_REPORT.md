# 自托管 v1.0 开发分析报告

日期：2026-08-03

## 结论

项目已从本地工作台生成器扩展为可部署的单节点自托管平台，并保留原有 CLI/stdio 生成能力。v1.0 的核心完成标准——持久化、多用户、版本、审批写操作、OAuth、远程 MCP、管理 UI、部署与分层测试——均已实现。适合继续二次开发、内部部署和开源发布；正式公网生产部署仍需由部署者补充 TLS、反向代理限流、出口策略与真实第三方集成验证。

## 主要开发结果

| 领域 | 实现 |
|---|---|
| Spec | `specVersion: 1`、v0→v1 迁移、严格 Zod schema、引用完整性、action 定义 |
| 连接器 | registry/adapter 接口、REST 与微信适配器、base path 安全组合、延迟注入密钥 |
| 错误 | 稳定 `AppError` 错误码、HTTP 状态映射、未知内部错误隐藏 |
| 数据 | Node 内置 SQLite、WAL、外键、busy timeout、用户/令牌/访谈/版本/action/OAuth/审计表 |
| 认证授权 | scrypt 密码、随机 Bearer token、仅存 token 摘要、scope 在 HTTP/MCP 层执行 |
| 访谈 | 会话持久化、答案白名单、collecting/ready/completed 状态、完成后创建工作台 |
| 版本 | 初始版本、Merge Patch、完整替换、历史列表、回滚即新版本、租户隔离 |
| 写操作 | 输入白名单、申请/批准/拒绝、一次性票据、原子 claim、防并发重放、全程审计 |
| OAuth | 授权码 + PKCE S256、一次性 state、token endpoint SSRF 防护、AES-256-GCM 凭据 |
| MCP | 本地 stdio 与无状态 Streamable HTTP；远程模式不注册文件系统工具 |
| HTTP/UI | 严格请求 schema、1 MB 上限、管理初始化/登录/访谈/预览/Spec 编辑/版本保存 |
| 发布 | Node 24、Dockerfile、Compose、健康检查、CI、环境模板、npm 白名单与 MIT 许可 |

## 关键修复与设计决策

1. 工作台回滚不是移动版本指针，而是精确复制目标 Spec 并创建递增版本，历史保持不可变。
2. action 票据在调用上游前通过 SQLite 条件更新从 `approved` 切换为 `executing`，避免两个并发请求都产生副作用。
3. 远程 MCP 每个请求都重新认证，校验 Origin，并禁用 `scaffold_workbench`/`build_workbench`，避免把服务器文件系统能力暴露给远程用户。
4. API token 不作为第三方凭据透传；第三方密钥只在适配器执行阶段从环境变量或加密凭据读取。
5. 管理 UI 不使用 `innerHTML` 渲染用户数据，登录 token 只保存在 `sessionStorage`，关闭标签页后清除。
6. 所有 API JSON 请求经过严格 Zod schema；未知字段被拒绝，领域层仍执行所有权与状态校验。

## 目录职责

- `src/core/`：Spec、迁移、访谈推导、生成器、连接器契约。
- `src/services/`：认证、访谈、工作台版本、审批动作、OAuth 领域服务。
- `src/storage/`：SQLite schema 与参数化查询。
- `src/security/`：密码/加密/摘要与出站请求安全。
- `src/server/`：HTTP API、MCP transport 接入与管理 UI。
- `src/mcp/`：MCP 工具注册和 stdio 入口。
- `test/unit|integration|global/`：分层测试；`test/*.test.js` 为原有回归测试。

## 仍需部署者完成

- 配置真实 `repository`、`bugs`、`homepage` 元数据后再执行 npm 正式发布。
- 使用真实域名、HTTPS 反向代理、限流、出口 allowlist 和独立 secret 管理器。
- 为计划接入的每个 OAuth/API provider 创建最小权限应用，并在隔离环境做真实凭据验收。
- 制定 SQLite 在线备份、主密钥异地备份、恢复演练和升级窗口。
- 高风险或大规模场景增加外部身份提供商、集中 KMS、分布式数据层和专业渗透测试。

## 已知产品边界

- v1.0 是单节点、小团队自托管版本，不是多节点 SaaS；没有组织 SSO、计费或分布式会话。
- Node 24 的 `node:sqlite` 在当前运行时仍会输出 ExperimentalWarning，但测试与发布目标已固定为 Node 24。
- 通用 OAuth 服务覆盖标准授权码 + PKCE；非标准 provider 需要适配器。
- 没有在本验证环境执行 Docker build（Docker CLI 不可用），Docker 定义已进行静态检查并纳入 CI/部署文档。
