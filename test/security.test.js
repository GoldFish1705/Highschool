/**
 * ชุดทดสอบด้านความปลอดภัย
 *
 * ไฟล์นี้คือหลักฐานว่ามาตรการป้องกันที่อธิบายไว้ใน SECURITY.md ทำงานได้จริง
 * โดยจำลองการโจมตีแต่ละแบบแล้วตรวจว่าระบบปฏิเสธถูกต้องหรือไม่
 */
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, shutdown, baseUrl } from './helper.js';

const { sql } = await import('../server/db.js');
const { RateLimiter } = await import('../server/security/ratelimit.js');
const { hashPassword, verifyPassword, validatePasswordStrength } = await import('../server/security/password.js');

after(shutdown);

/** สร้างผู้ใช้พร้อมข้อมูลตัวอย่าง 1 ชุด ไว้ใช้ทดสอบ */
async function makeUserWithData(username) {
  const client = createClient();
  await client.register(username);
  const subjects = await client.get('/api/subjects');
  const subjectId = subjects.body.subjects[0].id;

  const plan = await client.post('/api/plans', {
    subjectId, title: 'แผนส่วนตัว', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
  });
  const goal = await client.post('/api/goals', {
    title: 'เป้าหมายส่วนตัว', goalType: 'short', targetValue: 5, targetUnit: 'hours',
  });

  return { client, subjectId, planId: plan.body.plan.id, goalId: goal.body.goal.id };
}

describe('การป้องกัน CSRF', () => {
  test('คำขอที่ไม่มี CSRF token ถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('csrf1');

    const response = await client.post('/api/plans', {
      title: 'แอบสร้าง', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    }, { csrf: null });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /CSRF/);
  });

  test('CSRF token ผิดถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('csrf2');

    // header ของ HTTP ส่งได้เฉพาะอักขระ ASCII จึงใช้ token ปลอมแบบสุ่มเหมือนที่ผู้โจมตีจริงจะเดา
    const response = await client.post('/api/plans', {
      title: 'แอบสร้าง', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    }, { csrf: 'aGVsbG8td29ybGQtZmFrZS1jc3JmLXRva2VuLTEyMzQ1Njc4OTA' });

    assert.equal(response.status, 403);
  });

  test('คำขอจากเว็บไซต์อื่น (Origin ต่างโดเมน) ถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('csrf3');

    const response = await client.post('/api/plans', {
      title: 'แอบสร้าง', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    }, { origin: 'https://evil.example.com' });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /origin/i);
  });

  test('คำขอที่ไม่มีทั้ง Origin และ Referer ถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('csrf4');

    const response = await client.post('/api/plans', {
      title: 'แอบสร้าง', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    }, { origin: null });

    assert.equal(response.status, 403);
  });

  test('คำขอแบบอ่านอย่างเดียว (GET) ไม่ต้องใช้ CSRF token', async () => {
    const client = createClient();
    await client.register('csrf5');
    const response = await client.get('/api/plans', { origin: null });
    assert.equal(response.status, 200);
  });
});

