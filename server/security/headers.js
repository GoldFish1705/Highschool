/**
 * Security headers ที่ใส่ให้ทุก response
 *
 * หัวใจคือ Content-Security-Policy (CSP) ซึ่งบอกเบราว์เซอร์ว่าอนุญาตให้โหลดอะไรได้บ้าง
 * เว็บนี้ตั้งเป็น 'self' ทั้งหมด แปลว่าโหลดสคริปต์/สไตล์/รูป ได้จากโดเมนตัวเองเท่านั้น
 * ถ้าผู้โจมตีแทรกสคริปต์เข้ามาได้ (XSS) เบราว์เซอร์ก็จะปฏิเสธไม่รันให้อยู่ดี
 *
 * เว็บนี้จึงไม่ใช้ CDN, ไม่ใช้ Google Fonts, ไม่มี inline script/style เลย
 */
import { config } from '../config.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",              // ไม่มี 'unsafe-inline' และไม่มี 'unsafe-eval'
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",             // ห้ามส่งฟอร์มออกไปเว็บอื่น
  "frame-ancestors 'none'",         // ห้ามเว็บอื่นเอาเราไปใส่ iframe (กัน clickjacking)
  "base-uri 'none'",                // ห้ามแก้ <base> เพื่อเปลี่ยนปลายทางของลิงก์ทั้งหน้า
  "object-src 'none'",              // ห้าม plugin เก่า เช่น Flash
].join('; ');

export function applySecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);

  // ห้ามเบราว์เซอร์เดาชนิดไฟล์เอง กัน MIME sniffing ที่อาจทำให้ไฟล์ข้อความถูกรันเป็นสคริปต์
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // กัน clickjacking สำหรับเบราว์เซอร์เก่าที่ยังไม่รองรับ frame-ancestors
  res.setHeader('X-Frame-Options', 'DENY');

  // ไม่ส่ง URL ของเราไปให้เว็บอื่นตอนผู้ใช้กดลิงก์ออก
  res.setHeader('Referrer-Policy', 'same-origin');

  // ปิดสิทธิ์การใช้อุปกรณ์ที่เว็บนี้ไม่ต้องใช้ทั้งหมด
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

  // แยก browsing context ออกจากหน้าอื่น ลดช่องทางโจมตีข้ามหน้าต่าง
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  if (config.secureCookies) {
    // บังคับให้เบราว์เซอร์ใช้ HTTPS กับเว็บนี้เสมอเป็นเวลา 1 ปี
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Node ไม่ได้ใส่ X-Powered-By เอง แต่ลบซ้ำไว้กันพลาด — ไม่บอกผู้โจมตีว่าเราใช้อะไร
  res.removeHeader('X-Powered-By');
}
