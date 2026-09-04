/**
 * เส้นทางสรุปความก้าวหน้า
 * ตรงกับขอบเขตข้อ 1.3.2.3 ของโครงงาน และข้อเสนอแนะ 5.3.2 ข้อ 4 กับ 6
 * (แสดงความก้าวหน้าเป็นเปอร์เซ็นต์/กราฟ และสรุปว่าอ่านวิชาใดไปแล้วบ้าง)
 *
 * หมายเหตุเรื่องเขตเวลา: เซิร์ฟเวอร์อาจตั้งเวลาเป็น UTC แต่ผู้ใช้อยู่ไทย (UTC+7)
 * จึงให้ฝั่ง client ส่งวันที่ของตัวเองมาทาง query ?date= เพื่อให้คำว่า "วันนี้" ตรงกับผู้ใช้จริง
 */
import { sql } from '../db.js';
import { HttpError } from '../http/respond.js';
import { validate } from '../security/validate.js';

/** คำนวณจำนวนนาทีของแผนจาก start_time / end_time ภายใน SQL */
const MINUTES = `
  ((CAST(substr(p.end_time, 1, 2) AS INTEGER) * 60 + CAST(substr(p.end_time, 4, 2) AS INTEGER))
 - (CAST(substr(p.start_time, 1, 2) AS INTEGER) * 60 + CAST(substr(p.start_time, 4, 2) AS INTEGER)))
`;

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** อ่านวันที่อ้างอิงจาก query โดยผ่านการตรวจสอบรูปแบบก่อนเสมอ */
function referenceDate(ctx) {
  const raw = ctx.query.get('date');
  if (!raw) return new Date().toISOString().slice(0, 10);
  const result = validate({ date: raw }, { date: { type: 'date', label: 'วันที่' } });
  if (!result.ok) throw new HttpError(400, 'วันที่ไม่ถูกต้อง', result.errors);
  return result.value.date;
}

