/**
 * เส้นทางเกี่ยวกับบัญชีผู้ใช้: สมัครสมาชิก เข้าสู่ระบบ ออกจากระบบ เปลี่ยนรหัสผ่าน จัดการอุปกรณ์
 */
import { sql, toId } from '../db.js';
import { HttpError } from '../http/respond.js';
import { validate, patterns } from '../security/validate.js';
import {
  hashPassword, verifyPassword, fakeVerify, validatePasswordStrength,
} from '../security/password.js';
import {
  createSession, revokeSession, revokeOtherSessions, listSessions,
  sessionCookie, csrfCookie, clearCookies,
} from '../security/session.js';
import { issueCsrfToken } from '../security/csrf.js';
import { checkLock, recordFailure, clearFailures, hashIp } from '../security/ratelimit.js';
import { recordEvent, listEvents, EVENTS } from '../security/audit.js';

// วิชาเริ่มต้นที่สร้างให้อัตโนมัติเมื่อสมัครสมาชิก เพื่อให้เริ่มวางแผนได้ทันที
const DEFAULT_SUBJECTS = [
  ['ภาษาไทย', '#e11d48'],
  ['คณิตศาสตร์', '#2563eb'],
  ['วิทยาศาสตร์', '#059669'],
  ['สังคมศึกษา', '#d97706'],
  ['ภาษาอังกฤษ', '#7c3aed'],
];

const registerSchema = {
  username: {
    type: 'string', required: true, maxLength: 32, label: 'ชื่อผู้ใช้',
    pattern: patterns.USERNAME_RE,
    patternMessage: 'ชื่อผู้ใช้ต้องเป็นภาษาอังกฤษพิมพ์เล็ก ตัวเลข . _ - ยาว 3-32 ตัวอักษร',
  },
  displayName: { type: 'string', required: true, maxLength: 60, label: 'ชื่อที่ใช้แสดง' },
  password: { type: 'string', required: true, maxLength: 128, trim: false, label: 'รหัสผ่าน' },
};

const loginSchema = {
  username: { type: 'string', required: true, maxLength: 32, label: 'ชื่อผู้ใช้' },
  password: { type: 'string', required: true, maxLength: 128, trim: false, label: 'รหัสผ่าน' },
};

function ensureValid(result) {
  if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);
  return result.value;
}

/** ออกคุกกี้ session + CSRF ชุดใหม่ให้ผู้ใช้ที่เพิ่งเข้าสู่ระบบ */
function issueLoginCookies(ctx, userId) {
  const { token, sessionId } = createSession(userId, ctx.req.headers['user-agent']);
  ctx.appendCookie(sessionCookie(token));
  ctx.appendCookie(csrfCookie(issueCsrfToken()));
  return sessionId;
}

