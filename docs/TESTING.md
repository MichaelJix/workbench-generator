# 测试策略

## 测试层级

- 单元测试：schema、迁移、错误、密码、加密、状态机和适配器。
- 集成测试：真实内存 SQLite、领域服务、事务、权限、版本回滚和审批并发竞态。
- 全局测试：启动真实 HTTP 服务器，走 bootstrap、认证、访谈、工作台、审批、审计全流程。
- MCP 测试：stdio 与 Streamable HTTP 客户端分别完成工具发现和调用。
- 发布测试：从 npm tarball 安装后再次执行 CLI 和 MCP 握手。

## 测试规则

- 每个测试使用独立临时目录和数据库。
- 禁止访问真实第三方服务；连接器执行器使用本地模拟服务器。
- 测试结束必须关闭数据库、HTTP 服务器和子进程。
- 安全测试至少覆盖令牌摘要、越权、过期、审批重放、Origin、路径逃逸和明文密钥拒绝。

## 命令

```bash
npm ci
npm run test:unit
npm run test:integration
npm run test:global
npm test
npm audit --omit=dev
npm pack --dry-run
```
