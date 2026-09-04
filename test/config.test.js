/**
 * ทดสอบการอ่านค่าตั้งค่าจาก environment
 *
 * ต้องรันเป็นโปรเซสแยกทุกครั้ง เพราะ config.js อ่าน env ตอน import เพียงครั้งเดียว
 * (เป็น singleton) จึงเปลี่ยนค่าแล้ว import ซ้ำในโปรเซสเดิมไม่ได้
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** โหลด config ในโปรเซสใหม่ด้วย env ที่กำหนด แล้วคืนค่าที่ได้ */
function loadConfig(env) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sp-config-'));
  try {
    const output = execFileSync(process.execPath, [
      '--no-warnings',
      '-e',
      "import('./server/config.js').then(({ config }) => console.log(JSON.stringify({"
      + ' appOrigin: config.appOrigin, secureCookies: config.secureCookies, trustProxy: config.trustProxy'
      + ' })));',
    ], {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SESSION_SECRET: 'test-secret-that-is-long-enough-for-config-1234',
        DATA_DIR: dataDir,
        ...env,
      },
    });
    return JSON.parse(output.trim().split('\n').pop());
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('การหา origin ของเว็บสำหรับตรวจ CSRF', () => {
  test('ใช้ APP_ORIGIN ที่ตั้งเองก่อนเสมอ', () => {
    const config = loadConfig({
      APP_ORIGIN: 'https://ตั้งเอง.example.com/',
      RENDER_EXTERNAL_URL: 'https://render.example.com',
      FLY_APP_NAME: 'flyapp',
    });
    assert.equal(config.appOrigin, 'https://ตั้งเอง.example.com', 'ต้องตัด / ท้ายออกด้วย');
  });

  test('ถ้าไม่ได้ตั้งเอง ใช้ค่าที่ Render ตั้งให้อัตโนมัติ', () => {
    const config = loadConfig({ RENDER_EXTERNAL_URL: 'https://study-planner.onrender.com' });
    assert.equal(config.appOrigin, 'https://study-planner.onrender.com');
  });

  test('รองรับ RENDER_EXTERNAL_HOSTNAME ที่เป็นชื่อโดเมนล้วน', () => {
    const config = loadConfig({ RENDER_EXTERNAL_HOSTNAME: 'study-planner.onrender.com' });
    assert.equal(config.appOrigin, 'https://study-planner.onrender.com');
  });

  test('ถ้าอยู่บน Fly.io ประกอบ URL จากชื่อแอปให้', () => {
    const config = loadConfig({ FLY_APP_NAME: 'study-planner-sk2569' });
    assert.equal(config.appOrigin, 'https://study-planner-sk2569.fly.dev');
  });

  test('ถ้าไม่มีข้อมูลเลย คืน null เพื่อให้ถอยไปใช้ header Host', () => {
    const config = loadConfig({});
    assert.equal(config.appOrigin, null);
  });

  test('โหมด production เปิดคุกกี้แบบ Secure และเชื่อ proxy โดยอัตโนมัติ', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    assert.equal(config.secureCookies, true);
    assert.equal(config.trustProxy, true);
  });

  test('โหมดพัฒนาไม่เปิด Secure เพราะยังไม่มี HTTPS', () => {
    const config = loadConfig({});
    assert.equal(config.secureCookies, false);
  });
});