describe('การป้องกันการเข้าถึงข้อมูลของผู้อื่น (IDOR)', () => {
  test('ผู้ใช้ B เปิดดู แก้ไข หรือลบแผนของผู้ใช้ A ไม่ได้', async () => {
    const alice = await makeUserWithData('alice');
    const bob = createClient();
    await bob.register('bob');

    // เจ้าของเปิดได้ปกติ
    assert.equal((await alice.client.get(`/api/plans/${alice.planId}`)).status, 200);

    // คนอื่นต้องได้ 404 (ไม่ใช่ 403) เพื่อไม่ให้รู้ด้วยซ้ำว่ามีข้อมูลนี้อยู่จริง
    assert.equal((await bob.get(`/api/plans/${alice.planId}`)).status, 404);
    assert.equal((await bob.patch(`/api/plans/${alice.planId}/status`, { status: 'done' })).status, 404);
    assert.equal((await bob.delete(`/api/plans/${alice.planId}`)).status, 404);

    // ข้อมูลของ A ต้องไม่ถูกแตะต้อง
    const stillThere = await alice.client.get(`/api/plans/${alice.planId}`);
    assert.equal(stillThere.status, 200);
    assert.equal(stillThere.body.plan.status, 'planned');
  });

  test('ผู้ใช้ B แก้ไขหรือลบเป้าหมายของผู้ใช้ A ไม่ได้', async () => {
    const alice = await makeUserWithData('alice2');
    const bob = createClient();
    await bob.register('bob2');

    assert.equal((await bob.patch(`/api/goals/${alice.goalId}/progress`, { currentValue: 99 })).status, 404);
    assert.equal((await bob.delete(`/api/goals/${alice.goalId}`)).status, 404);
  });

  test('ผู้ใช้ B แก้ไขหรือลบรายวิชาของผู้ใช้ A ไม่ได้', async () => {
    const alice = await makeUserWithData('alice3');
    const bob = createClient();
    await bob.register('bob3');

    assert.equal((await bob.patch(`/api/subjects/${alice.subjectId}`, { name: 'ยึดวิชานี้', color: '#ff0000' })).status, 404);
    assert.equal((await bob.delete(`/api/subjects/${alice.subjectId}`)).status, 404);
  });

  test('ผูกแผนเข้ากับรายวิชาของผู้ใช้อื่นไม่ได้', async () => {
    const alice = await makeUserWithData('alice4');
    const bob = createClient();
    await bob.register('bob4');

    const response = await bob.post('/api/plans', {
      subjectId: alice.subjectId, title: 'ยืมวิชาคนอื่น',
      planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    });
    assert.equal(response.status, 400);
  });

  test('ผู้ใช้ B เพิกถอน session ของผู้ใช้ A ไม่ได้', async () => {
    const alice = await makeUserWithData('alice5');
    const bob = createClient();
    await bob.register('bob5');

    const sessions = await alice.client.get('/api/auth/sessions');
    const aliceSessionId = sessions.body.sessions[0].id;

    assert.equal((await bob.delete(`/api/auth/sessions/${aliceSessionId}`)).status, 404);
    // A ต้องยังใช้งานได้ตามปกติ
    assert.equal((await alice.client.get('/api/session')).body.authenticated, true);
  });

  test('รายการที่ดึงมาต้องมีเฉพาะข้อมูลของตัวเอง', async () => {
    await makeUserWithData('alice6');
    const bob = createClient();
    await bob.register('bob6');

    const plans = await bob.get('/api/plans');
    assert.equal(plans.body.plans.length, 0);

    const goals = await bob.get('/api/goals');
    assert.equal(goals.body.goals.length, 0);
  });
});

