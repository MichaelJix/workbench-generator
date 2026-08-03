import { ConnectorRegistry } from './adapter.js';
import { RestApiKeyAdapter } from './rest-adapter.js';
import { WechatMpAdapter } from './wechat-adapter.js';

export function createConnectorRegistry() {
  return new ConnectorRegistry()
    .register(new RestApiKeyAdapter())
    .register(new WechatMpAdapter());
}

export const CONNECTOR_REGISTRY = createConnectorRegistry();

export function listConnectors() {
  return CONNECTOR_REGISTRY.list();
}

export function getConnector(id) {
  return CONNECTOR_REGISTRY.get(id);
}
