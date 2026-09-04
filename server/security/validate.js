/**
 * การตรวจสอบข้อมูลที่รับเข้ามา (Input validation)
 *
 * หลักการ: "ไม่เชื่อข้อมูลจากผู้ใช้เด็ดขาด" ทุก field ต้องประกาศชนิด ความยาว และช่วงที่ยอมรับ
 * field ใดที่ไม่ได้ประกาศไว้ใน schema จะถูกทิ้งทั้งหมด (allowlist ไม่ใช่ blocklist)
 * ซึ่งกันทั้งข้อมูลขยะ, การส่ง field แปลกปลอมมาแก้ค่าที่ไม่ควรแก้ (mass assignment)
 * และการโจมตีแบบ prototype pollution
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// ชื่อผู้ใช้: อังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดล่าง ขีดกลาง — จงใจไม่รับอักขระอื่นเพื่อลดความกำกวม
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

// อักขระควบคุมที่มองไม่เห็น อาจใช้ปลอมแปลงข้อความหรือแทรกบรรทัดใน log ได้
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
// สำหรับช่องที่ยอมให้ขึ้นบรรทัดใหม่ได้ จะเว้น tab (u0009) กับ newline (u000A) ไว้
const CONTROL_CHARS_KEEP_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** ตรวจว่าวันที่มีอยู่จริงตามปฏิทิน เช่น 2026-02-31 ต้องไม่ผ่าน */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * ตรวจข้อมูลตาม schema
 * @param {unknown} input ข้อมูลดิบจาก request body
 * @param {Record<string, object>} schema กติกาของแต่ละ field
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export function validate(input, schema) {
  const errors = [];
  const value = Object.create(null);

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['ข้อมูลที่ส่งมาต้องเป็นอ็อบเจกต์ JSON'] };
  }

  for (const [field, rule] of Object.entries(schema)) {
    if (DANGEROUS_KEYS.has(field)) continue;

    const raw = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : undefined;
    const label = rule.label || field;

    // ไม่ได้ส่งค่ามา
    if (raw === undefined || raw === null || raw === '') {
      if (rule.required) {
        errors.push(`กรุณากรอก${label}`);
      } else if (raw === null && rule.nullable) {
        value[field] = null;
      } else if (Object.prototype.hasOwnProperty.call(rule, 'default')) {
        value[field] = rule.default;
      }
      continue;
    }

    switch (rule.type) {
      case 'string': {
        if (typeof raw !== 'string') {
          errors.push(`${label}ต้องเป็นข้อความ`);
          break;
        }
        const text = rule.trim === false ? raw : raw.trim();
        const cleaned = rule.multiline
          ? text.replace(CONTROL_CHARS_KEEP_NEWLINE, '')
          : text.replace(CONTROL_CHARS, '');
        if (rule.required && cleaned.length === 0) {
          errors.push(`กรุณากรอก${label}`);
          break;
        }
        if (rule.minLength !== undefined && cleaned.length < rule.minLength) {
          errors.push(`${label}ต้องมีอย่างน้อย ${rule.minLength} ตัวอักษร`);
          break;
        }
        if (rule.maxLength !== undefined && cleaned.length > rule.maxLength) {
          errors.push(`${label}ต้องยาวไม่เกิน ${rule.maxLength} ตัวอักษร`);
          break;
        }
        if (rule.pattern && !rule.pattern.test(cleaned)) {
          errors.push(rule.patternMessage || `รูปแบบของ${label}ไม่ถูกต้อง`);
          break;
        }
        if (rule.enum && !rule.enum.includes(cleaned)) {
          errors.push(`${label}มีค่าไม่ถูกต้อง`);
          break;
        }
        value[field] = cleaned;
        break;
      }

      case 'date': {
        if (typeof raw !== 'string' || !isRealDate(raw)) {
          errors.push(`${label}ต้องอยู่ในรูปแบบ ปปปป-ดด-วว และเป็นวันที่ที่มีอยู่จริง`);
          break;
        }
        value[field] = raw;
        break;
      }

      case 'time': {
        if (typeof raw !== 'string' || !TIME_RE.test(raw)) {
          errors.push(`${label}ต้องอยู่ในรูปแบบ ชช:นน เช่น 18:30`);
          break;
        }
        value[field] = raw;
        break;
      }

      case 'int': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isInteger(num)) {
          errors.push(`${label}ต้องเป็นจำนวนเต็ม`);
          break;
        }
        if (rule.min !== undefined && num < rule.min) {
          errors.push(`${label}ต้องไม่น้อยกว่า ${rule.min}`);
          break;
        }
        if (rule.max !== undefined && num > rule.max) {
          errors.push(`${label}ต้องไม่เกิน ${rule.max}`);
          break;
        }
        value[field] = num;
        break;
      }

      case 'number': {
        const num = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(num)) {
          errors.push(`${label}ต้องเป็นตัวเลข`);
          break;
        }
        if (rule.min !== undefined && num < rule.min) {
          errors.push(`${label}ต้องไม่น้อยกว่า ${rule.min}`);
          break;
        }
        if (rule.max !== undefined && num > rule.max) {
          errors.push(`${label}ต้องไม่เกิน ${rule.max}`);
          break;
        }
        // ปัดเป็นทศนิยม 2 ตำแหน่ง กันค่าอย่าง 0.1+0.2 ที่ทำให้ตัวเลขเพี้ยน
        value[field] = Math.round(num * 100) / 100;
        break;
      }

      case 'boolean': {
        if (typeof raw !== 'boolean') {
          errors.push(`${label}ต้องเป็น true หรือ false`);
          break;
        }
        value[field] = raw;
        break;
      }

      default:
        throw new Error(`schema ผิดพลาด: ไม่รู้จักชนิด ${rule.type}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

export const patterns = { DATE_RE, TIME_RE, COLOR_RE, USERNAME_RE };
