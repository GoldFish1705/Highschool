/**
 * บันทึกเหตุการณ์ด้านความปลอดภัย
 *
 * เก็บไว้เพื่อให้ผู้ใช้ตรวจสอบย้อนหลังได้ว่ามีใครพยายามเข้าบัญชีของตนหรือไม่
 * ข้อควรระวังที่ยึดไว้:
 *   - ไม่บันทึกรหัสผ่าน, token หรือคุกกี้ลง log เด็ดขาด
 *   - IP ถูกแฮชก่อนเก็บ ไม่เก็บเลข IP ตรง ๆ
 *   - จำกัดจำนวนรายการต่อผู้ใช้ เพื่อไม่ให้ฐานข้อมูลโตขึ้นไม่สิ้นสุด
 */
import { config } from '../config.js';
import { sql } from '../db.js';
import { hashIp } from './ratelimit.js';

export const EVENTS = {
  REGISTER: 'สมัครสมาชิก',
  LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ',
  LOGIN_FAILED: 'เข้าสู่ระบบล้มเหลว',
  LOGOUT: 'ออกจากระบบ',
  PASSWORD_CHANGED: 'เปลี่ยนรหัสผ่าน',
  SESSION_REVOKED: 'เพิกถอนอุปกรณ์',
  ACCOUNT_LOCKED: 'บัญชีถูกล็อกชั่วคราว',
};

/**
 * @param {number|null} userId ผู้ใช้ที่เกี่ยวข้อง (null ถ้ายังระบุตัวตนไม่ได้)
 * @param {string} event ชื่อเหตุการณ์จาก EVENTS
 * @param {string} ip IP ของผู้เรียก (จะถูกแฮชก่อนเก็บ)
 * @param {string} detail รายละเอียดสั้น ๆ ที่ไม่ใช่ข้อมูลลับ
 */
export function recordEvent(userId, event, ip, detail = '') {
  try {
    sql('INSERT INTO security_events (user_id, event, detail, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId ?? null, event, String(detail).slice(0, 200), hashIp(ip), new Date().toISOString());

    // เก็บเฉพาะรายการล่าสุดของผู้ใช้แต่ละคน ที่เหลือลบทิ้ง
    if (userId) {
      sql(`DELETE FROM security_events
            WHERE user_id = ?
              AND id NOT IN (SELECT id FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?)`)
        .run(userId, userId, config.maxSecurityEventsPerUser);
    }
  } catch (error) {
    // การบันทึก log ต้องไม่ทำให้ระบบหลักล้ม
    console.error('[audit] บันทึกเหตุการณ์ไม่สำเร็จ:', error.message);
  }
}

/** ดึงประวัติความปลอดภัยของผู้ใช้ (ไม่คืนค่า ip_hash ออกไปให้ผู้ใช้เห็น) */
export function listEvents(userId, limit = 20) {
  return sql('SELECT event, detail, created_at FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, Math.min(Math.max(limit, 1), 100))
    .map((row) => ({ event: row.event, detail: row.detail, createdAt: row.created_at }));
}

/** ลบเหตุการณ์ที่ไม่ผูกกับผู้ใช้ (เช่น login ล้มเหลวของชื่อที่ไม่มีจริง) ที่เก่ากว่า 30 วัน */
export function purgeOldEvents() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return sql('DELETE FROM security_events WHERE user_id IS NULL AND created_at < ?').run(cutoff).changes;
}
