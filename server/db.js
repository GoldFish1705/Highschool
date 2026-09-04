/**
 * ชั้นฐานข้อมูล ใช้ node:sqlite ที่ติดมากับ Node.js (ไม่ต้องติดตั้ง package เพิ่ม)
 *
 * หลักความปลอดภัยที่ยึดในไฟล์นี้:
 *   - ทุกคำสั่ง SQL เป็น prepared statement และส่งค่าผ่าน parameter binding เสมอ
 *     ไม่มีการนำข้อมูลจากผู้ใช้มาต่อเป็นสตริง SQL แม้แต่จุดเดียว จึงป้องกัน SQL Injection ได้
 *   - ทุกตารางข้อมูลผูกกับ user_id และทุก query กรองด้วย user_id เพื่อป้องกัน IDOR
 *     (การเดา id เพื่อดูข้อมูลของผู้ใช้คนอื่น)
 */
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.databasePath);

// WAL ทำให้อ่านและเขียนพร้อมกันได้ และทนต่อไฟฟ้าดับดีกว่าโหมดปกติ
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
// จำกัด cache ของ SQLite ไว้ที่ 2 MB (ค่าติดลบ = คิดเป็นกิโลไบต์) เพื่อประหยัดแรม
db.exec('PRAGMA cache_size = -2000');
db.exec('PRAGMA synchronous = NORMAL');

/**
 * ระบบ migration แบบง่ายด้วย PRAGMA user_version
 * เพิ่ม migration ใหม่ต่อท้าย array นี้เท่านั้น ห้ามแก้ของเดิมที่รันไปแล้ว
 */
const migrations = [
  function initialSchema() {
    db.exec(`
      CREATE TABLE users (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        username            TEXT    NOT NULL UNIQUE,
        display_name        TEXT    NOT NULL,
        password_hash       TEXT    NOT NULL,
        created_at          TEXT    NOT NULL,
        password_changed_at TEXT    NOT NULL
      );

      CREATE TABLE sessions (
        id                 TEXT    PRIMARY KEY,
        user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash         TEXT    NOT NULL UNIQUE,
        device_label       TEXT    NOT NULL DEFAULT '',
        created_at         INTEGER NOT NULL,
        last_seen_at       INTEGER NOT NULL,
        expires_at         INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        revoked_at         INTEGER
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expiry ON sessions(absolute_expires_at);

      CREATE TABLE subjects (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        color      TEXT    NOT NULL,
        created_at TEXT    NOT NULL,
        UNIQUE (user_id, name)
      );
      CREATE INDEX idx_subjects_user ON subjects(user_id);

      CREATE TABLE study_plans (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id   INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        title        TEXT    NOT NULL,
        plan_date    TEXT    NOT NULL,
        start_time   TEXT    NOT NULL,
        end_time     TEXT    NOT NULL,
        note         TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'planned',
        completed_at TEXT,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
      );
      CREATE INDEX idx_plans_user_date ON study_plans(user_id, plan_date);

      CREATE TABLE goals (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id    INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        title         TEXT    NOT NULL,
        description   TEXT    NOT NULL DEFAULT '',
        goal_type     TEXT    NOT NULL,
        target_value  REAL    NOT NULL,
        current_value REAL    NOT NULL DEFAULT 0,
        target_unit   TEXT    NOT NULL,
        due_date      TEXT,
        status        TEXT    NOT NULL DEFAULT 'active',
        created_at    TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL
      );
      CREATE INDEX idx_goals_user ON goals(user_id, status);

      CREATE TABLE security_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        event      TEXT    NOT NULL,
        detail     TEXT    NOT NULL DEFAULT '',
        ip_hash    TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL
      );
      CREATE INDEX idx_events_user ON security_events(user_id, id DESC);

      CREATE TABLE login_failures (
        key          TEXT    PRIMARY KEY,
        failures     INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL
      );
    `);
  },
];

function runMigrations() {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let version = current; version < migrations.length; version += 1) {
    migrations[version]();
    // user_version ไม่รองรับ parameter binding แต่ค่านี้มาจากความยาว array ในโค้ด
    // ไม่ได้มาจากผู้ใช้ จึงไม่มีความเสี่ยง injection
    db.exec(`PRAGMA user_version = ${version + 1}`);
  }
}

runMigrations();

/** node:sqlite อาจคืน BigInt สำหรับ rowid — แปลงเป็น number ปกติเพื่อให้ JSON.stringify ทำงานได้ */
export function toId(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

/** เตรียมคำสั่ง SQL ครั้งเดียวแล้วใช้ซ้ำ ช่วยทั้งความเร็วและความปลอดภัย */
const cache = new Map();
export function sql(statement) {
  let prepared = cache.get(statement);
  if (!prepared) {
    prepared = db.prepare(statement);
    cache.set(statement, prepared);
  }
  return prepared;
}

/** ปิดฐานข้อมูลอย่างเรียบร้อยตอนปิดเซิร์ฟเวอร์ */
export function closeDatabase() {
  try {
    db.exec('PRAGMA optimize');
    db.close();
  } catch {
    /* ปิดไปแล้ว */
  }
}
