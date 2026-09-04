/**
 * ทดสอบการทำงานหลักของระบบ: บัญชีผู้ใช้ แผนการอ่าน เป้าหมาย และการคำนวณสถิติ
 */
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, shutdown } from './helper.js';

after(shutdown);

describe('บัญชีผู้ใช้', () => {
  test('สมัครสมาชิก แล้วเข้าสู่ระบบอัตโนมัติ', async () => {
    const client = createClient();
    const { result } = await client.register('somchai');

    assert.equal(result.status, 201);
    assert.equal(result.body.user.username, 'somchai');

    const session = await client.get('/api/session');
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.user.displayName, 'นักเรียน somchai');
  });

  test('สมัครสมาชิกแล้วได้รายวิชาเริ่มต้น 5 วิชา', async () => {
    const client = createClient();
    await client.register('malee');

    const subjects = await client.get('/api/subjects');
    assert.equal(subjects.status, 200);
    assert.equal(subjects.body.subjects.length, 5);
    assert.ok(subjects.body.subjects.some((subject) => subject.name === 'คณิตศาสตร์'));
  });

  test('ชื่อผู้ใช้ซ้ำถูกปฏิเสธ', async () => {
    const first = createClient();
    await first.register('duplicate');

    const second = createClient();
    const { result } = await second.register('duplicate');
    assert.equal(result.status, 409);
  });

  test('ชื่อผู้ใช้ผิดรูปแบบถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.get('/api/csrf');
    const response = await client.post('/api/auth/register', {
      username: 'ชื่อไทย', displayName: 'ทดสอบ', password: 'StudyPlan2569!ok',
    });
    assert.equal(response.status, 400);
  });

  test('เข้าสู่ระบบและออกจากระบบได้', async () => {
    const client = createClient();
    await client.register('preecha');
    await client.post('/api/auth/logout');

    let session = await client.get('/api/session');
    assert.equal(session.body.authenticated, false);

    await client.get('/api/csrf');
    const login = await client.post('/api/auth/login', {
      username: 'preecha', password: 'StudyPlan2569!ok',
    });
    assert.equal(login.status, 200);

    session = await client.get('/api/session');
    assert.equal(session.body.authenticated, true);
  });

  test('เปลี่ยนรหัสผ่านแล้วอุปกรณ์อื่นถูกเตะออกจากระบบ', async () => {
    const deviceA = createClient();
    await deviceA.register('nattapong');

    // เข้าสู่ระบบจากอีกเครื่องหนึ่ง
    const deviceB = createClient();
    await deviceB.get('/api/csrf');
    const loginB = await deviceB.post('/api/auth/login', {
      username: 'nattapong', password: 'StudyPlan2569!ok',
    });
    assert.equal(loginB.status, 200);
    assert.equal((await deviceB.get('/api/session')).body.authenticated, true);

    // เครื่อง A เปลี่ยนรหัสผ่าน
    const changed = await deviceA.post('/api/auth/change-password', {
      currentPassword: 'StudyPlan2569!ok', newPassword: 'BrandNewPass2569#',
    });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.revokedSessions >= 1);

    // เครื่อง A ยังใช้งานได้ แต่เครื่อง B ต้องหลุดจากระบบ
    assert.equal((await deviceA.get('/api/session')).body.authenticated, true);
    assert.equal((await deviceB.get('/api/session')).body.authenticated, false);
  });

  test('รหัสผ่านปัจจุบันผิด เปลี่ยนรหัสผ่านไม่ได้', async () => {
    const client = createClient();
    await client.register('wichai');
    const response = await client.post('/api/auth/change-password', {
      currentPassword: 'ผิดแน่นอน123', newPassword: 'BrandNewPass2569#',
    });
    assert.equal(response.status, 401);
  });
});

