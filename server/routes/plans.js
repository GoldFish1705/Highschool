/**
 * เส้นทางจัดการแผนการอ่านหนังสือ
 * ตรงกับขอบเขตข้อ 1.3.2.1 ของโครงงาน: กำหนดรายวิชา วันที่ และเวลาที่ต้องการอ่าน
 */
import { sql, toId } from '../db.js';
import { HttpError } from '../http/respond.js';
import { validate } from '../security/validate.js';

const MAX_PLANS = 2000;
export const PLAN_STATUSES = ['planned', 'done', 'skipped'];

const planSchema = {
  subjectId: { type: 'int', min: 1, nullable: true, label: 'วิชา' },
  title: { type: 'string', required: true, maxLength: 120, label: 'หัวข้อที่จะอ่าน' },
  planDate: { type: 'date', required: true, label: 'วันที่' },
  startTime: { type: 'time', required: true, label: 'เวลาเริ่ม' },
  endTime: { type: 'time', required: true, label: 'เวลาสิ้นสุด' },
  note: { type: 'string', maxLength: 500, multiline: true, default: '', label: 'บันทึกเพิ่มเติม' },
  status: { type: 'string', enum: PLAN_STATUSES, default: 'planned', label: 'สถานะ' },
};

/** แปลง "HH:MM" เป็นจำนวนนาทีตั้งแต่เที่ยงคืน */
function toMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function mapPlan(row) {
  return {
    id: toId(row.id),
    subjectId: row.subject_id === null ? null : toId(row.subject_id),
    subjectName: row.subject_name ?? null,
    subjectColor: row.subject_color ?? null,
    title: row.title,
    planDate: row.plan_date,
    startTime: row.start_time,
    endTime: row.end_time,
    note: row.note,
    status: row.status,
    minutes: toMinutes(row.end_time) - toMinutes(row.start_time),
    completedAt: row.completed_at,
  };
}

const SELECT_PLAN = `
  SELECT p.id, p.subject_id, p.title, p.plan_date, p.start_time, p.end_time,
         p.note, p.status, p.completed_at, s.name AS subject_name, s.color AS subject_color
    FROM study_plans p
    LEFT JOIN subjects s ON s.id = p.subject_id AND s.user_id = p.user_id
`;

/** ตรวจว่าวิชาที่อ้างถึงเป็นของผู้ใช้คนนี้จริง — กันการผูกแผนเข้ากับวิชาของคนอื่น */
function assertOwnsSubject(userId, subjectId) {
  if (subjectId === null || subjectId === undefined) return null;
  const found = sql('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, userId);
  if (!found) throw new HttpError(400, 'ไม่พบวิชาที่เลือก');
  return subjectId;
}

function parsePlanInput(ctx) {
  const result = validate(ctx.body, planSchema);
  if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);
  const data = result.value;

  if (toMinutes(data.endTime) <= toMinutes(data.startTime)) {
    throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', ['เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม']);
  }
  data.subjectId = assertOwnsSubject(ctx.userId, data.subjectId ?? null);
  return data;
}