/** สถิติรวมของแผนในช่วงวันที่กำหนด */
function totalsBetween(userId, from, to) {
  return sql(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(p.status = 'done'), 0)    AS done,
           COALESCE(SUM(p.status = 'skipped'), 0) AS skipped,
           COALESCE(SUM(p.status = 'planned'), 0) AS planned,
           COALESCE(SUM(${MINUTES}), 0)           AS planned_minutes,
           COALESCE(SUM(CASE WHEN p.status = 'done' THEN ${MINUTES} ELSE 0 END), 0) AS done_minutes
      FROM study_plans p
     WHERE p.user_id = ? AND p.plan_date BETWEEN ? AND ?
  `).get(userId, from, to);
}

/** สถิติแยกตามรายวิชา */
function bySubject(userId, from, to) {
  return sql(`
    SELECT COALESCE(s.id, 0)              AS subject_id,
           COALESCE(s.name, 'ไม่ระบุวิชา') AS name,
           COALESCE(s.color, '#94a3b8')   AS color,
           COUNT(*)                       AS total,
           COALESCE(SUM(p.status = 'done'), 0) AS done,
           COALESCE(SUM(${MINUTES}), 0)   AS planned_minutes,
           COALESCE(SUM(CASE WHEN p.status = 'done' THEN ${MINUTES} ELSE 0 END), 0) AS done_minutes
      FROM study_plans p
      LEFT JOIN subjects s ON s.id = p.subject_id AND s.user_id = p.user_id
     WHERE p.user_id = ? AND p.plan_date BETWEEN ? AND ?
     GROUP BY COALESCE(s.id, 0)
     ORDER BY done_minutes DESC, name
  `).all(userId, from, to).map((row) => ({
    subjectId: row.subject_id === 0 ? null : row.subject_id,
    name: row.name,
    color: row.color,
    total: row.total,
    done: row.done,
    plannedMinutes: row.planned_minutes,
    doneMinutes: row.done_minutes,
    completionRate: row.total > 0 ? Math.round((row.done / row.total) * 100) : 0,
  }));
}

/**
 * นับจำนวนวันติดต่อกันที่อ่านหนังสือสำเร็จอย่างน้อย 1 แผน
 * เริ่มนับจากวันอ้างอิง ถ้าวันนี้ยังไม่ได้อ่านก็ยอมให้เริ่มนับจากเมื่อวานได้
 * (เพื่อไม่ให้สถิติขาดทันทีตอนเช้าที่ยังไม่ได้เริ่มอ่าน)
 */
function calculateStreak(userId, today) {
  const rows = sql(`
    SELECT DISTINCT plan_date FROM study_plans
     WHERE user_id = ? AND status = 'done' AND plan_date <= ?
     ORDER BY plan_date DESC LIMIT 400
  `).all(userId, today);

  const days = new Set(rows.map((row) => row.plan_date));
  if (days.size === 0) return 0;

  let cursor = days.has(today) ? today : addDays(today, -1);
  if (!days.has(cursor)) return 0;

  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

const SELECT_PLAN_ROW = `
  SELECT p.id, p.subject_id, p.title, p.plan_date, p.start_time, p.end_time, p.status,
         s.name AS subject_name, s.color AS subject_color
    FROM study_plans p
    LEFT JOIN subjects s ON s.id = p.subject_id AND s.user_id = p.user_id
`;

function mapPlanRow(row) {
  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectName: row.subject_name,
    subjectColor: row.subject_color,
    title: row.title,
    planDate: row.plan_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
  };
}

export default function registerStatsRoutes(router) {
  /** ข้อมูลสำหรับหน้าหลัก */
  router.get('/api/stats/overview', (ctx) => {
    const today = referenceDate(ctx);
    const weekStart = addDays(today, -6);

    const todayPlans = sql(`${SELECT_PLAN_ROW} WHERE p.user_id = ? AND p.plan_date = ?
                            ORDER BY p.start_time`).all(ctx.userId, today).map(mapPlanRow);

    const week = totalsBetween(ctx.userId, weekStart, today);

    const goalCounts = sql(`
      SELECT COALESCE(SUM(status = 'active'), 0) AS active,
             COALESCE(SUM(status = 'done'), 0)   AS done
        FROM goals WHERE user_id = ?
    `).get(ctx.userId);

    // เป้าหมายที่ใกล้ครบกำหนดภายใน 14 วัน — ใช้ทำระบบแจ้งเตือนฝั่งเบราว์เซอร์
    const dueSoon = sql(`
      SELECT id, title, due_date, target_value, current_value, target_unit
        FROM goals
       WHERE user_id = ? AND status = 'active' AND due_date IS NOT NULL AND due_date <= ?
       ORDER BY due_date LIMIT 5
    `).all(ctx.userId, addDays(today, 14)).map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      targetValue: row.target_value,
      currentValue: row.current_value,
      targetUnit: row.target_unit,
      percent: row.target_value > 0
        ? Math.min(100, Math.round((row.current_value / row.target_value) * 100)) : 0,
    }));

    return {
      body: {
        date: today,
        today: {
          plans: todayPlans,
          total: todayPlans.length,
          done: todayPlans.filter((plan) => plan.status === 'done').length,
        },
        week: {
          from: weekStart,
          to: today,
          total: week.total,
          done: week.done,
          skipped: week.skipped,
          planned: week.planned,
          plannedMinutes: week.planned_minutes,
          doneMinutes: week.done_minutes,
          completionRate: week.total > 0 ? Math.round((week.done / week.total) * 100) : 0,
        },
        goals: { active: goalCounts.active, done: goalCounts.done, dueSoon },
        streak: calculateStreak(ctx.userId, today),
      },
    };
  }, { auth: true });

  /** ข้อมูลสำหรับหน้าติดตามความก้าวหน้า */
  router.get('/api/stats/progress', (ctx) => {
    const today = referenceDate(ctx);

    const daysResult = validate(
      { days: ctx.query.get('days') || 30 },
      { days: { type: 'int', min: 7, max: 180, default: 30, label: 'จำนวนวัน' } },
    );
    if (!daysResult.ok) throw new HttpError(400, 'ช่วงเวลาไม่ถูกต้อง', daysResult.errors);
    const days = daysResult.value.days;
    const from = addDays(today, -(days - 1));

    const overall = totalsBetween(ctx.userId, from, today);

    const dailyRows = sql(`
      SELECT p.plan_date AS date,
             COUNT(*) AS total,
             COALESCE(SUM(p.status = 'done'), 0) AS done,
             COALESCE(SUM(${MINUTES}), 0) AS planned_minutes,
             COALESCE(SUM(CASE WHEN p.status = 'done' THEN ${MINUTES} ELSE 0 END), 0) AS done_minutes
        FROM study_plans p
       WHERE p.user_id = ? AND p.plan_date BETWEEN ? AND ?
       GROUP BY p.plan_date
    `).all(ctx.userId, from, today);

    // เติมวันที่ไม่มีข้อมูลให้ครบ เพื่อให้กราฟฝั่งหน้าเว็บวาดได้ต่อเนื่องไม่ขาดช่วง
    const byDate = new Map(dailyRows.map((row) => [row.date, row]));
    const daily = [];
    for (let index = 0; index < days; index += 1) {
      const date = addDays(from, index);
      const row = byDate.get(date);
      daily.push({
        date,
        total: row ? row.total : 0,
        done: row ? row.done : 0,
        plannedMinutes: row ? row.planned_minutes : 0,
        doneMinutes: row ? row.done_minutes : 0,
      });
    }

    return {
      body: {
        range: { from, to: today, days },
        overall: {
          total: overall.total,
          done: overall.done,
          skipped: overall.skipped,
          planned: overall.planned,
          plannedMinutes: overall.planned_minutes,
          doneMinutes: overall.done_minutes,
          completionRate: overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0,
        },
        bySubject: bySubject(ctx.userId, from, today),
        daily,
        streak: calculateStreak(ctx.userId, today),
      },
    };
  }, { auth: true });

  /** ข้อมูลสำหรับหน้าสรุปผลการอ่าน */
  router.get('/api/stats/summary', (ctx) => {
    const today = referenceDate(ctx);

    const range = validate(
      { from: ctx.query.get('from') || undefined, to: ctx.query.get('to') || undefined },
      { from: { type: 'date', label: 'วันที่เริ่ม' }, to: { type: 'date', label: 'วันที่สิ้นสุด' } },
    );
    if (!range.ok) throw new HttpError(400, 'ช่วงวันที่ไม่ถูกต้อง', range.errors);

    const from = range.value.from || addDays(today, -29);
    const to = range.value.to || today;
    if (from > to) throw new HttpError(400, 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');

    const totals = totalsBetween(ctx.userId, from, to);

    // แผนที่เลยกำหนดแล้วแต่ยังไม่ได้อ่าน — ตอบคำถาม "ส่วนใดที่ยังไม่ได้ทำตามแผน"
    const overdue = sql(`${SELECT_PLAN_ROW}
       WHERE p.user_id = ? AND p.status = 'planned' AND p.plan_date < ?
       ORDER BY p.plan_date DESC, p.start_time LIMIT 50`)
      .all(ctx.userId, today).map(mapPlanRow);

    const recentDone = sql(`${SELECT_PLAN_ROW}
       WHERE p.user_id = ? AND p.status = 'done' AND p.plan_date BETWEEN ? AND ?
       ORDER BY p.plan_date DESC, p.start_time DESC LIMIT 20`)
      .all(ctx.userId, from, to).map(mapPlanRow);

    return {
      body: {
        range: { from, to },
        totals: {
          total: totals.total,
          done: totals.done,
          skipped: totals.skipped,
          planned: totals.planned,
          plannedMinutes: totals.planned_minutes,
          doneMinutes: totals.done_minutes,
          completionRate: totals.total > 0 ? Math.round((totals.done / totals.total) * 100) : 0,
        },
        bySubject: bySubject(ctx.userId, from, to),
        overdue,
        recentDone,
      },
    };
  }, { auth: true });
}