describe('แผนการอ่านหนังสือ', () => {
  async function setup(username) {
    const client = createClient();
    await client.register(username);
    const subjects = await client.get('/api/subjects');
    return { client, subjectId: subjects.body.subjects[0].id };
  }

  test('เพิ่ม แก้ไข และลบแผนได้ครบวงจร', async () => {
    const { client, subjectId } = await setup('planner1');

    const created = await client.post('/api/plans', {
      subjectId, title: 'ตรีโกณมิติ บทที่ 3', planDate: '2026-09-04',
      startTime: '18:00', endTime: '19:30', note: 'ทำโจทย์ท้ายบท',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.plan.minutes, 90, 'ต้องคำนวณระยะเวลาเป็น 90 นาที');
    assert.equal(created.body.plan.status, 'planned');

    const id = created.body.plan.id;

    const updated = await client.patch(`/api/plans/${id}`, {
      subjectId, title: 'ตรีโกณมิติ บทที่ 3 (แก้ไข)', planDate: '2026-09-05',
      startTime: '19:00', endTime: '20:00', status: 'planned',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.plan.title, 'ตรีโกณมิติ บทที่ 3 (แก้ไข)');
    assert.equal(updated.body.plan.minutes, 60);

    const done = await client.patch(`/api/plans/${id}/status`, { status: 'done' });
    assert.equal(done.status, 200);
    assert.equal(done.body.plan.status, 'done');
    assert.ok(done.body.plan.completedAt, 'ต้องบันทึกเวลาที่ทำสำเร็จ');

    assert.equal((await client.delete(`/api/plans/${id}`)).status, 200);
    assert.equal((await client.get(`/api/plans/${id}`)).status, 404);
  });

  test('เวลาสิ้นสุดก่อนเวลาเริ่ม ถูกปฏิเสธ', async () => {
    const { client, subjectId } = await setup('planner2');
    const response = await client.post('/api/plans', {
      subjectId, title: 'ทดสอบ', planDate: '2026-09-04', startTime: '20:00', endTime: '19:00',
    });
    assert.equal(response.status, 400);
    assert.ok(response.body.details.some((line) => line.includes('เวลาสิ้นสุด')));
  });

  test('วันที่ไม่มีอยู่จริงถูกปฏิเสธ', async () => {
    const { client, subjectId } = await setup('planner3');
    const response = await client.post('/api/plans', {
      subjectId, title: 'ทดสอบ', planDate: '2026-02-31', startTime: '18:00', endTime: '19:00',
    });
    assert.equal(response.status, 400);
  });

  test('กรองแผนตามช่วงวันที่ได้', async () => {
    const { client, subjectId } = await setup('planner4');
    for (const date of ['2026-09-01', '2026-09-05', '2026-09-20']) {
      await client.post('/api/plans', {
        subjectId, title: `อ่านวันที่ ${date}`, planDate: date, startTime: '18:00', endTime: '19:00',
      });
    }
    const ranged = await client.get('/api/plans?from=2026-09-01&to=2026-09-10');
    assert.equal(ranged.body.plans.length, 2);
  });
});

describe('เป้าหมายการเรียน', () => {
  test('สร้างเป้าหมายและอัปเดตความคืบหน้าจนสำเร็จ', async () => {
    const client = createClient();
    await client.register('goalsetter');

    const created = await client.post('/api/goals', {
      title: 'อ่านคณิตให้ครบ 20 ชั่วโมง', goalType: 'long',
      targetValue: 20, currentValue: 5, targetUnit: 'hours', dueDate: '2026-10-31',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.goal.percent, 25);
    assert.equal(created.body.goal.status, 'active');

    const id = created.body.goal.id;

    const partial = await client.patch(`/api/goals/${id}/progress`, { currentValue: 10 });
    assert.equal(partial.body.goal.percent, 50);
    assert.equal(partial.body.goal.status, 'active');

    // ทำครบเป้าหมายแล้วต้องเปลี่ยนสถานะเป็นสำเร็จอัตโนมัติ
    const complete = await client.patch(`/api/goals/${id}/progress`, { currentValue: 20 });
    assert.equal(complete.body.goal.percent, 100);
    assert.equal(complete.body.goal.status, 'done');

    assert.equal((await client.delete(`/api/goals/${id}`)).status, 200);
  });

  test('ประเภทเป้าหมายที่ไม่รู้จักถูกปฏิเสธ', async () => {
    const client = createClient();
    await client.register('goalsetter2');
    const response = await client.post('/api/goals', {
      title: 'ทดสอบ', goalType: 'forever', targetValue: 5, targetUnit: 'hours',
    });
    assert.equal(response.status, 400);
  });
});

describe('การคำนวณสถิติความก้าวหน้า', () => {
  test('คำนวณเปอร์เซ็นต์ เวลา และวันต่อเนื่องได้ถูกต้อง', async () => {
    const client = createClient();
    await client.register('statistician');
    const subjects = await client.get('/api/subjects');
    const subjectId = subjects.body.subjects[0].id;

    // สร้างแผน 4 รายการ อ่านสำเร็จ 2 รายการ (90 + 60 = 150 นาที)
    const rows = [
      ['2026-09-04', '18:00', '19:30', 'done'],    // 90 นาที
      ['2026-09-04', '20:00', '21:00', 'done'],    // 60 นาที
      ['2026-09-03', '18:00', '19:00', 'planned'], // 60 นาที
      ['2026-09-02', '18:00', '19:00', 'skipped'], // 60 นาที
    ];
    for (const [planDate, startTime, endTime, status] of rows) {
      const response = await client.post('/api/plans', {
        subjectId, title: `อ่าน ${planDate} ${startTime}`, planDate, startTime, endTime, status,
      });
      assert.equal(response.status, 201);
    }

    const progress = await client.get('/api/stats/progress?date=2026-09-04&days=30');
    assert.equal(progress.status, 200);

    const { overall } = progress.body;
    assert.equal(overall.total, 4);
    assert.equal(overall.done, 2);
    assert.equal(overall.planned, 1);
    assert.equal(overall.skipped, 1);
    assert.equal(overall.plannedMinutes, 270, 'เวลารวมที่วางแผนไว้ = 90+60+60+60');
    assert.equal(overall.doneMinutes, 150, 'เวลาที่อ่านจริง = 90+60');
    assert.equal(overall.completionRate, 50, 'ทำสำเร็จ 2 จาก 4 = 50%');

    // แยกตามรายวิชา
    assert.equal(progress.body.bySubject.length, 1);
    assert.equal(progress.body.bySubject[0].doneMinutes, 150);

    // กราฟรายวันต้องมีข้อมูลครบทุกวันในช่วง แม้วันที่ไม่มีแผน
    assert.equal(progress.body.daily.length, 30);
    const day4 = progress.body.daily.find((day) => day.date === '2026-09-04');
    assert.equal(day4.doneMinutes, 150);

    // อ่านสำเร็จเฉพาะวันที่ 4 จึงนับต่อเนื่องได้ 1 วัน
    assert.equal(progress.body.streak, 1);

    // ภาพรวมหน้าหลัก
    const overview = await client.get('/api/stats/overview?date=2026-09-04');
    assert.equal(overview.body.today.total, 2);
    assert.equal(overview.body.today.done, 2);
    assert.equal(overview.body.week.completionRate, 50);

    // หน้าสรุปผล ต้องเห็นแผนที่เลยกำหนดแล้วยังไม่ได้อ่าน
    const summary = await client.get('/api/stats/summary?date=2026-09-04&from=2026-09-01&to=2026-09-04');
    assert.equal(summary.body.totals.done, 2);
    assert.equal(summary.body.overdue.length, 1, 'แผนวันที่ 3 ยังไม่ได้อ่านและเลยกำหนดแล้ว');
    assert.equal(summary.body.overdue[0].planDate, '2026-09-03');
  });

  test('นับวันอ่านต่อเนื่องหลายวันได้', async () => {
    const client = createClient();
    await client.register('streaker');
    for (const planDate of ['2026-09-02', '2026-09-03', '2026-09-04']) {
      await client.post('/api/plans', {
        title: `อ่าน ${planDate}`, planDate, startTime: '18:00', endTime: '19:00', status: 'done',
      });
    }
    const progress = await client.get('/api/stats/progress?date=2026-09-04&days=30');
    assert.equal(progress.body.streak, 3);
  });
});

describe('รายวิชา', () => {
  test('เพิ่ม แก้ไข ลบ และห้ามชื่อซ้ำ', async () => {
    const client = createClient();
    await client.register('subjectowner');

    const created = await client.post('/api/subjects', { name: 'ฟิสิกส์', color: '#123456' });
    assert.equal(created.status, 201);

    const duplicate = await client.post('/api/subjects', { name: 'ฟิสิกส์', color: '#654321' });
    assert.equal(duplicate.status, 409);

    const badColor = await client.post('/api/subjects', { name: 'เคมี', color: 'สีแดง' });
    assert.equal(badColor.status, 400);

    const id = created.body.subject.id;
    const updated = await client.patch(`/api/subjects/${id}`, { name: 'ฟิสิกส์ ม.4', color: '#abcdef' });
    assert.equal(updated.body.subject.name, 'ฟิสิกส์ ม.4');

    assert.equal((await client.delete(`/api/subjects/${id}`)).status, 200);
  });

  test('ลบวิชาแล้วแผนยังอยู่ แต่กลายเป็นไม่ระบุวิชา', async () => {
    const client = createClient();
    await client.register('subjectowner2');
    const created = await client.post('/api/subjects', { name: 'ชีววิทยา', color: '#00aa55' });
    const subjectId = created.body.subject.id;

    const plan = await client.post('/api/plans', {
      subjectId, title: 'อ่านชีวะ', planDate: '2026-09-04', startTime: '18:00', endTime: '19:00',
    });
    const planId = plan.body.plan.id;

    await client.delete(`/api/subjects/${subjectId}`);

    const after = await client.get(`/api/plans/${planId}`);
    assert.equal(after.status, 200, 'แผนต้องไม่ถูกลบตามวิชาไปด้วย');
    assert.equal(after.body.plan.subjectId, null);
  });
});
