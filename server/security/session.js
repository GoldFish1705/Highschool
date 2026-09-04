/**
 * การจัดการ session (การจำว่าใครเข้าสู่ระบบอยู่)
 *
 * แนวคิดความปลอดภัยหลัก:
 *   - token สุ่มด้วย CSPRNG ขนาด 32 ไบต์ (256 บิต) เดาไม่ได้ในทางปฏิบัติ
 *   - ฐานข้อมูล "ไม่เก็บ token ตัวจริง" แต่เก็บเฉพาะค่า HMAC-SHA256 ของ token
 *     ถ้าฐานข้อมูลรั่วไหล ผู้โจมตียังปลอม session ไม่ได้เพราะต้องมี secret key ด้วย
 *   - หมดอายุ 2 ชั้น: ไม่ใช้งาน 7 วัน (idle) และหมดอายุเด็ดขาด 30 วัน (absolute)
 *   - สร้าง session ใหม่ทุกครั้งที่เข้าสู่ระบบ เพื่อป้องกัน session fixation
 */
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { config, cookieNames } from '../config.js';
import { sql, toId } from '../db.js';

const TOKEN_BYTES = 32;
// เขียน last_seen_at ลงฐานข้อมูลเมื่อผ่านไปอย่างน้อย 5 นาที
// เพื่อลดจำนวนการเขียนดิสก์ (ประหยัดทั้ง I/O และอายุการใช้งานดิสก์)
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function hashToken(token) {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

/**
 * แปลง User-Agent เป็นชื่ออุปกรณ์สั้น ๆ เพื่อแสดงในหน้า "อุปกรณ์ที่เข้าสู่ระบบ"
 * เราไม่เก็บ User-Agent เต็ม ๆ เพราะไม่จำเป็นและเป็นการเก็บข้อมูลผู้ใช้เกินความจำเป็น
 */
export function deviceLabelFrom(userAgent) {
  const ua = String(userAgent || '');
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'เบราว์เซอร์อื่น';
  const os =
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : 'ระบบอื่น';
  return `${browser} บน ${os}`;
}

/** สร้าง session ใหม่ คืน token ตัวจริงกลับไปเพื่อใส่ในคุกกี้ (เก็บลง DB แค่ค่าแฮช) */
export function createSession(userId, userAgent) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const id = randomBytes(12).toString('hex');
  const now = Date.now();

  sql(`INSERT INTO sessions
         (id, user_id, token_hash, device_label, created_at, last_seen_at, expires_at, absolute_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, userId, hashToken(token), deviceLabelFrom(userAgent),
      now, now, now + config.sessionIdleMs, now + config.sessionAbsoluteMs,
    );

  return { token, sessionId: id };
}

/**
 * ตรวจ token จากคุกกี้ คืนข้อมูลผู้ใช้ถ้า session ยังใช้ได้ ไม่งั้นคืน null
 * ทุกเงื่อนไขการหมดอายุถูกตรวจในคำสั่ง SQL เดียวเพื่อลดโอกาสเขียนเงื่อนไขตกหล่น
 */
export function resolveSession(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;

  const now = Date.now();
  const row = sql(`
    SELECT s.id AS session_id, s.user_id, s.last_seen_at, s.absolute_expires_at,
           u.username, u.display_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND s.absolute_expires_at > ?
  `).get(hashToken(token), now, now);

  if (!row) return null;

  // ต่ออายุแบบ sliding window แต่ไม่เกินเวลาหมดอายุเด็ดขาด
  if (now - row.last_seen_at > TOUCH_INTERVAL_MS) {
    const nextExpiry = Math.min(now + config.sessionIdleMs, row.absolute_expires_at);
    sql('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now, nextExpiry, row.session_id);
  }

  return {
    sessionId: row.session_id,
    userId: toId(row.user_id),
    username: row.username,
    displayName: row.display_name,
  };
}

/** เพิกถอน session ที่ระบุ (ต้องเป็นของผู้ใช้คนนั้นเท่านั้น ป้องกันการปิด session ของคนอื่น) */
export function revokeSession(sessionId, userId) {
  const result = sql('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(Date.now(), sessionId, userId);
  return result.changes > 0;
}

/** เพิกถอนทุก session ของผู้ใช้ ยกเว้นอันที่ระบุ — ใช้ตอนเปลี่ยนรหัสผ่าน */
export function revokeOtherSessions(userId, keepSessionId) {
  const result = sql('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL')
    .run(Date.now(), userId, keepSessionId);
  return result.changes;
}

/** รายการอุปกรณ์ที่ยังเข้าสู่ระบบอยู่ */
export function listSessions(userId) {
  const now = Date.now();
  return sql(`
    SELECT id, device_label, created_at, last_seen_at
      FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND absolute_expires_at > ?
     ORDER BY last_seen_at DESC
  `).all(userId, now, now).map((row) => ({
    id: row.id,
    deviceLabel: row.device_label,
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  }));
}

/** ลบ session ที่หมดอายุแล้วทิ้ง เรียกเป็นระยะเพื่อไม่ให้ตารางโตขึ้นเรื่อย ๆ */
export function purgeExpiredSessions() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sql('DELETE FROM sessions WHERE absolute_expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(Date.now(), cutoff).changes;
}

/* ---------- ตัวช่วยจัดการคุกกี้ ---------- */

/** อ่านคุกกี้จาก header แบบระวังไม่ให้ header ที่ยาวผิดปกติมาถ่วงเซิร์ฟเวอร์ */
export function parseCookies(header) {
  const jar = Object.create(null);
  if (typeof header !== 'string' || header.length > 4096) return jar;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    try {
      jar[name] = decodeURIComponent(value);
    } catch {
      jar[name] = value;
    }
  }
  return jar;
}

function serializeCookie(name, value, { maxAge, httpOnly }) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (httpOnly) attrs.push('HttpOnly');
  // Secure บังคับให้คุกกี้ถูกส่งเฉพาะผ่าน HTTPS เท่านั้น กันการดักฟังบนเครือข่าย
  if (config.secureCookies) attrs.push('Secure');
  attrs.push(`Max-Age=${maxAge}`);
  return attrs.join('; ');
}

export function sessionCookie(token) {
  return serializeCookie(cookieNames.session, token, {
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
    httpOnly: true, // JavaScript ในหน้าเว็บอ่านคุกกี้นี้ไม่ได้ ลดผลกระทบหาก XSS หลุดรอด
  });
}

export function csrfCookie(token) {
  return serializeCookie(cookieNames.csrf, token, {
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000),
    httpOnly: false, // ต้องให้ JavaScript อ่านได้ เพื่อส่งกลับมาใน header X-CSRF-Token
  });
}

export function clearCookies() {
  const expire = (name) => `${name}=; Path=/; SameSite=Strict${config.secureCookies ? '; Secure' : ''}; Max-Age=0`;
  return [expire(cookieNames.session), expire(cookieNames.csrf)];
}

/** เปรียบเทียบสตริงแบบใช้เวลาคงที่ ใช้กับ token ทุกชนิด */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