export default function registerPlanRoutes(router) {
  /** รายการแผน กรองตามช่วงวันที่ได้ด้วย ?from=YYYY-MM-DD&to=YYYY-MM-DD */
  router.get('/api/plans', (ctx) => {
    const range = validate(
      { from: ctx.query.get('from') || undefined, to: ctx.query.get('to') || undefined },
      { from: { type: 'date', label: 'วันที่เริ่ม' }, to: { type: 'date', label: 'วันที่สิ้นสุด' } },
    );
    if (!range.ok) throw new HttpError(400, 'ช่วงวันที่ไม่ถูกต้อง', range.errors);

    const { from, to } = range.value;
    let rows;
    if (from && to) {
      rows = sql(`${SELECT_PLAN} WHERE p.user_id = ? AND p.plan_date BETWEEN ? AND ?
                  ORDER BY p.plan_date, p.start_time`).all(ctx.userId, from, to);
    } else if (from) {
      rows = sql(`${SELECT_PLAN} WHERE p.user_id = ? AND p.plan_date >= ?
                  ORDER BY p.plan_date, p.start_time LIMIT 500`).all(ctx.userId, from);
    } else {
      rows = sql(`${SELECT_PLAN} WHERE p.user_id = ?
                  ORDER BY p.plan_date DESC, p.start_time LIMIT 500`).all(ctx.userId);
    }

    return { body: { plans: rows.map(mapPlan) } };
  }, { auth: true });

  router.post('/api/plans', (ctx) => {
    const data = parsePlanInput(ctx);

    const { total } = sql('SELECT COUNT(*) AS total FROM study_plans WHERE user_id = ?').get(ctx.userId);
    if (total >= MAX_PLANS) throw new HttpError(400, `บันทึกแผนได้สูงสุด ${MAX_PLANS} รายการ`);

    const now = new Date().toISOString();
    const inserted = sql(`INSERT INTO study_plans
        (user_id, subject_id, title, plan_date, start_time, end_time, note, status, completed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ctx.userId, data.subjectId, data.title, data.planDate, data.startTime, data.endTime,
        data.note, data.status, data.status === 'done' ? now : null, now, now);

    const row = sql(`${SELECT_PLAN} WHERE p.id = ? AND p.user_id = ?`)
      .get(toId(inserted.lastInsertRowid), ctx.userId);
    return { status: 201, body: { plan: mapPlan(row) } };
  }, { auth: true });

  router.get('/api/plans/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');
    const row = sql(`${SELECT_PLAN} WHERE p.id = ? AND p.user_id = ?`).get(id, ctx.userId);
    if (!row) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');
    return { body: { plan: mapPlan(row) } };
  }, { auth: true });

  router.patch('/api/plans/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');

    const existing = sql('SELECT status FROM study_plans WHERE id = ? AND user_id = ?').get(id, ctx.userId);
    if (!existing) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');

    const data = parsePlanInput(ctx);
    const now = new Date().toISOString();
    // บันทึกเวลาที่ทำสำเร็จเฉพาะตอนที่เพิ่งเปลี่ยนเป็น done เพื่อไม่ให้เวลาเดิมถูกเขียนทับ
    const completedAt = data.status === 'done'
      ? (existing.status === 'done' ? undefined : now)
      : null;

    if (completedAt === undefined) {
      sql(`UPDATE study_plans SET subject_id = ?, title = ?, plan_date = ?, start_time = ?,
             end_time = ?, note = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(data.subjectId, data.title, data.planDate, data.startTime, data.endTime,
          data.note, data.status, now, id, ctx.userId);
    } else {
      sql(`UPDATE study_plans SET subject_id = ?, title = ?, plan_date = ?, start_time = ?,
             end_time = ?, note = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(data.subjectId, data.title, data.planDate, data.startTime, data.endTime,
          data.note, data.status, completedAt, now, id, ctx.userId);
    }

    const row = sql(`${SELECT_PLAN} WHERE p.id = ? AND p.user_id = ?`).get(id, ctx.userId);
    return { body: { plan: mapPlan(row) } };
  }, { auth: true });

  /** เปลี่ยนเฉพาะสถานะ ใช้ตอนกดติ๊กว่าอ่านเสร็จแล้ว */
  router.patch('/api/plans/:id/status', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');

    const result = validate(ctx.body, {
      status: { type: 'string', required: true, enum: PLAN_STATUSES, label: 'สถานะ' },
    });
    if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);

    const now = new Date().toISOString();
    const updated = sql(`UPDATE study_plans SET status = ?, completed_at = ?, updated_at = ?
                         WHERE id = ? AND user_id = ?`)
      .run(result.value.status, result.value.status === 'done' ? now : null, now, id, ctx.userId);
    if (updated.changes === 0) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');

    const row = sql(`${SELECT_PLAN} WHERE p.id = ? AND p.user_id = ?`).get(id, ctx.userId);
    return { body: { plan: mapPlan(row) } };
  }, { auth: true });

  router.delete('/api/plans/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');
    const removed = sql('DELETE FROM study_plans WHERE id = ? AND user_id = ?').run(id, ctx.userId);
    if (removed.changes === 0) throw new HttpError(404, 'ไม่พบแผนที่ต้องการ');
    return { body: { ok: true } };
  }, { auth: true });
}
