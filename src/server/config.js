import path from 'node:path';
import { AppError, ErrorCode } from '../core/errors.js';

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const port = Number(env.PORT || 3080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError(ErrorCode.CONFIGURATION_ERROR, 'PORT 必须是 1-65535');
  const masterKey = env.WORKBENCH_MASTER_KEY;
  if (!masterKey || masterKey.length < 32) throw new AppError(ErrorCode.CONFIGURATION_ERROR, 'WORKBENCH_MASTER_KEY 至少需要 32 个字符');
  return {
    host: env.HOST || '127.0.0.1',
    port,
    databasePath: path.resolve(cwd, env.WORKBENCH_DATABASE || './data/workbench.db'),
    masterKey,
    oauthProvidersJson: env.OAUTH_PROVIDERS_JSON || '{}',
    allowedOrigins: String(env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}`).split(',').map((v) => v.trim()).filter(Boolean),
    allowPrivateUpstream: env.ALLOW_PRIVATE_UPSTREAM === 'true',
    publicBaseUrl: env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`,
    connectorEnv: env
  };
}
