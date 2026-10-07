import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new Error('数据库版本高于当前应用，请使用匹配版本。');
  if (!version) db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE workspace (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), settings TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX session_expiry ON sessions(expires_at);
    CREATE TABLE vehicles (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, fleet_group TEXT NOT NULL, model TEXT NOT NULL, energy TEXT NOT NULL,
      mileage REAL NOT NULL DEFAULT 0 CHECK(mileage>=0), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE incidents (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      category TEXT NOT NULL CHECK(category IN('power','temperature','brake','tire','connection','energy')), level TEXT NOT NULL CHECK(level IN('高风险','中风险','低风险')),
      description TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0 CHECK(step BETWEEN 0 AND 4), owner_id TEXT REFERENCES users(id),
      metric TEXT NOT NULL DEFAULT '', observed_value REAL, resolved_value REAL, unit TEXT NOT NULL DEFAULT '', normal_range TEXT NOT NULL DEFAULT '',
      cause TEXT NOT NULL DEFAULT '', diagnosis TEXT NOT NULL DEFAULT '', solution TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, due_at INTEGER NOT NULL, closed_at INTEGER, version INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX incident_created ON incidents(created_at);
    CREATE INDEX incident_owner ON incidents(owner_id,step);
    CREATE TABLE audit (id TEXT PRIMARY KEY, incident_id TEXT REFERENCES incidents(id), actor_id TEXT NOT NULL REFERENCES users(id), actor_name TEXT NOT NULL,
      title TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX audit_incident ON audit(incident_id,at);
    CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
    CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is immutable'); END;
    CREATE TABLE drafts (user_id TEXT NOT NULL REFERENCES users(id), incident_id TEXT NOT NULL REFERENCES incidents(id), payload TEXT NOT NULL,
      PRIMARY KEY(user_id,incident_id));
    CREATE TABLE imports (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), result TEXT NOT NULL);
    PRAGMA user_version=1;
    COMMIT;
  `);
  return db;
}