describe('การยืนยันตัวตนและการเดารหัสผ่าน', () => {
  test('เข้าถึง API โดยไม่เข้าสู่ระบบต้องได้ 401', async () => {
    const client = createClient();
    await client.get('/api/csrf');
    assert.equal((await client.get('/api/plans')).status, 401);
    assert.equal((await client.get('/api/goals')).status, 401);
    assert.equal((await client.get('/api/stats/overview')).status, 401);
  });

  test('ไม่บอกใบ้ว่ามีบัญชีนี้อยู่จริงหรือไม่', async () => {
    const client = createClient();
    await client.register('realuser');
    await client.post('/api/auth/logout');
    await client.get('/api/csrf');

    const wrongPassword = await client.post('/api/auth/login', {
      username: 'realuser', password: 'รหัสผ่านผิดแน่นอน123',
    });
    const noSuchUser = await client.post('/api/auth/login', {
      username: 'ghostuser', password: 'รหัสผ่านผิดแน่นอน123',
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(noSuchUser.status, 401);
    assert.equal(wrongPassword.body.error, noSuchUser.body.error,
      'ข้อความต้องเหมือนกัน มิฉะนั้นผู้โจมตีจะไล่หาได้ว่าชื่อผู้ใช้ใดมีอยู่จริง');
  });

  test('บัญชีถูกล็อกชั่วคราวเมื่อเดารหัสผ่านผิดหลายครั้ง', async () => {
    const client = createClient();
    await client.register('lockme');
    await client.post('/api/auth/logout');
    await client.get('/api/csrf');

    let lockedStatus = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await client.post('/api/auth/login', {
        username: 'lockme', password: `เดาผิดครั้งที่ ${attempt}`,
      });
      if (response.status === 429) {
        lockedStatus = response;
        break;
      }
    }

    assert.ok(lockedStatus, 'ต้องถูกล็อกหลังเดาผิดหลายครั้ง');
    assert.match(lockedStatus.body.error, /หลายครั้ง/);

    // แม้ใส่รหัสผ่านถูกก็ต้องยังเข้าไม่ได้ระหว่างถูกล็อก
    const correct = await client.post('/api/auth/login', {
      username: 'lockme', password: 'StudyPlan2569!ok',
    });
    assert.equal(correct.status, 429);
  });

  test('รหัสผ่านที่อ่อนแอถูกปฏิเสธ', async () => {
    for (const weak of ['123456', 'password12', 'aaaaaaaaaa', 'weakuser1']) {
      const client = createClient();
      await client.get('/api/csrf');
      const response = await client.post('/api/auth/register', {
        username: 'weakuser1', displayName: 'ทดสอบ', password: weak,
      });
      assert.equal(response.status, 400, `รหัสผ่าน "${weak}" ต้องถูกปฏิเสธ`);
    }
  });

  test('ฟังก์ชันตรวจความแข็งแรงของรหัสผ่านทำงานถูกต้อง', () => {
    assert.ok(validatePasswordStrength('สั้นไป', 'user').length > 0);
    assert.ok(validatePasswordStrength('aaaaaaaaaaaa', 'user').length > 0, 'อักขระซ้ำกันหมดต้องไม่ผ่าน');
    assert.ok(validatePasswordStrength('somchai12345', 'somchai').length > 0, 'ห้ามมีชื่อผู้ใช้อยู่ในรหัสผ่าน');
    assert.ok(validatePasswordStrength('onlylowercase', 'user').length > 0, 'ต้องผสมอย่างน้อย 2 แบบ');
    assert.equal(validatePasswordStrength('StudyPlan2569!ok', 'somchai').length, 0);
  });

  test('รหัสผ่านเดียวกันให้ค่าแฮชต่างกัน และตรวจสอบกลับได้', async () => {
    const first = await hashPassword('StudyPlan2569!ok');
    const second = await hashPassword('StudyPlan2569!ok');

    assert.notEqual(first, second, 'ต้องสุ่ม salt ใหม่ทุกครั้ง');
    assert.ok(first.startsWith('scrypt$'));
    assert.ok(await verifyPassword('StudyPlan2569!ok', first));
    assert.ok(await verifyPassword('StudyPlan2569!ok', second));
    assert.equal(await verifyPassword('รหัสผ่านผิด', first), false);
    assert.equal(await verifyPassword('อะไรก็ตาม', 'ค่าแฮชที่ผิดรูปแบบ'), false);
  });

  test('ฐานข้อมูลไม่เก็บรหัสผ่านและ session token แบบอ่านได้', async () => {
    const client = createClient();
    await client.register('nosecret', 'SecretPass2569!xyz');

    const user = sql('SELECT password_hash FROM users WHERE username = ?').get('nosecret');
    assert.ok(!user.password_hash.includes('SecretPass2569!xyz'), 'ต้องไม่มีรหัสผ่านตัวจริงในฐานข้อมูล');
    assert.ok(user.password_hash.startsWith('scrypt$'));

    const cookieToken = decodeURIComponent(client.cookies.get('sp_session'));
    const stored = sql('SELECT token_hash FROM sessions').all();
    assert.ok(stored.length > 0);
    assert.ok(stored.every((row) => row.token_hash !== cookieToken),
      'ต้องเก็บเฉพาะค่าแฮชของ token ไม่ใช่ token ตัวจริง');
  });

  test('session ที่ถูกเพิกถอนแล้วใช้ต่อไม่ได้', async () => {
    const client = createClient();
    await client.register('revokeme');
    assert.equal((await client.get('/api/session')).body.authenticated, true);

    await client.post('/api/auth/logout');
    assert.equal((await client.get('/api/session')).body.authenticated, false);
    assert.equal((await client.get('/api/plans')).status, 401);
  });

  test('คุกกี้ session ตั้ง HttpOnly และ SameSite=Strict', async () => {
    const client = createClient();
    const { result } = await client.register('cookiecheck');
    const cookies = result.headers.getSetCookie();
    const sessionCookie = cookies.find((line) => line.startsWith('sp_session='));

    assert.ok(sessionCookie, 'ต้องมีคุกกี้ session');
    assert.match(sessionCookie, /HttpOnly/, 'JavaScript ต้องอ่านคุกกี้นี้ไม่ได้');
    assert.match(sessionCookie, /SameSite=Strict/, 'ต้องไม่ถูกส่งไปกับคำขอจากเว็บอื่น');

    const csrfCookie = cookies.find((line) => line.startsWith('sp_csrf='));
    assert.ok(csrfCookie);
    assert.ok(!/HttpOnly/.test(csrfCookie), 'คุกกี้ CSRF ต้องอ่านได้จาก JavaScript ของหน้าเว็บเอง');
  });
});

describe('การตรวจสอบข้อมูลนำเข้าและการป้องกัน XSS / SQL injection', () => {
  test('ข้อความที่มีสคริปต์ถูกเก็บเป็นข้อความธรรมดา ไม่ถูกดัดแปลง', async () => {
    const client = createClient();
    await client.register('xsstester');

    const payload = '<script>alert("xss")</script>';
    const created = await client.post('/api/plans', {
      title: payload, planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    });

    assert.equal(created.status, 201);
    // เก็บเหมือนที่ผู้ใช้พิมพ์มาทุกตัวอักษร ความปลอดภัยเกิดตอนแสดงผล
    // ซึ่งหน้าเว็บใช้ textContent เสมอ (ดู public/js/dom.js) จึงไม่ถูกรันเป็นโค้ด
    assert.equal(created.body.plan.title, payload);

    // และตอบกลับเป็น JSON ไม่ใช่ HTML เบราว์เซอร์จึงไม่ตีความเป็นหน้าเว็บ
    assert.match(created.headers.get('content-type'), /application\/json/);
    assert.equal(created.headers.get('x-content-type-options'), 'nosniff');
  });

  test('ข้อความที่มีรูปแบบ SQL injection ถูกเก็บเป็นข้อความ ไม่ถูกนำไปรัน', async () => {
    const client = createClient();
    await client.register('sqltester');

    const payload = "'; DROP TABLE study_plans; --";
    const created = await client.post('/api/plans', {
      title: payload, planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.plan.title, payload);

    // ตารางต้องยังอยู่ครบและอ่านข้อมูลได้ตามปกติ
    const plans = await client.get('/api/plans');
    assert.equal(plans.status, 200);
    assert.equal(plans.body.plans.length, 1);
  });

  test('field แปลกปลอมที่ไม่ได้ประกาศใน schema ถูกทิ้ง', async () => {
    const client = createClient();
    await client.register('extrafield');

    const created = await client.post('/api/plans', {
      title: 'แผนปกติ', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
      userId: 999999, id: 424242, completedAt: '2000-01-01',
    });

    assert.equal(created.status, 201);
    assert.notEqual(created.body.plan.id, 424242, 'ต้องไม่ยอมให้กำหนด id เอง');
    assert.equal(created.body.plan.completedAt, null);
  });

  test('การโจมตีแบบ prototype pollution ไม่สำเร็จ', async () => {
    const client = createClient();
    await client.register('polluter');

    await client.post('/api/plans',
      '{"title":"ปกติ","planDate":"2026-09-04","startTime":"18:00","endTime":"19:00","__proto__":{"polluted":true}}');

    assert.equal({}.polluted, undefined, 'prototype ของ Object ต้องไม่ถูกแก้');
  });

  test('body ที่ใหญ่เกินกำหนดถูกปฏิเสธด้วย 413', async () => {
    const client = createClient();
    await client.register('bigbody');

    const huge = JSON.stringify({ title: 'ก'.repeat(100000), planDate: '2026-09-04', startTime: '18:00', endTime: '19:00' });
    const response = await client.post('/api/plans', huge);
    assert.equal(response.status, 413);
  });

  test('Content-Type ที่ไม่ใช่ JSON ถูกปฏิเสธด้วย 415', async () => {
    const client = createClient();
    await client.register('wrongtype');

    const response = await client.post('/api/plans', 'title=แผน&planDate=2026-09-04',
      { contentType: 'application/x-www-form-urlencoded' });
    assert.equal(response.status, 415);
  });

  test('JSON ผิดรูปแบบถูกปฏิเสธด้วย 400', async () => {
    const client = createClient();
    await client.register('badjson');
    const response = await client.post('/api/plans', '{"title": ไม่ใช่ json}');
    assert.equal(response.status, 400);
  });

  test('ค่าที่เกินช่วงที่กำหนดถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('outofrange');

    assert.equal((await client.post('/api/goals', {
      title: 'ทดสอบ', goalType: 'short', targetValue: 999999, targetUnit: 'hours',
    })).status, 400);

    assert.equal((await client.post('/api/goals', {
      title: 'ทดสอบ', goalType: 'short', targetValue: 5, targetUnit: 'ปี',
    })).status, 400);

    assert.equal((await client.post('/api/plans', {
      title: 'ท'.repeat(200), planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    })).status, 400);
  });
});

describe('การเสิร์ฟไฟล์และ security headers', () => {
  test('การพยายามอ่านไฟล์นอกโฟลเดอร์ public ถูกปฏิเสธ', async () => {
    const attempts = [
      '/../server/config.js',
      '/../../etc/passwd',
      '/css/../../server/db.js',
      '/%2e%2e/server/config.js',
      '/..%2fserver%2fconfig.js',
      '/....//server/config.js',
    ];

    for (const path of attempts) {
      const response = await fetch(baseUrl + path, { redirect: 'manual' });
      const text = await response.text();
      assert.ok(response.status === 404 || response.status === 400,
        `${path} ต้องไม่สำเร็จ แต่ได้ ${response.status}`);
      assert.ok(!text.includes('sessionSecret') && !text.includes('DatabaseSync'),
        `${path} ต้องไม่คืนซอร์สโค้ดของเซิร์ฟเวอร์`);
    }
  });

  test('ไฟล์ซ่อนและนามสกุลที่ไม่อนุญาตเข้าถึงไม่ได้', async () => {
    for (const path of ['/.env', '/.git/config', '/data/study-planner.db']) {
      const response = await fetch(baseUrl + path);
      assert.equal(response.status, 404, `${path} ต้องเข้าถึงไม่ได้`);
    }
  });

  test('ไฟล์หน้าเว็บปกติเสิร์ฟได้', async () => {
    const response = await fetch(`${baseUrl}/css/app.css`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/css/);
  });

  test('security headers ครบถ้วนทั้งหน้าเว็บและ API', async () => {
    for (const path of ['/login', '/api/csrf']) {
      const response = await fetch(baseUrl + path);
      const csp = response.headers.get('content-security-policy');

      assert.ok(csp, `${path} ต้องมี CSP`);
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.ok(!csp.includes('unsafe-inline'), 'CSP ต้องไม่อนุญาต unsafe-inline');
      assert.ok(!csp.includes('unsafe-eval'), 'CSP ต้องไม่อนุญาต unsafe-eval');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.match(csp, /base-uri 'none'/);

      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('referrer-policy'), 'same-origin');
      assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.ok(response.headers.get('permissions-policy'));
      assert.equal(response.headers.get('x-powered-by'), null, 'ต้องไม่บอกว่าใช้เทคโนโลยีอะไร');
    }
  });

  test('เส้นทางที่ไม่มีอยู่จริงตอบ 404 และ method ที่ไม่รองรับตอบ 405', async () => {
    const client = createClient();
    await client.register('routetest');

    assert.equal((await client.get('/api/ไม่มีเส้นทางนี้')).status, 404);

    const notAllowed = await client.request('DELETE', '/api/stats/overview', {});
    assert.equal(notAllowed.status, 405);
    assert.ok(notAllowed.headers.get('allow').includes('GET'));
  });
});

