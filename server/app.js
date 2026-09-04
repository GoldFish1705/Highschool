/**
 * แกนกลางของแอปพลิเคชัน
 *
 * เว็บไซต์วางแผนการอ่านหนังสือและติดตามเป้าหมายการเรียน
 * สำหรับนักเรียนระดับมัธยมศึกษาตอนปลาย
 *
 * ทุก request จะผ่านด่านตามลำดับนี้:
 *   1. จำกัดอัตราการเรียกใช้ต่อ IP      (กันการยิงถล่ม)
 *   2. ตรวจ session จากคุกกี้            (รู้ว่าใครเป็นใคร)
 *   3. ตรวจสิทธิ์เข้าถึงเส้นทางนั้น       (ต้องเข้าสู่ระบบหรือไม่)
 *   4. ตรวจ CSRF                        (เฉพาะคำขอที่เปลี่ยนข้อมูล)
 *   5. อ่านและตรวจสอบข้อมูลที่ส่งมา      (validation)
 *   6. ทำงานจริงใน route handler
 */
import http from 'node:http';
import { config, cookieNames } from './config.js';
import { createRouter } from './router.js';
import { serveStatic } from './static.js';
import { sendJson, sendError, HttpError } from './http/respond.js';
import { readJsonBody } from './http/body.js';
import { applySecurityHeaders } from './security/headers.js';
import { checkCsrf, issueCsrfToken } from './security/csrf.js';
import { parseCookies, resolveSession, csrfCookie } from './security/session.js';
import { globalLimiter, authLimiter, clientIp } from './security/ratelimit.js';

import registerAuthRoutes from './routes/auth.js';
import registerSubjectRoutes from './routes/subjects.js';
import registerPlanRoutes from './routes/plans.js';
import registerGoalRoutes from './routes/goals.js';
import registerStatsRoutes from './routes/stats.js';

const router = createRouter();
registerAuthRoutes(router);
registerSubjectRoutes(router);
registerPlanRoutes(router);
registerGoalRoutes(router);
registerStatsRoutes(router);

// เส้นทางของหน้าเว็บฝั่ง client ทั้งหมดที่ต้องส่ง index.html กลับไป
// กำหนดเป็นรายการตายตัว ไม่ใช้ catch-all เพื่อให้ path ที่ไม่มีจริงยังตอบ 404 ตามปกติ
const APP_ROUTES = new Set([
  '/', '/dashboard', '/plans', '/goals', '/progress', '/summary', '/settings',
]);

/** ต่อค่า Set-Cookie เข้ากับที่มีอยู่แล้ว โดยไม่เขียนทับของเดิม */
function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing === undefined ? [] : (Array.isArray(existing) ? existing : [existing]);
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}

/** ให้แน่ใจว่าเบราว์เซอร์มี CSRF token เสมอเมื่อโหลดหน้าเว็บ */
function ensureCsrfCookie(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[cookieNames.csrf];
  if (typeof existing === 'string' && existing.length >= 20) return existing;

  const token = issueCsrfToken();
  appendCookie(res, csrfCookie(token));
  return token;
}

