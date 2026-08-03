import { AppError, ErrorCode } from './errors.js';

export const CURRENT_SPEC_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

function migrate0to1(input) {
  const spec = clone(input);
  spec.specVersion = 1;
  if (spec.connector?.type === 'rest-apikey' && Array.isArray(spec.connector.endpoints)) {
    spec.connector.endpoints = spec.connector.endpoints.map((endpoint) => ({ method: 'GET', ...endpoint }));
  }
  return spec;
}

const MIGRATIONS = new Map([[0, migrate0to1]]);

export function migrateSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(ErrorCode.INVALID_SPEC, 'Spec 必须是对象');
  }
  let spec = clone(input);
  let version = spec.specVersion == null ? 0 : Number(spec.specVersion);
  if (!Number.isInteger(version) || version < 0 || version > CURRENT_SPEC_VERSION) {
    throw new AppError(ErrorCode.UNSUPPORTED_SPEC_VERSION, `不支持的 specVersion: ${spec.specVersion}`);
  }
  const applied = [];
  while (version < CURRENT_SPEC_VERSION) {
    const migration = MIGRATIONS.get(version);
    if (!migration) throw new AppError(ErrorCode.UNSUPPORTED_SPEC_VERSION, `缺少 v${version} 迁移器`);
    spec = migration(spec);
    applied.push(`${version}->${version + 1}`);
    version += 1;
  }
  return { spec, fromVersion: input.specVersion == null ? 0 : Number(input.specVersion), toVersion: version, applied };
}
