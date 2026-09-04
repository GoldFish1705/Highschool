/**
 * เส้นทางจัดการรายวิชา
 *
 * ทุกคำสั่งมีเงื่อนไข user_id = ? เสมอ ทำให้ผู้ใช้เห็นและแก้ไขได้เฉพาะวิชาของตัวเอง
 * แม้จะเดา id ของคนอื่นถูกก็จะได้ 404 กลับไป (ป้องกัน IDOR)
 */
import { sql, toId } from '../db.js';
import { HttpError } from '../http/respond.js';
import { validate, patterns } from '../security/validate.js';

const MAX_SUBJECTS = 50;

const subjectSchema = {
  name: { type: 'string', required: true, maxLength: 60, label: 'ชื่อวิชา' },
  color: {
    type: 'string', required: true, maxLength: 7, label: 'สี',
    pattern: patterns.COLOR_RE, patternMessage: 'สีต้องอยู่ในรูปแบบ #rrggbb',
  },
};

function mapSubject(row) {
  return { id: toId(row.id), name: row.name, color: row.color, createdAt: row.created_at };
}

export default function registerSubjectRoutes(router) {
  router.get('/api/subjects', (ctx) => ({
    body: {
      subjects: sql('SELECT id, name, color, created_at FROM subjects WHERE user_id = ? ORDER BY name')
        .all(ctx.userId).map(mapSubject),
    },
  }), { auth: true });

  router.post('/api/subjects', (ctx) => {
    const result = validate(ctx.body, subjectSchema);
    if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);
    const data = result.value;

    // จำกัดจำนวนวิชาต่อบัญชี กันการสร้างข้อมูลรัวจนฐานข้อมูลบวม
    const { total } = sql('SELECT COUNT(*) AS total FROM subjects WHERE user_id = ?').get(ctx.userId);
    if (total >= MAX_SUBJECTS) {
      throw new HttpError(400, `เพิ่มวิชาได้สูงสุด ${MAX_SUBJECTS} วิชา`);
    }

    const duplicate = sql('SELECT id FROM subjects WHERE user_id = ? AND name = ?').get(ctx.userId, data.name);
    if (duplicate) throw new HttpError(409, 'มีวิชาชื่อนี้อยู่แล้ว');

    const now = new Date().toISOString();
    const inserted = sql('INSERT INTO subjects (user_id, name, color, created_at) VALUES (?, ?, ?, ?)')
      .run(ctx.userId, data.name, data.color, now);

    return {
      status: 201,
      body: { subject: { id: toId(inserted.lastInsertRowid), name: data.name, color: data.color, createdAt: now } },
    };
  }, { auth: true });

  router.patch('/api/subjects/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบวิชาที่ต้องการ');

    const result = validate(ctx.body, subjectSchema);
    if (!result.ok) throw new HttpError(400, 'ข้อมูลไม่ถูกต้อง', result.errors);
    const data = result.value;

    const duplicate = sql('SELECT id FROM subjects WHERE user_id = ? AND name = ? AND id <> ?')
      .get(ctx.userId, data.name, id);
    if (duplicate) throw new HttpError(409, 'มีวิชาชื่อนี้อยู่แล้ว');

    const updated = sql('UPDATE subjects SET name = ?, color = ? WHERE id = ? AND user_id = ?')
      .run(data.name, data.color, id, ctx.userId);
    if (updated.changes === 0) throw new HttpError(404, 'ไม่พบวิชาที่ต้องการ');

    const row = sql('SELECT id, name, color, created_at FROM subjects WHERE id = ? AND user_id = ?')
      .get(id, ctx.userId);
    return { body: { subject: mapSubject(row) } };
  }, { auth: true });

  router.delete('/api/subjects/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'ไม่พบวิชาที่ต้องการ');

    // แผนและเป้าหมายที่อ้างถึงวิชานี้จะถูกตั้งเป็น NULL โดยอัตโนมัติ (ON DELETE SET NULL)
    // เลือกแบบนี้แทนการลบตามกันไป เพื่อไม่ให้ผู้ใช้เสียแผนที่เคยบันทึกไว้โดยไม่ตั้งใจ
    const removed = sql('DELETE FROM subjects WHERE id = ? AND user_id = ?').run(id, ctx.userId);
    if (removed.changes === 0) throw new HttpError(404, 'ไม่พบวิชาที่ต้องการ');
    return { body: { ok: true } };
  }, { auth: true });
}
