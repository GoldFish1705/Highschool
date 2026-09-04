/**
 * เส้นทางจัดการเป้าหมายการเรียน
 * ตรงกับขอบเขตข้อ 1.3.2.2 ของโครงงาน และข้อเสนอแนะ 5.3.2 ข้อ 3
 * (กำหนดเป้าหมายระยะสั้นและระยะยาว และแก้ไขเป้าหมายได้)
 */
import { sql, toId } from '../db.js';
import { HttpError } from '../http/respond.js';
import { validate } from '../security/validate.js';

const MAX_GOALS = 300;
export const GOAL_TYPES = ['short', 'long'];
export const GOAL_UNITS = ['hours', 'sessions', 'chapters', 'exercises'];
export const GOAL_STATUSES = ['active', 'done', 'archived'];

const goalSchema = {
  subjectId: { type: 'int', min: 1, nullable: true, label: 'วิชา' },
  title: { type: 'string', required: true, maxLength: 120, label: 'ชื่อเป้าหมาย' },
  description: { type: 'string', maxLength: 500, multiline: true, default: '', label: 'รายละเอียด' },
  goalType: { type: 'string', required: true, enum: GOAL_TYPES, label: 'ประเภทเป้าหมาย' },
  targetValue: { type: 'number', required: true, min: 0.5, max: 10000, label: 'เป้าหมายที่ตั้งไว้' },
  currentValue: { type: 'number', min: 0, max: 10000, default: 0, label: 'ความคืบหน้าปัจจุบัน' },
  targetUnit: { type: 'string', required: true, enum: GOAL_UNITS, label: 'หน่วย' },
  dueDate: { type: 'date', nullable: true, label: 'กำหนดเสร็จ' },
  status: { type: 'string', enum: GOAL_STATUSES, default: 'active', label: 'สถานะ' },
};

function mapGoal(row) {
  const target = row.target_value;
  const current = row.current_value;
  return {
    id: toId(row.id),
    subjectId: row.subject_id === null ? null : toId(row.subject_id),
    subjectName: row.subject_name ?? null,
    subjectColor: row.subject_color ?? null,
    title: row.title,
    description: row.description,
    goalType: row.goal_type,
    targetValue: target,
    currentValue: current,
    targetUnit: row.target_unit,
    dueDate: row.due_date,
    status: row.status,
    percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
  };
}

const SELECT_GOAL = `
  SELECT g.id, g.subject_id, g.title, g.description, g.goal_type, g.target_value,
         g.current_value, g.target_unit, g.due_date, g.status,
         s.name AS subject_name, s.color AS subject_color
    FROM goals g
    LEFT JOIN subjects s ON s.id = g.subject_id AND s.user_id = g.user_id
`;

/** ตรวจว่าวิชาที่อ้างถึงเป็นของผู้ใช้คนนี้จริง ป้องกันการผูกเป้าหมายเข้ากับวิชาของคนอื่น */
function assertOwnsSubject(userId, subjectId) {
  if (subjectId === null || subjectId === undefined) return null;
  const found = sql('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(subjectId, userId);
  if (!found) throw new HttpError(400, 'ไม่พบวิชาที่เลือก');
  return subjectId;
}

function parseGoalInput(ctx) {
  const result = validate(ctx.body, goalSchema);
  if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);
  const data = result.value;
  data.subjectId = assertOwnsSubject(ctx.userId, data.subjectId ?? null);
  return data;
}

export default function registerGoalRoutes(router) {
  router.get('/api/goals', (ctx) => {
    const statusFilter = ctx.query.get('status');
    let rows;
    if (statusFilter && GOAL_STATUSES.includes(statusFilter)) {
      rows = sql(`${SELECT_GOAL} WHERE g.user_id = ? AND g.status = ?
                  ORDER BY g.due_date IS NULL, g.due_date, g.id DESC`).all(ctx.userId, statusFilter);
    } else {
      rows = sql(`${SELECT_GOAL} WHERE g.user_id = ?
                  ORDER BY g.status = 'done', g.due_date IS NULL, g.due_date, g.id DESC`).all(ctx.userId);
    }
    return { body: { goals: rows.map(mapGoal) } };
  }, { auth: true });

  router.post('/api/goals', (ctx) => {
    const data = parseGoalInput(ctx);

    const { total } = sql('SELECT COUNT(*) AS total FROM goals WHERE user_id = ?').get(ctx.userId);
    if (total >= MAX_GOALS) throw new HttpError(400, `บันทึกเป้าหมายได้สูงสุด ${MAX_GOALS} รายการ`);

    const now = new Date().toISOString();
    const inserted = sql(`INSERT INTO goals
        (user_id, subject_id, title, description, goal_type, target_value, current_value,
         target_unit, due_date, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ctx.userId, data.subjectId, data.title, data.description, data.goalType,
        data.targetValue, data.currentValue, data.targetUnit, data.dueDate ?? null, data.status, now, now);

    const row = sql(`${SELECT_GOAL} WHERE g.id = ? AND g.user_id = ?`)
      .get(toId(inserted.lastInsertRowid), ctx.userId);
    return { status: 201, body: { goal: mapGoal(row) } };
  }, { auth: true });

  router.patch('/api/goals/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');

    const data = parseGoalInput(ctx);
    const updated = sql(`UPDATE goals SET subject_id = ?, title = ?, description = ?, goal_type = ?,
           target_value = ?, current_value = ?, target_unit = ?, due_date = ?, status = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`)
      .run(data.subjectId, data.title, data.description, data.goalType, data.targetValue,
        data.currentValue, data.targetUnit, data.dueDate ?? null, data.status,
        new Date().toISOString(), id, ctx.userId);
    if (updated.changes === 0) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');

    const row = sql(`${SELECT_GOAL} WHERE g.id = ? AND g.user_id = ?`).get(id, ctx.userId);
    return { body: { goal: mapGoal(row) } };
  }, { auth: true });

  /** อัปเดตเฉพาะความคืบหน้า ใช้ตอนกดปุ่มเพิ่ม/ลดในหน้าเป้าหมาย */
  router.patch('/api/goals/:id/progress', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');

    const result = validate(ctx.body, {
      currentValue: { type: 'number', required: true, min: 0, max: 10000, label: 'ความคืบหน้า' },
    });
    if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);

    const existing = sql('SELECT target_value, status FROM goals WHERE id = ? AND user_id = ?')
      .get(id, ctx.userId);
    if (!existing) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');

    // ทำครบเป้าหมายแล้วให้เปลี่ยนสถานะเป็นสำเร็จอัตโนมัติ
    const reached = result.value.currentValue >= existing.target_value;
    const nextStatus = existing.status === 'archived'
      ? 'archived'
      : (reached ? 'done' : 'active');

    sql('UPDATE goals SET current_value = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(result.value.currentValue, nextStatus, new Date().toISOString(), id, ctx.userId);

    const row = sql(`${SELECT_GOAL} WHERE g.id = ? AND g.user_id = ?`).get(id, ctx.userId);
    return { body: { goal: mapGoal(row) } };
  }, { auth: true });

  router.delete('/api/goals/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');
    const removed = sql('DELETE FROM goals WHERE id = ? AND user_id = ?').run(id, ctx.userId);
    if (removed.changes === 0) throw new HttpError(404, 'ไม่พบเป้าหมายที่ต้องการ');
    return { body: { ok: true } };
  }, { auth: true });
}
