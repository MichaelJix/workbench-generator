import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('collecting','ready','completed')),
  questions_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  spec_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workbenches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, slug)
);
CREATE TABLE IF NOT EXISTS workbench_versions (
  workbench_id TEXT NOT NULL REFERENCES workbenches(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workbench_id, version)
);
CREATE TABLE IF NOT EXISTS action_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workbench_id TEXT NOT NULL REFERENCES workbenches(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','executing','executed','failed','expired')),
  approval_hash TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  executed_at TEXT,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS oauth_credentials (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TEXT,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_interviews_user ON interviews(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workbenches_user ON workbenches(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_user ON action_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
`;

const parseJson = (value, fallback = null) => value == null ? fallback : JSON.parse(value);

export class SqliteStore {
  constructor(filename, { clock = () => new Date() } = {}) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.clock = clock;
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(this.now());
  }

  now() { return this.clock().toISOString(); }
  close() { this.db.close(); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  countUsers() { return this.db.prepare('SELECT count(*) AS count FROM users').get().count; }
  insertUser(user) {
    this.db.prepare(`INSERT INTO users(id,username,password_hash,password_salt,role,created_at)
      VALUES(@id,@username,@passwordHash,@passwordSalt,@role,@createdAt)`).run(user);
  }
  getUserByUsername(username) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(username); }
  getUser(id) { return this.db.prepare('SELECT id,username,role,created_at FROM users WHERE id=?').get(id); }

  insertToken(token) {
    this.db.prepare(`INSERT INTO api_tokens(id,user_id,name,token_hash,scopes_json,expires_at,created_at)
      VALUES(@id,@userId,@name,@tokenHash,@scopesJson,@expiresAt,@createdAt)`).run(token);
  }
  getTokenByHash(hash) { return this.db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(hash); }
  touchToken(id) { this.db.prepare('UPDATE api_tokens SET last_used_at=? WHERE id=?').run(this.now(), id); }
  revokeToken(id, userId) { return this.db.prepare('UPDATE api_tokens SET revoked_at=? WHERE id=? AND user_id=?').run(this.now(), id, userId).changes; }

  insertInterview(value) {
    this.db.prepare(`INSERT INTO interviews(id,user_id,prompt,platform,status,questions_json,answers_json,spec_json,created_at,updated_at)
      VALUES(@id,@userId,@prompt,@platform,@status,@questionsJson,@answersJson,@specJson,@createdAt,@updatedAt)`).run(value);
  }
  getInterview(id, userId) { return this.db.prepare('SELECT * FROM interviews WHERE id=? AND user_id=?').get(id, userId); }
  updateInterview(id, userId, patch) {
    this.db.prepare(`UPDATE interviews SET status=@status,answers_json=@answersJson,spec_json=@specJson,updated_at=@updatedAt
      WHERE id=@id AND user_id=@userId`).run({ id, userId, ...patch });
  }

  insertWorkbench(workbench, version) {
    this.transaction(() => {
      this.db.prepare(`INSERT INTO workbenches(id,user_id,name,slug,current_version,created_at,updated_at)
        VALUES(@id,@userId,@name,@slug,@currentVersion,@createdAt,@updatedAt)`).run(workbench);
      this.insertWorkbenchVersion(version);
    });
  }
  insertWorkbenchVersion(version) {
    this.db.prepare(`INSERT INTO workbench_versions(workbench_id,version,spec_json,note,created_by,created_at)
      VALUES(@workbenchId,@version,@specJson,@note,@createdBy,@createdAt)`).run(version);
  }
  getWorkbench(id, userId) { return this.db.prepare('SELECT * FROM workbenches WHERE id=? AND user_id=?').get(id, userId); }
  listWorkbenches(userId, limit = 100) { return this.db.prepare('SELECT * FROM workbenches WHERE user_id=? ORDER BY updated_at DESC LIMIT ?').all(userId, limit); }
  getWorkbenchVersion(id, version) { return this.db.prepare('SELECT * FROM workbench_versions WHERE workbench_id=? AND version=?').get(id, version); }
  listWorkbenchVersions(id) { return this.db.prepare('SELECT version,note,created_by,created_at FROM workbench_versions WHERE workbench_id=? ORDER BY version DESC').all(id); }
  advanceWorkbench(id, userId, name, version, now) {
    return this.db.prepare(`UPDATE workbenches SET name=?,current_version=?,updated_at=? WHERE id=? AND user_id=?`).run(name, version, now, id, userId).changes;
  }

  insertAction(value) {
    this.db.prepare(`INSERT INTO action_requests(id,user_id,workbench_id,action_id,input_json,status,expires_at,created_at)
      VALUES(@id,@userId,@workbenchId,@actionId,@inputJson,@status,@expiresAt,@createdAt)`).run(value);
  }
  getAction(id, userId) { return this.db.prepare('SELECT * FROM action_requests WHERE id=? AND user_id=?').get(id, userId); }
  approveAction(id, userId, approvalHash, now) {
    return this.db.prepare(`UPDATE action_requests SET status='approved',approval_hash=?,decided_at=?
      WHERE id=? AND user_id=? AND status='pending'`).run(approvalHash, now, id, userId).changes;
  }
  rejectAction(id, userId, now) {
    return this.db.prepare(`UPDATE action_requests SET status='rejected',decided_at=?
      WHERE id=? AND user_id=? AND status='pending'`).run(now, id, userId).changes;
  }
  claimAction(id, userId, approvalHash) {
    return this.db.prepare(`UPDATE action_requests SET status='executing',approval_hash=NULL
      WHERE id=? AND user_id=? AND status='approved' AND approval_hash=?`).run(id, userId, approvalHash).changes;
  }
  finishAction(id, userId, status, result, now) {
    return this.db.prepare(`UPDATE action_requests SET status=?,approval_hash=NULL,executed_at=?,result_json=?
      WHERE id=? AND user_id=? AND status='executing'`).run(status, now, JSON.stringify(result), id, userId).changes;
  }

  audit(userId, eventType, targetType, targetId, details = {}) {
    this.db.prepare(`INSERT INTO audit_log(user_id,event_type,target_type,target_id,details_json,created_at)
      VALUES(?,?,?,?,?,?)`).run(userId || null, eventType, targetType, targetId || null, JSON.stringify(details), this.now());
  }
  listAudit(limit = 100) {
    return this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map((row) => ({ ...row, details: parseJson(row.details_json, {}) }));
  }

  insertOauthState(value) {
    this.db.prepare(`INSERT INTO oauth_states(id,user_id,provider,state_hash,code_verifier,redirect_uri,expires_at,created_at)
      VALUES(@id,@userId,@provider,@stateHash,@codeVerifier,@redirectUri,@expiresAt,@createdAt)`).run(value);
  }
  consumeOauthState(hash, now) {
    const row = this.db.prepare('SELECT * FROM oauth_states WHERE state_hash=? AND consumed_at IS NULL').get(hash);
    if (row) this.db.prepare('UPDATE oauth_states SET consumed_at=? WHERE id=?').run(now, row.id);
    return row;
  }
  upsertOauthCredential(value) {
    this.db.prepare(`INSERT INTO oauth_credentials(user_id,provider,access_token_enc,refresh_token_enc,expires_at,scopes_json,created_at,updated_at)
      VALUES(@userId,@provider,@accessTokenEnc,@refreshTokenEnc,@expiresAt,@scopesJson,@createdAt,@updatedAt)
      ON CONFLICT(user_id,provider) DO UPDATE SET access_token_enc=excluded.access_token_enc,
      refresh_token_enc=excluded.refresh_token_enc,expires_at=excluded.expires_at,scopes_json=excluded.scopes_json,updated_at=excluded.updated_at`).run(value);
  }
  getOauthCredential(userId, provider) { return this.db.prepare('SELECT * FROM oauth_credentials WHERE user_id=? AND provider=?').get(userId, provider); }
}

export function decodeInterview(row) {
  return row && {
    id: row.id, userId: row.user_id, prompt: row.prompt, platform: row.platform, status: row.status,
    questions: parseJson(row.questions_json, []), answers: parseJson(row.answers_json, {}),
    spec: parseJson(row.spec_json), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function decodeWorkbench(row, versionRow) {
  return row && {
    id: row.id, userId: row.user_id, name: row.name, slug: row.slug, currentVersion: row.current_version,
    spec: versionRow ? parseJson(versionRow.spec_json) : undefined, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function decodeAction(row) {
  return row && {
    id: row.id, userId: row.user_id, workbenchId: row.workbench_id, actionId: row.action_id,
    input: parseJson(row.input_json, {}), status: row.status, expiresAt: row.expires_at,
    createdAt: row.created_at, decidedAt: row.decided_at, executedAt: row.executed_at,
    result: parseJson(row.result_json)
  };
}
