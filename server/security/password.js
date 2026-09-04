/**
 * การเก็บรหัสผ่าน
 *
 * ระบบไม่เคยเก็บรหัสผ่านจริงลงฐานข้อมูล แต่เก็บเป็นค่าแฮชด้วย scrypt ซึ่งเป็นอัลกอริทึม
 * แบบ memory-hard คือบังคับให้ผู้โจมตีต้องใช้หน่วยความจำมากต่อการเดารหัสผ่านหนึ่งครั้ง
 * ทำให้การใช้การ์ดจอเดารหัสผ่านจำนวนมาก (brute force) แพงขึ้นมาก
 *
 * ทุกครั้งจะสุ่ม salt ใหม่ 16 ไบต์ ผู้ใช้ที่ตั้งรหัสผ่านเหมือนกันจึงได้ค่าแฮชต่างกัน
 * และตารางแฮชสำเร็จรูป (rainbow table) ใช้ไม่ได้
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/**
 * จำกัดจำนวนการแฮชรหัสผ่านที่ทำพร้อมกัน
 *
 * scrypt จงใจใช้หน่วยความจำมาก (ประมาณ 16 MB ต่อการเรียก 1 ครั้งด้วยค่าที่ตั้งไว้ด้านล่าง)
 * ซึ่งเป็นข้อดีด้านความปลอดภัย แต่ก็เป็นดาบสองคม
 * ถ้าผู้โจมตียิงคำขอเข้าสู่ระบบพร้อมกัน 20 คำขอ เซิร์ฟเวอร์จะต้องใช้แรมทันที 320 MB
 * และอาจถูกระบบสั่งปิดเพราะแรมหมด (เป็นการโจมตีแบบ DoS อีกรูปแบบหนึ่ง)
 *
 * การเข้าคิวแบบนี้ทำให้แรมที่ใช้แฮชรหัสผ่านมีเพดานตายตัวที่ประมาณ 32 MB
 * ไม่ว่าจะมีคำขอเข้ามาพร้อมกันกี่คำขอก็ตาม จึงรันบนโฮสต์ฟรีที่มีแรมน้อยได้อย่างปลอดภัย
 */
const MAX_CONCURRENT_HASHES = 2;
const MAX_QUEUE_LENGTH = 100;

let activeHashes = 0;
const waiting = [];

async function withHashSlot(task) {
  if (activeHashes >= MAX_CONCURRENT_HASHES) {
    if (waiting.length >= MAX_QUEUE_LENGTH) {
      throw new Error('ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง');
    }
    await new Promise((resolve) => waiting.push(resolve));
  }

  activeHashes += 1;
  try {
    return await task();
  } finally {
    activeHashes -= 1;
    const next = waiting.shift();
    if (next) next();
  }
}

// วัดบนเครื่องพัฒนาแล้วใช้เวลาราว 65 มิลลิวินาทีต่อครั้ง
// ช้าพอที่จะกวนผู้โจมตี แต่เร็วพอที่ผู้ใช้จริงไม่รู้สึกหน่วง
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
// maxmem ต้องมากกว่า 128 * N * r ไบต์ (= 16 MB) มิฉะนั้น Node จะโยน error
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * รหัสผ่านที่พบบ่อยที่สุด ห้ามใช้
 * ในระบบจริงควรใช้รายการที่ยาวกว่านี้ แต่แค่นี้ก็ตัดรหัสผ่านที่แย่ที่สุดออกได้แล้ว
 * โดยไม่ต้องโหลดไฟล์ขนาดใหญ่เข้าหน่วยความจำ
 */
const COMMON_PASSWORDS = new Set([
  '0123456789', '1234567890', '12345678901', '123456789012',
  'password12', 'password123', 'passw0rd12', 'qwertyuiop',
  'iloveyou12', 'letmein123', 'welcome123', 'admin12345',
  'abcd123456', 'aaaaaaaaaa', '1111111111', 'qwerty1234',
  'football12', 'sunshine12', 'princess12', 'password1234',
]);

/**
 * ตรวจความแข็งแรงของรหัสผ่าน คืน array ของข้อความปัญหา (ว่าง = ผ่าน)
 * @param {string} password
 * @param {string} username
 */
export function validatePasswordStrength(password, username = '') {
  const problems = [];

  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`);
    return problems;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`รหัสผ่านต้องยาวไม่เกิน ${PASSWORD_MAX_LENGTH} ตัวอักษร`);
  }

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    problems.push('รหัสผ่านนี้ถูกใช้กันทั่วไปเกินไป กรุณาตั้งรหัสผ่านอื่น');
  }
  if (username && lower.includes(username.toLowerCase())) {
    problems.push('รหัสผ่านต้องไม่มีชื่อผู้ใช้อยู่ภายใน');
  }
  // ตรวจว่าไม่ใช่อักขระเดียวซ้ำกันทั้งหมด เช่น "aaaaaaaaaa"
  if (new Set(password).size < 4) {
    problems.push('รหัสผ่านต้องมีอักขระที่แตกต่างกันอย่างน้อย 4 แบบ');
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    problems.push('รหัสผ่านต้องผสมอย่างน้อย 2 แบบ เช่น ตัวอักษรกับตัวเลข');
  }

  return problems;
}

/**
 * สร้างค่าแฮชของรหัสผ่าน
 * รูปแบบที่เก็บ: scrypt$N$r$p$saltBase64$hashBase64
 * การเก็บพารามิเตอร์ไว้ในสตริงทำให้อนาคตปรับความแข็งแรงขึ้นได้โดยที่รหัสผ่านเดิมยังใช้ได้
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await withHashSlot(() => scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM,
  }));
  return [
    'scrypt', PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString('base64'), derived.toString('base64'),
  ].join('$');
}

/**
 * ตรวจรหัสผ่านกับค่าแฮชที่เก็บไว้
 * ใช้ timingSafeEqual เพื่อให้เวลาเปรียบเทียบคงที่เสมอ ผู้โจมตีจึงเดาค่าแฮชทีละไบต์
 * จากเวลาที่ระบบตอบกลับไม่ได้ (timing attack)
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived;
  try {
    derived = await withHashSlot(() => scrypt(password.normalize('NFKC'), salt, expected.length,
      { N, r, p, maxmem: MAX_MEM }));
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * แฮชหลอกสำหรับกรณีที่ไม่พบชื่อผู้ใช้
 *
 * ถ้าระบบตอบกลับทันทีเมื่อไม่พบชื่อผู้ใช้ แต่ใช้เวลา 65 มิลลิวินาทีเมื่อพบ
 * ผู้โจมตีจะจับเวลาเพื่อไล่หาว่าชื่อผู้ใช้ใดมีอยู่จริงได้ (user enumeration)
 * การเรียกฟังก์ชันนี้ทำให้ทั้งสองกรณีใช้เวลาใกล้เคียงกัน
 */
export async function fakeVerify(password) {
  const salt = randomBytes(16);
  try {
    await withHashSlot(() => scrypt(String(password ?? '').normalize('NFKC'), salt, PARAMS.keylen, {
      N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAX_MEM,
    }));
  } catch {
    /* ไม่ต้องทำอะไร จุดประสงค์คือให้เสียเวลาเท่ากัน */
  }
  return false;
}
