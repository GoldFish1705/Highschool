/**
 * การตั้งค่าระบบ อ่านจาก environment variable
 * ถ้าไม่ได้ตั้ง SESSION_SECRET ไว้ ระบบจะสุ่มสร้างให้เองแล้วเก็บไว้ที่ data/secret.key
 * (สิทธิ์ไฟล์ 0600 = อ่าน/เขียนได้เฉพาะเจ้าของ) เพื่อไม่ให้มีความลับฝังอยู่ในโค้ด
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ค่า env ${name} ต้องเป็นจำนวนเต็มที่ไม่ติดลบ`);
  }
  return value;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * โหลด session secret ตามลำดับความสำคัญ:
 *   1. env SESSION_SECRET (แนะนำสำหรับ production)
 *   2. ไฟล์ data/secret.key ที่เคยสร้างไว้
 *   3. สุ่มสร้างใหม่แล้วบันทึกลงไฟล์
 */
function loadSessionSecret(dataDir) {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) {
      throw new Error('SESSION_SECRET ต้องมีความยาวอย่างน้อย 32 ตัวอักษร');
    }
    return fromEnv;
  }

  const keyPath = path.join(dataDir, 'secret.key');
  if (existsSync(keyPath)) {
    const stored = readFileSync(keyPath, 'utf8').trim();
    if (stored.length >= 32) return stored;
  }

  const generated = randomBytes(48).toString('base64url');
  writeFileSync(keyPath, generated + '\n', { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* ระบบไฟล์บางแบบไม่รองรับการตั้งสิทธิ์ ข้ามไปได้ */
  }
  return generated;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

/**
 * APP_ORIGIN คือ origin จริงของเว็บไซต์ เช่น https://study-planner.fly.dev
 * ใช้ตรวจ header Origin/Referer เพื่อกัน CSRF
 * ถ้าไม่ได้ตั้งไว้ ระบบจะเทียบกับ header Host ของ request แทน
 */
const appOrigin = (process.env.APP_ORIGIN || '').replace(/\/+$/, '') || null;

export const config = {
  rootDir,
  dataDir,
  publicDir: path.join(rootDir, 'public'),
  databasePath: path.join(dataDir, 'study-planner.db'),
  nodeEnv,
  isProduction,
  host: process.env.HOST || '0.0.0.0',
  port: envInt('PORT', 3000),
  appOrigin,

  // เมื่ออยู่หลัง reverse proxy (Fly.io, Render, Nginx) ต้องเปิดเพื่ออ่าน IP จริงจาก X-Forwarded-For
  trustProxy: envBool('TRUST_PROXY', isProduction),

  // ตั้ง Secure บนคุกกี้ก็ต่อเมื่อเสิร์ฟผ่าน HTTPS จริง มิฉะนั้นเบราว์เซอร์จะทิ้งคุกกี้ตอน dev
  secureCookies: envBool('SECURE_COOKIES', isProduction),

  sessionSecret: loadSessionSecret(dataDir),

  // อายุ session: หมดอายุเมื่อไม่ใช้งาน 7 วัน และหมดอายุเด็ดขาดที่ 30 วัน
  sessionIdleMs: envInt('SESSION_IDLE_DAYS', 7) * 24 * 60 * 60 * 1000,
  sessionAbsoluteMs: envInt('SESSION_ABSOLUTE_DAYS', 30) * 24 * 60 * 60 * 1000,

  // ปรับความเข้มของ rate limit ได้ผ่าน env
  // ค่าเริ่มต้นเหมาะกับการใช้งานจริง ส่วนชุดทดสอบจะตั้งให้สูงขึ้นเพื่อไม่ให้ติดลิมิตระหว่างทดสอบ
  globalRateCapacity: envInt('GLOBAL_RATE_CAPACITY', 240),
  authRateCapacity: envInt('AUTH_RATE_CAPACITY', 10),

  maxBodyBytes: envInt('MAX_BODY_BYTES', 64 * 1024),
  requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 15000),

  // จำกัดจำนวนเหตุการณ์ความปลอดภัยที่เก็บต่อผู้ใช้ เพื่อไม่ให้ฐานข้อมูลโตไม่จำกัด
  maxSecurityEventsPerUser: envInt('MAX_SECURITY_EVENTS', 100),
};

export const cookieNames = config.secureCookies
  // __Host- prefix บังคับให้เบราว์เซอร์ยอมรับเฉพาะคุกกี้ที่ Secure, Path=/ และไม่มี Domain
  // ทำให้ subdomain อื่นเขียนทับคุกกี้เราไม่ได้
  ? { session: '__Host-sp_session', csrf: '__Host-sp_csrf' }
  : { session: 'sp_session', csrf: 'sp_csrf' };