describe('การจำกัดอัตราการเรียกใช้', () => {
  test('ถังโทเคนปล่อยผ่านตามโควตาแล้วปฏิเสธส่วนเกิน', () => {
    const limiter = new RateLimiter({ capacity: 3, windowMs: 60_000 });

    assert.equal(limiter.consume('ผู้ใช้ก').allowed, true);
    assert.equal(limiter.consume('ผู้ใช้ก').allowed, true);
    assert.equal(limiter.consume('ผู้ใช้ก').allowed, true);

    const blocked = limiter.consume('ผู้ใช้ก');
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec > 0);

    // คนละ key ต้องไม่ถูกกระทบกัน
    assert.equal(limiter.consume('ผู้ใช้ข').allowed, true);
  });

  test('จำนวน key ที่จำได้ถูกจำกัด ทำให้หน่วยความจำไม่บวมแม้ถูกยิงด้วย IP ปลอมจำนวนมาก', () => {
    const limiter = new RateLimiter({ capacity: 5, windowMs: 60_000, maxEntries: 100 });

    for (let index = 0; index < 5000; index += 1) {
      limiter.consume(`ip-ปลอม-${index}`);
    }

    assert.ok(limiter.buckets.size <= 100,
      `จำนวนรายการต้องไม่เกิน 100 แต่มี ${limiter.buckets.size}`);
  });
});