async function handleApi(req, res, url) {
  const matched = router.match(req.method, url.pathname);

  if (!matched) {
    const allowed = router.methodsFor(url.pathname);
    if (allowed.length > 0) {
      sendJson(res, 405, { error: 'ไม่รองรับ method นี้' }, { Allow: allowed.join(', ') });
    } else {
      sendError(res, 404, 'ไม่พบเส้นทางที่ร้องขอ');
    }
    return;
  }

  const { handler, params, options } = matched;
  const ip = clientIp(req);

  // ด่านที่ 4 — CSRF (ทำก่อนอ่าน body เพื่อไม่ให้เสียเวลาอ่านข้อมูลของคำขอที่จะถูกปฏิเสธอยู่ดี)
  const csrf = checkCsrf(req);
  if (!csrf.ok) {
    sendError(res, 403, `คำขอถูกปฏิเสธเพื่อความปลอดภัย: ${csrf.reason}`);
    return;
  }

  // จำกัดอัตราเข้มเป็นพิเศษสำหรับ endpoint ที่เกี่ยวกับการยืนยันตัวตน
  if (options.strictLimit) {
    const verdict = authLimiter.consume(ip);
    if (!verdict.allowed) {
      sendJson(res, 429, { error: 'พยายามบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
        { 'Retry-After': String(verdict.retryAfterSec) });
      return;
    }
  }

  // ด่านที่ 2 — ระบุตัวตนจากคุกกี้
  const cookies = parseCookies(req.headers.cookie);
  const session = resolveSession(cookies[cookieNames.session]);

  // ด่านที่ 3 — ตรวจสิทธิ์
  if (options.auth && !session) {
    sendError(res, 401, 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
    return;
  }

  const ctx = {
    req, res, params, ip, session,
    userId: session ? session.userId : null,
    query: url.searchParams,
    appendCookie: (cookie) => appendCookie(res, cookie),
    body: null,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    ctx.body = await readJsonBody(req);
  }

  const result = await handler(ctx);
  // handler ที่ตอบเองแล้วจะคืน undefined
  if (result !== undefined && !res.writableEnded) {
    sendJson(res, result.status || 200, result.body === undefined ? result : result.body);
  }
}

async function handleRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    sendError(res, 400, 'URL ไม่ถูกต้อง');
    return;
  }

  // ด่านที่ 1 — จำกัดอัตราต่อ IP สำหรับทุกคำขอ
  const verdict = globalLimiter.consume(clientIp(req));
  if (!verdict.allowed) {
    sendJson(res, 429, { error: 'คำขอถี่เกินไป กรุณารอสักครู่' },
      { 'Retry-After': String(verdict.retryAfterSec) });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'ไม่รองรับ method นี้');
    return;
  }

  // หน้าเว็บของแอป — ส่ง index.html แล้วให้ JavaScript ฝั่ง client จัดการเส้นทางต่อ
  if (APP_ROUTES.has(url.pathname)) {
    ensureCsrfCookie(req, res);
    if (await serveStatic(req, res, '/index.html')) return;
  }

  if (url.pathname === '/login') {
    ensureCsrfCookie(req, res);
    if (await serveStatic(req, res, '/login.html')) return;
  }

  // ไฟล์ HTML อื่น ๆ ก็ต้องมี CSRF token ติดไปด้วย
  if (url.pathname.endsWith('.html')) {
    ensureCsrfCookie(req, res);
  }

  if (await serveStatic(req, res, url.pathname)) return;

  // ไม่พบไฟล์ — ตอบ 404 เป็น HTML ถ้าผู้ใช้เปิดผ่านเบราว์เซอร์
  applySecurityHeaders(res);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.writeHead(404);
  res.end('ไม่พบหน้าที่ต้องการ');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    if (res.writableEnded) return;

    if (error instanceof HttpError) {
      sendError(res, error.status, error.message, error.details);
      return;
    }

    // ข้อผิดพลาดที่ไม่ได้คาดไว้: เก็บรายละเอียดไว้ในบันทึกของเซิร์ฟเวอร์เท่านั้น
    // ผู้ใช้จะเห็นเพียงข้อความกลาง ๆ เพื่อไม่ให้ผู้โจมตีรู้โครงสร้างภายในระบบ
    console.error('[error]', req.method, req.url, error);
    sendError(res, 500, 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง');
  });
});

// ป้องกันการโจมตีแบบเปิดการเชื่อมต่อค้างไว้เพื่อกินทรัพยากร (slowloris)
server.headersTimeout = config.requestTimeoutMs;
server.requestTimeout = config.requestTimeoutMs;
server.keepAliveTimeout = 5000;
// จำกัดขนาด header กัน header ยักษ์มากินแรม
server.maxHeadersCount = 60;

export { server, router };
