import { SqliteStore } from '../storage/database.js';
import { CONNECTOR_REGISTRY } from '../core/connectors/index.js';
import { executeOutbound } from '../security/outbound.js';
import { AuthService } from './auth-service.js';
import { WorkbenchService } from './workbench-service.js';
import { InterviewService } from './interview-service.js';
import { ActionService } from './action-service.js';
import { OAuthService, parseOAuthProviders } from './oauth-service.js';

export function createServices(config, overrides = {}) {
  const store = overrides.store || new SqliteStore(config.databasePath, { clock: overrides.clock });
  const workbenches = new WorkbenchService(store);
  const services = {
    store,
    auth: new AuthService(store),
    workbenches,
    interviews: new InterviewService(store, workbenches),
    connectors: CONNECTOR_REGISTRY
  };
  services.actions = new ActionService(store, workbenches, CONNECTOR_REGISTRY, {
    executor: overrides.executor || ((request) => executeOutbound(request, { allowPrivate: config.allowPrivateUpstream })),
    env: overrides.env || config.connectorEnv || {}
  });
  services.oauth = new OAuthService(store, parseOAuthProviders(config.oauthProvidersJson), {
    masterKey: config.masterKey,
    allowPrivate: config.allowPrivateUpstream,
    fetchImpl: overrides.fetchImpl
  });
  return services;
}
