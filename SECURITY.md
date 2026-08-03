# Security Policy

## 支持范围

安全修复仅保证应用于最新发布版本。请不要在公开 Issue 中披露未修复漏洞；通过代码仓库的私密漏洞报告渠道提供受影响版本、最小复现、影响范围和缓解建议。

## 威胁模型与控制

| 风险 | 内置控制 | 部署者责任 |
|---|---|---|
| 未认证访问 | Bearer token、摘要存储、过期与撤销字段 | TLS、密钥管理、定期轮换 |
| 跨租户读取 | 所有领域查询绑定 `user_id` | 每人独立账号，勿共享 token |
| SSRF | HTTPS、DNS/IP 检查、私网与保留网段拒绝 | 出口 allowlist、防火墙、DNS 策略 |
| 写操作误触发 | 输入白名单、显式审批、原子消费一次性票据、审计 | 限制 action 定义和上游权限 |
| OAuth token 泄露 | AES-256-GCM、PKCE、一次性 state、无日志输出 | 稳定备份主密钥、限制配置读取 |
| 浏览器攻击 | CSP、禁止 frame、同源静态 UI、sessionStorage | HTTPS、安全响应头和受控 Origin |
| 文件系统逃逸 | 相对工作区边界、符号链接检查、默认拒绝覆盖 | 以低权限用户运行 stdio MCP |

## 重要部署规则

1. 不要直接把 Node HTTP 服务暴露到公网；使用 HTTPS 反向代理。
2. `WORKBENCH_MASTER_KEY` 至少 32 字符，使用密码学随机值并单独备份；泄露后需轮换并重新连接 OAuth。
3. 保持 `ALLOW_PRIVATE_UPSTREAM=false`。启用后，用户可让服务访问内网地址。
4. `ALLOWED_ORIGINS` 只加入实际管理站点；非浏览器 MCP 客户端可以不发送 Origin。
5. 为第三方连接器使用最小权限凭据；审批机制不等于上游授权隔离。
6. SQLite 文件、WAL、备份、日志和 `.env` 均视为敏感数据。
7. 定期检查 `/api/audit`、更新 Node.js 与依赖，并执行 `npm audit --omit=dev`。

## 已知边界

- v1.0 是单节点自托管版本，不包含组织 SSO、速率限制器、分布式锁、集中式 KMS 或自动 TLS。
- OAuth provider 配置是通用授权码 + PKCE 实现；个别 provider 的非标准字段需通过新适配器扩展。
- 内置账号系统适合小型可信团队；高风险公网场景应在反向代理处增加额外身份层和限流。
