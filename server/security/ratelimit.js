/**
 * การจำกัดอัตราการเรียกใช้ (Rate limiting)
 *
 * ป้องกัน 2 อย่าง:
 *   1. การเดารหัสผ่านซ้ำ ๆ (brute force) — ล็อกบัญชีชั่วคราวแบบเพิ่มเวลาขึ้นเรื่อย ๆ
 *   2. การยิง request ถล่มเซิร์ฟเวอร์ — จำกัดจำนวน request ต่อ IP
 *
 * จุดสำคัญเรื่องการประหยัดแรม:
 * ตัวนับเก็บใน Map ที่ "จำกัดจำนวนรายการสูงสุด" ไว้ ถ้าผู้โจมตีปลอม IP นับล้าน
 * Map จะไม่โตจนแรมหมด เพราะรายการเก่าสุดจะถูกลบทิ้งเมื่อเกินโควตา
 * และมีการกวาดรายการที่หมดอายุทิ้งเป็นระยะด้วย
 */
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { sql } from '../db.js';

/** token bucket ที่จำกัดขนาดหน่วยความจำ */
export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.capacity   จำนวน request สูงสุดที่ยิงรัวได้
   * @param {number} options.windowMs   ระยะเวลาที่เติม token จนเต็มถัง
   * @param {number} [options.maxEntries] จำนวน key สูงสุดที่จำได้ (กันแรมบวม)
   */
  constructor({ capacity, windowMs, maxEntries = 5000 }) {
    this.capacity = capacity;
    this.refillPerMs = capacity / windowMs;
    this.maxEntries = maxEntries;
    this.buckets = new Map();
  }

  /**
   * พยายามใช้สิทธิ์ 1 ครั้ง
   * @returns {{allowed: boolean, retryAfterSec: number}}
   */
  consume(key) {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      // ถ้าเต็มโควตา ลบรายการเก่าสุดออกก่อน (Map เรียงตามลำดับที่ใส่เข้ามา)
      if (this.buckets.size >= this.maxEntries) {
        let toRemove = Math.ceil(this.maxEntries * 0.1);
        for (const oldKey of this.buckets.keys()) {
          this.buckets.delete(oldKey);
          if (--toRemove <= 0) break;
        }
      }
      bucket = { tokens: this.capacity, last: now };
      this.buckets.set(key, bucket);
    } else {
      const refill = (now - bucket.last) * this.refillPerMs;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
      bucket.last = now;
    }

    if (bucket.tokens < 1) {
      return { allowed: false, retryAfterSec: Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000) };
    }
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSec: 0 };
  }

  /** ลบถังที่เต็มแล้ว (ไม่ได้ถูกใช้มานาน) ทิ้งเพื่อคืนหน่วยความจำ */
  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      const refilled = bucket.tokens + (now - bucket.last) * this.refillPerMs;
      if (refilled >= this.capacity) this.buckets.delete(key);
    }
  }
}

// จำกัดรวมทุก endpoint ต่อ IP (ค่าเริ่มต้น 240 ครั้งต่อนาที เผื่อการโหลดหน้าเว็บที่มีหลายไฟล์)
export const globalLimiter = new RateLimiter({
  capacity: config.globalRateCapacity, windowMs: 60_000, maxEntries: 5000,
});
// endpoint ที่อ่อนไหว (เข้าสู่ระบบ / สมัครสมาชิก): ค่าเริ่มต้น 10 ครั้งต่อ 5 นาทีต่อ IP
export const authLimiter = new RateLimiter({
  capacity: config.authRateCapacity, windowMs: 5 * 60_000, maxEntries: 2000,
});

/** แฮช IP ก่อนบันทึกลงฐานข้อมูล เพื่อไม่เก็บ IP ตรง ๆ (ลดข้อมูลส่วนบุคคลที่ถือไว้) */
export function hashIp(ip) {
  return createHmac('sha256', config.sessionSecret).update(String(ip || '')).digest('hex').slice(0, 32);
}

/* ---------- การล็อกบัญชีเมื่อเดารหัสผ่านผิดซ้ำ ---------- */

const FREE_ATTEMPTS = 5;          // ผิดได้ 5 ครั้งก่อนเริ่มล็อก
const BASE_LOCK_MS = 60_000;      // ล็อกครั้งแรก 1 นาที
const MAX_LOCK_MS = 60 * 60_000;  // ล็อกนานสุด 1 ชั่วโมง

/** ตรวจว่า key นี้ถูกล็อกอยู่หรือไม่ */
export function checkLock(key) {
  const row = sql('SELECT failures, locked_until FROM login_failures WHERE key = ?').get(key);
  if (!row) return { locked: false, retryAfterSec: 0 };

  const now = Date.now();
  if (row.locked_until > now) {
    return { locked: true, retryAfterSec: Math.ceil((row.locked_until - now) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

/** บันทึกความล้มเหลว 1 ครั้ง และคำนวณเวลาล็อกแบบเพิ่มเป็นทวีคูณ */
export function recordFailure(key) {
  const now = Date.now();
  const row = sql('SELECT failures, locked_until FROM login_failures WHERE key = ?').get(key);
  const failures = (row ? row.failures : 0) + 1;

  let lockedUntil = 0;
  if (failures > FREE_ATTEMPTS) {
    const step = failures - FREE_ATTEMPTS - 1;
    lockedUntil = now + Math.min(BASE_LOCK_MS * 2 ** step, MAX_LOCK_MS);
  }

  sql(`INSERT INTO login_failures (key, failures, locked_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET failures = ?, locked_until = ?, updated_at = ?`)
    .run(key, failures, lockedUntil, now, failures, lockedUntil, now);

  return { failures, lockedUntil };
}

/** ล้างตัวนับเมื่อเข้าสู่ระบบสำเร็จ */
export function clearFailures(key) {
  sql('DELETE FROM login_failures WHERE key = ?').run(key);
}

/** ลบตัวนับเก่าที่ไม่ได้ใช้แล้วทิ้ง (เรียกเป็นระยะ) */
export function purgeOldFailures() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return sql('DELETE FROM login_failures WHERE updated_at < ? AND locked_until < ?')
    .run(cutoff, Date.now()).changes;
}

/**
 * หา IP ของผู้ใช้จริง
 * เมื่ออยู่หลัง reverse proxy จะอ่านจาก X-Forwarded-For
 * แต่จะเชื่อ header นี้ก็ต่อเมื่อเปิด TRUST_PROXY เท่านั้น
 * เพราะถ้าเชื่อทุกกรณี ใครก็ปลอม header นี้เพื่อหนี rate limit ได้
 */
export function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0 && forwarded.length < 256) {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}
