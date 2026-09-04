/**
 * การเสิร์ฟไฟล์หน้าเว็บ (HTML/CSS/JS)
 *
 * ช่องโหว่ที่ต้องระวังที่สุดของการเสิร์ฟไฟล์คือ Path Traversal
 * คือการที่ผู้โจมตีขอ path แบบ /../../server/config.js เพื่ออ่านไฟล์นอกโฟลเดอร์ public
 * ซึ่งอาจทำให้ซอร์สโค้ดหรือไฟล์ความลับรั่วไหล
 *
 * ไฟล์นี้ป้องกันหลายชั้น:
 *   1. ปฏิเสธ path ที่มี null byte หรือ backslash
 *   2. normalize path แล้วต่อกับโฟลเดอร์ public
 *   3. resolve เป็น absolute path แล้ว "ตรวจซ้ำ" ว่ายังอยู่ใต้ public จริง (ชั้นที่สำคัญที่สุด)
 *   4. ปฏิเสธไฟล์ซ่อน (ขึ้นต้นด้วยจุด)
 *   5. เสิร์ฟเฉพาะนามสกุลที่อยู่ในรายการอนุญาต (allowlist)
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { applySecurityHeaders } from './security/headers.js';

// เสิร์ฟเฉพาะนามสกุลเหล่านี้เท่านั้น นามสกุลอื่นถือว่าไม่มีไฟล์
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webmanifest', 'application/manifest+json'],
  ['.ico', 'image/x-icon'],
]);

const ROOT = path.resolve(config.publicDir);

/**
 * แปลง pathname จาก URL เป็นเส้นทางไฟล์จริงที่ปลอดภัย
 * @returns {string|null} absolute path หรือ null ถ้าไม่ปลอดภัย/ไม่อนุญาต
 */
export function resolveStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // percent-encoding ผิดรูปแบบ
  }

  // ชั้นที่ 1 — อักขระที่ไม่ควรมีใน path ของเว็บ
  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  // ชั้นที่ 2 — normalize เพื่อยุบ ".." และ "." ออกก่อน
  const normalized = path.posix.normalize(decoded);
  if (normalized.includes('..')) return null;

  const relative = normalized.replace(/^\/+/, '');

  // ชั้นที่ 4 — ห้ามไฟล์หรือโฟลเดอร์ที่ขึ้นต้นด้วยจุด (.env, .git ฯลฯ)
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return null;

  const absolute = path.resolve(ROOT, relative);

  // ชั้นที่ 3 — ด่านสุดท้าย ต้องอยู่ใต้โฟลเดอร์ public เท่านั้น
  if (absolute !== ROOT && !absolute.startsWith(ROOT + path.sep)) return null;

  // ชั้นที่ 5 — นามสกุลต้องอยู่ในรายการอนุญาต
  if (!MIME_TYPES.has(path.extname(absolute).toLowerCase())) return null;

  return absolute;
}

/**
 * ส่งไฟล์ static กลับไป
 * @returns {Promise<boolean>} true ถ้าส่งไฟล์แล้ว, false ถ้าไม่มีไฟล์นี้
 */
export async function serveStatic(req, res, pathname) {
  const filePath = resolveStaticPath(pathname);
  if (!filePath) return false;

  let info;
  try {
    info = await stat(filePath);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  // ETag คำนวณจากขนาดไฟล์กับเวลาแก้ไขล่าสุด ทำให้เบราว์เซอร์ที่มีไฟล์เดิมอยู่แล้ว
  // ได้รับ 304 กลับไปแทนการโหลดใหม่ ประหยัดทั้งแบนด์วิดท์และแรมของเซิร์ฟเวอร์
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;

  applySecurityHeaders(res);
  res.setHeader('Content-Type', MIME_TYPES.get(path.extname(filePath).toLowerCase()));
  res.setHeader('ETag', etag);
  // no-cache = ให้เบราว์เซอร์ถามก่อนใช้ของเก่าทุกครั้ง แต่ยังใช้ 304 ได้
  // เลือกแบบนี้เพราะเว็บนี้ไม่มีขั้นตอน build ที่ใส่เลขเวอร์ชันในชื่อไฟล์
  res.setHeader('Cache-Control', 'no-cache');

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    res.end();
    return true;
  }

  res.setHeader('Content-Length', info.size);

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return true;
  }

  res.writeHead(200);
  // ใช้ stream แทนการอ่านไฟล์ทั้งก้อนเข้าแรม — สำคัญมากสำหรับเซิร์ฟเวอร์แรมน้อย
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.destroy();
  });
  stream.pipe(res);
  return true;
}
