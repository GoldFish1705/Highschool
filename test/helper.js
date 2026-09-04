/**
 * ตัวช่วยสำหรับชุดทดสอบ
 *
 * ตั้งค่า environment ให้ชี้ไปยังโฟลเดอร์ชั่วคราวก่อน import แอป
 * เพื่อให้แต่ละไฟล์ทดสอบมีฐานข้อมูลของตัวเองแยกกัน ไม่รบกวนข้อมูลจริง
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'study-planner-test-'));

process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-secret-key-do-not-use-in-production';
process.env.TRUST_PROXY = '0';
process.env.SECURE_COOKIES = '0';
// ผ่อนลิมิตต่อ IP ระหว่างทดสอบ เพราะทุกคำขอมาจาก 127.0.0.1 เหมือนกันหมด
// (การล็อกบัญชีเมื่อเดารหัสผ่านผิดยังทำงานปกติ และมีเทสต์ตรวจอยู่)
process.env.GLOBAL_RATE_CAPACITY = '100000';
process.env.AUTH_RATE_CAPACITY = '100000';

const { server } = await import('../server/app.js');
const { closeDatabase } = await import('../server/db.js');

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
export const baseUrl = `http://127.0.0.1:${server.address().port}`;

/** ปิดเซิร์ฟเวอร์และลบข้อมูลทดสอบทิ้ง */
export function shutdown() {
  server.close();
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
}

/**
 * ตัวจำลองเบราว์เซอร์ 1 เครื่อง มีถุงคุกกี้เป็นของตัวเอง
 * ทำให้ทดสอบสถานการณ์ "ผู้ใช้ 2 คน" ได้จริง
 */
export function createClient() {
  const cookies = new Map();

  function cookieHeader() {
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  function absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') cookies.delete(name);
      else cookies.set(name, value);
    }
  }

  /**
   * ยิงคำขอไปยัง API
   * @param {string} method
   * @param {string} routePath
   * @param {object|string|null} body
   * @param {object} options { origin, headers, csrf, contentType, raw }
   */
  async function request(method, routePath, body = undefined, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (options.origin !== null) {
      headers.Origin = options.origin || baseUrl;
    }
    const jar = cookieHeader();
    if (jar) headers.Cookie = jar;

    if (body !== undefined) {
      headers['Content-Type'] = options.contentType || 'application/json';
    }

    if (method !== 'GET' && method !== 'HEAD' && options.csrf !== null) {
      const token = options.csrf ?? cookies.get('sp_csrf');
      if (token) headers['X-CSRF-Token'] = decodeURIComponent(token);
    }

    const payload = body === undefined
      ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body));

    const response = await fetch(baseUrl + routePath, { method, headers, body: payload });
    absorb(response);

    let json = null;
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return { status: response.status, headers: response.headers, body: json, text };
  }

  return {
    cookies,
    request,
    get: (routePath, options) => request('GET', routePath, undefined, options),
    post: (routePath, body, options) => request('POST', routePath, body ?? {}, options),
    patch: (routePath, body, options) => request('PATCH', routePath, body ?? {}, options),
    delete: (routePath, options) => request('DELETE', routePath, {}, options),

    /** ขอ CSRF token แล้วสมัครสมาชิก คืนข้อมูลผู้ใช้ที่สร้าง */
    async register(username, password = 'StudyPlan2569!ok') {
      await request('GET', '/api/csrf');
      const result = await request('POST', '/api/auth/register', {
        username, displayName: `นักเรียน ${username}`, password,
      });
      return { result, username, password };
    },
  };
}