export default function registerAuthRoutes(router) {
  /** ขอ CSRF token (ใช้ตอนเริ่มต้นแอปหรือเมื่อ token หมดอายุ) */
  router.get('/api/csrf', (ctx) => {
    const token = issueCsrfToken();
    ctx.appendCookie(csrfCookie(token));
    return { body: { csrfToken: token } };
  });

  /** ดูว่าใครกำลังเข้าสู่ระบบอยู่ */
  router.get('/api/session', (ctx) => {
    if (!ctx.session) return { body: { authenticated: false } };
    return {
      body: {
        authenticated: true,
        user: { username: ctx.session.username, displayName: ctx.session.displayName },
      },
    };
  });

  /** สมัครสมาชิก */
  router.post('/api/auth/register', async (ctx) => {
    const data = ensureValid(validate(ctx.body, registerSchema));

    const problems = validatePasswordStrength(data.password, data.username);
    if (problems.length > 0) throw new HttpError(400, 'รหัสผ่านยังไม่ปลอดภัยพอ', problems);

    const existing = sql('SELECT id FROM users WHERE username = ?').get(data.username);
    if (existing) {
      // ชื่อผู้ใช้ต้องไม่ซ้ำอยู่แล้ว จึงจำเป็นต้องบอกตรง ๆ ตรงจุดนี้
      // (ต่างจากหน้าเข้าสู่ระบบที่ต้องปกปิดว่ามีบัญชีนี้อยู่จริงหรือไม่)
      throw new HttpError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น');
    }

    const passwordHash = await hashPassword(data.password);
    const now = new Date().toISOString();

    const result = sql(`INSERT INTO users (username, display_name, password_hash, created_at, password_changed_at)
                        VALUES (?, ?, ?, ?, ?)`)
      .run(data.username, data.displayName, passwordHash, now, now);
    const userId = toId(result.lastInsertRowid);

    const insertSubject = sql('INSERT INTO subjects (user_id, name, color, created_at) VALUES (?, ?, ?, ?)');
    for (const [name, color] of DEFAULT_SUBJECTS) {
      insertSubject.run(userId, name, color, now);
    }

    issueLoginCookies(ctx, userId);
    recordEvent(userId, EVENTS.REGISTER, ctx.ip);

    return {
      status: 201,
      body: { user: { username: data.username, displayName: data.displayName } },
    };
  }, { strictLimit: true });

  /** เข้าสู่ระบบ */
  router.post('/api/auth/login', async (ctx) => {
    const data = ensureValid(validate(ctx.body, loginSchema));

    // ล็อกทั้งตามชื่อผู้ใช้และตาม IP ผู้โจมตีจึงหนีด้วยการเปลี่ยนชื่อผู้ใช้ไปเรื่อย ๆ ไม่ได้
    const userKey = `user:${data.username}`;
    const ipKey = `ip:${hashIp(ctx.ip)}`;

    for (const key of [userKey, ipKey]) {
      const lock = checkLock(key);
      if (lock.locked) {
        throw new HttpError(429,
          `พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารออีก ${Math.ceil(lock.retryAfterSec / 60)} นาที`);
      }
    }

    const user = sql('SELECT id, username, display_name, password_hash FROM users WHERE username = ?')
      .get(data.username);

    // ถ้าไม่พบผู้ใช้ ยังต้องเสียเวลาแฮชเท่าเดิม เพื่อไม่ให้จับเวลาแล้วเดาได้ว่าบัญชีนี้มีจริงไหม
    const passwordOk = user
      ? await verifyPassword(data.password, user.password_hash)
      : await fakeVerify(data.password);

    if (!user || !passwordOk) {
      recordFailure(userKey);
      const ipState = recordFailure(ipKey);
      recordEvent(user ? toId(user.id) : null, EVENTS.LOGIN_FAILED, ctx.ip, `ชื่อผู้ใช้: ${data.username}`);
      if (ipState.lockedUntil > Date.now()) {
        recordEvent(user ? toId(user.id) : null, EVENTS.ACCOUNT_LOCKED, ctx.ip);
      }
      // ข้อความเดียวกันทั้งกรณีไม่มีบัญชีและกรณีรหัสผ่านผิด
      throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    clearFailures(userKey);
    clearFailures(ipKey);

    const userId = toId(user.id);
    // สร้าง session ใหม่ทุกครั้งที่เข้าสู่ระบบ ป้องกัน session fixation
    issueLoginCookies(ctx, userId);
    recordEvent(userId, EVENTS.LOGIN_SUCCESS, ctx.ip);

    return { body: { user: { username: user.username, displayName: user.display_name } } };
  }, { strictLimit: true });

  /** ออกจากระบบ */
  router.post('/api/auth/logout', (ctx) => {
    if (ctx.session) {
      revokeSession(ctx.session.sessionId, ctx.userId);
      recordEvent(ctx.userId, EVENTS.LOGOUT, ctx.ip);
    }
    for (const cookie of clearCookies()) ctx.appendCookie(cookie);
    return { body: { ok: true } };
  });

  /** เปลี่ยนรหัสผ่าน */
  router.post('/api/auth/change-password', async (ctx) => {
    const data = ensureValid(validate(ctx.body, {
      currentPassword: { type: 'string', required: true, maxLength: 128, trim: false, label: 'รหัสผ่านปัจจุบัน' },
      newPassword: { type: 'string', required: true, maxLength: 128, trim: false, label: 'รหัสผ่านใหม่' },
    }));

    const user = sql('SELECT password_hash FROM users WHERE id = ?').get(ctx.userId);
    if (!user || !(await verifyPassword(data.currentPassword, user.password_hash))) {
      recordFailure(`user:${ctx.session.username}`);
      throw new HttpError(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }

    const problems = validatePasswordStrength(data.newPassword, ctx.session.username);
    if (problems.length > 0) throw new HttpError(400, 'รหัสผ่านใหม่ยังไม่ปลอดภัยพอ', problems);

    if (data.currentPassword === data.newPassword) {
      throw new HttpError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
    }

    const now = new Date().toISOString();
    sql('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
      .run(await hashPassword(data.newPassword), now, ctx.userId);

    // เมื่อเปลี่ยนรหัสผ่าน ให้เตะอุปกรณ์อื่นออกทั้งหมด
    // เผื่อกรณีที่เปลี่ยนเพราะสงสัยว่ามีคนอื่นเข้าถึงบัญชีได้
    const revoked = revokeOtherSessions(ctx.userId, ctx.session.sessionId);
    recordEvent(ctx.userId, EVENTS.PASSWORD_CHANGED, ctx.ip, `เพิกถอนอุปกรณ์อื่น ${revoked} เครื่อง`);

    return { body: { ok: true, revokedSessions: revoked } };
  }, { auth: true, strictLimit: true });

  /** รายการอุปกรณ์ที่เข้าสู่ระบบอยู่ */
  router.get('/api/auth/sessions', (ctx) => ({
    body: {
      sessions: listSessions(ctx.userId).map((item) => ({
        ...item,
        current: item.id === ctx.session.sessionId,
      })),
    },
  }), { auth: true });

  /** เพิกถอนอุปกรณ์เครื่องใดเครื่องหนึ่ง */
  router.delete('/api/auth/sessions/:id', (ctx) => {
    // revokeSession กรองด้วย user_id ด้วยเสมอ จึงปิด session ของคนอื่นไม่ได้
    const removed = revokeSession(ctx.params.id, ctx.userId);
    if (!removed) throw new HttpError(404, 'ไม่พบอุปกรณ์ที่ต้องการ');
    recordEvent(ctx.userId, EVENTS.SESSION_REVOKED, ctx.ip);
    return { body: { ok: true } };
  }, { auth: true });

  /** ประวัติความปลอดภัยของบัญชี */
  router.get('/api/auth/activity', (ctx) => ({
    body: { events: listEvents(ctx.userId, 20) },
  }), { auth: true });
}
