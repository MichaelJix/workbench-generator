# v1.0 发布清单

状态：`[x]` 已实现，`[~]` 需要部署者完成，`[ ]` 未验证。

## 代码与数据

- [x] Spec v1 与 v0 自动迁移。
- [x] 统一连接器 registry/adapter。
- [x] SQLite 用户、token、访谈、版本、审批、OAuth 与审计持久化。
- [x] 多用户资源隔离和 scope 授权。
- [x] 修订、完整替换、历史版本与回滚即新版本。
- [x] 管理 UI 支持初始化/登录、访谈、选项输入、预览与编辑。

## 安全

- [x] 密码 scrypt；API token 只存摘要；OAuth token AES-256-GCM。
- [x] OAuth 授权码 + PKCE 与一次性 state。
- [x] 写操作申请、审批、原子票据消费、防并发重放与审计。
- [x] HTTPS/SSRF/超时/响应大小/写重定向防护。
- [x] 远程 MCP Bearer 认证、scope、Origin 校验和文件系统工具隔离。
- [x] CSP、frame 禁止、1 MB JSON 请求上限、错误信息隐藏。
- [~] 部署 HTTPS、反向代理限流、出口 allowlist、备份与密钥轮换。

## 接口与发布工程

- [x] stdio 与 Streamable HTTP MCP。
- [x] HTTP API、健康检查、Dockerfile、Compose、CI。
- [x] `.gitignore`、`.npmignore`、npm `files` 白名单。
- [x] 开发计划、架构、规则、API、测试、安全和连接器文档。
- [ ] 发布者填写 `repository`/`bugs`/`homepage` 后执行正式 `npm publish`。

## 自动验证

- [x] JavaScript 语法检查。
- [x] 单元、集成、全局与回归测试。
- [x] stdio MCP 握手与工具调用。
- [x] Streamable HTTP MCP 真实 socket 握手、认证与 Origin 拒绝。
- [x] npm 生产依赖审计。
- [x] npm 打包预览与 tarball 安装验证。
- [ ] 真实第三方凭据集成（由部署者在隔离环境执行）。
- [ ] 公网 TLS/反向代理压力与渗透测试（部署相关）。
