/**
 * การป้องกัน CSRF (Cross-Site Request Forgery)
 *
 * CSRF คือการที่เว็บไซต์ของผู้โจมตีหลอกให้เบราว์เซอร์ของเหยื่อยิง request มาที่เว็บเรา
 * โดยติดคุกกี้ของเหยื่อไปด้วย ทำให้เกิดการกระทำที่เหยื่อไม่ได้ตั้งใจ เช่น ลบข้อมูลทิ้ง
 *
 * ระบบนี้ป้องกัน 3 ชั้น (ถ้าชั้นใดชั้นหนึ่งพลาด ยังมีอีก 2 ชั้นคอยกัน):
 *   1. คุกกี้ตั้ง SameSite=Strict เบราว์เซอร์จะไม่ส่งคุกกี้ไปกับ request ที่มาจากเว็บอื่น
 *   2. ตรวจ header Origin / Referer ว่าตรงกับ origin ของเว็บเราจริง
 *   3. Double-submit token: ต้องส่ง token ที่อยู่ในคุกกี้กลับมาทาง header X-CSRF-Token ด้วย
 *      เว็บของผู้โจมตีอ่านคุกกี้ข้ามโดเมนไม่ได้ จึงเดา token ไม่ถูก
 */
import { randomBytes } from 'node:crypto';
import { config, cookieNames } from '../config.js';
import { parseCookies, safeEqual } from './session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken() {
  return randomBytes(32).toString('base64url');
}

/** origin ที่เรายอมรับ: ใช้ค่าที่ตั้งไว้ใน env ก่อน ถ้าไม่มีจึงอนุมานจาก header Host */
function expectedOrigins(req) {
  if (config.appOrigin) return [config.appOrigin];

  const host = req.headers.host;
  if (!host) return [];
  const forwardedProto = config.trustProxy ? req.headers['x-forwarded-proto'] : null;
  const proto = typeof forwardedProto === 'string' && forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : (config.secureCookies ? 'https' : 'http');
  return [`${proto}://${host}`, `http://${host}`, `https://${host}`];
}

/**
 * ตรวจ request ว่าผ่านการป้องกัน CSRF หรือไม่
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkCsrf(req) {
  if (SAFE_METHODS.has(req.method)) return { ok: true };

  const allowed = expectedOrigins(req);

  // ชั้นที่ 2 — ตรวจแหล่งที่มาของ request
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    if (!allowed.includes(origin)) {
      return { ok: false, reason: 'origin ของคำขอไม่ตรงกับเว็บไซต์นี้' };
    }
  } else {
    // เบราว์เซอร์เก่าบางตัวไม่ส่ง Origin จึงถอยไปตรวจ Referer แทน
    const referer = req.headers.referer;
    if (typeof referer !== 'string' || referer === '') {
      return { ok: false, reason: 'คำขอไม่มี header Origin หรือ Referer' };
    }
    let refererOrigin;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return { ok: false, reason: 'header Referer ไม่ถูกต้อง' };
    }
    if (!allowed.includes(refererOrigin)) {
      return { ok: false, reason: 'referer ของคำขอไม่ตรงกับเว็บไซต์นี้' };
    }
  }

  // ชั้นที่ 3 — double submit token
  const cookies = parseCookies(req.headers.cookie);
  const fromCookie = cookies[cookieNames.csrf];
  const fromHeader = req.headers['x-csrf-token'];

  if (typeof fromCookie !== 'string' || fromCookie.length < 20) {
    return { ok: false, reason: 'ไม่พบ CSRF token ในคุกกี้ กรุณาโหลดหน้าเว็บใหม่' };
  }
  if (typeof fromHeader !== 'string' || !safeEqual(fromCookie, fromHeader)) {
    return { ok: false, reason: 'CSRF token ไม่ถูกต้อง' };
  }

  return { ok: true };
}
