/**
 * ชิ้นส่วนหน้าจอที่ใช้ซ้ำหลายหน้า
 */
import { el, statusBadge } from './dom.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { refresh } from './store.js';
import { formatMinutes, weekdayName, formatDateLong, relativeDayLabel } from './format.js';

/**
 * รายการแผนการอ่าน 1 บรรทัด
 * @param {object} plan ข้อมูลแผนจาก API
 * @param {object} options { onEdit, onDelete, showDate }
 */
export function planItem(plan, { onEdit = null, onDelete = null, showDate = false } = {}) {
  const isDone = plan.status === 'done';

  const toggle = el('button', {
    type: 'button',
    class: 'plan-check',
    text: '✓',
    attrs: {
      'aria-pressed': String(isDone),
      'aria-label': isDone ? `ยกเลิกการทำเครื่องหมายว่าอ่านแล้ว: ${plan.title}` : `ทำเครื่องหมายว่าอ่านแล้ว: ${plan.title}`,
    },
    onClick: async () => {
      toggle.disabled = true;
      try {
        await api.patch(`/api/plans/${plan.id}/status`, { status: isDone ? 'planned' : 'done' });
        toast(isDone ? 'ยกเลิกการทำเครื่องหมายแล้ว' : 'เยี่ยม! บันทึกว่าอ่านแล้ว', 'success');
        await refresh();
      } catch (error) {
        toast(error.message || 'อัปเดตไม่สำเร็จ', 'error');
        toggle.disabled = false;
      }
    },
  });

  const meta = [];
  if (showDate) {
    const label = relativeDayLabel(plan.planDate);
    meta.push(el('span', { text: label ? `${label} (${formatDateLong(plan.planDate)})` : formatDateLong(plan.planDate) }));
  }
  meta.push(el('span', { text: `${plan.startTime} - ${plan.endTime}` }));
  if (plan.minutes !== undefined) meta.push(el('span', { text: formatMinutes(plan.minutes) }));
  if (plan.subjectName) {
    meta.push(el('span', {}, [
      el('span', { class: 'dot', style: { background: plan.subjectColor || '#94a3b8' } }),
      ` ${plan.subjectName}`,
    ]));
  }
  meta.push(statusBadge(plan.status));

  const actions = [];
  if (onEdit) {
    actions.push(el('button', {
      type: 'button', class: 'btn btn-sm', text: 'แก้ไข', onClick: () => onEdit(plan),
    }));
  }
  if (onDelete) {
    actions.push(el('button', {
      type: 'button', class: 'btn btn-sm btn-danger', text: 'ลบ', onClick: () => onDelete(plan),
    }));
  }

  return el('div', { class: `plan-item${isDone ? ' is-done' : ''}` }, [
    toggle,
    el('div', { class: 'plan-main' }, [
      el('div', { class: 'plan-title', text: plan.title }),
      el('div', { class: 'plan-meta' }, meta),
      plan.note ? el('div', { class: 'plan-note', text: plan.note }) : null,
    ]),
    actions.length > 0 ? el('div', { class: 'plan-actions' }, actions) : null,
  ]);
}

/** จัดกลุ่มแผนตามวันที่แล้วสร้างหัวข้อวันให้ */
export function groupPlansByDate(plans, itemOptions = {}) {
  const groups = new Map();
  for (const plan of plans) {
    if (!groups.has(plan.planDate)) groups.set(plan.planDate, []);
    groups.get(plan.planDate).push(plan);
  }

  return [...groups.entries()].map(([date, items]) => {
    const label = relativeDayLabel(date);
    const doneCount = items.filter((item) => item.status === 'done').length;
    return el('section', { class: 'day-group' }, [
      el('h3', {}, [
        el('span', { text: label ? `${label} · ${formatDateLong(date)}` : `${weekdayName(date)} · ${formatDateLong(date)}` }),
        el('small', { text: `อ่านแล้ว ${doneCount}/${items.length}` }),
      ]),
      el('div', { class: 'plan-list' }, items.map((item) => planItem(item, itemOptions))),
    ]);
  });
}

/** การ์ดตัวเลขสรุป */
export function statCard(label, value, hint = null) {
  return el('div', { class: 'card stat' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    hint ? el('div', { class: 'hint', text: hint }) : null,
  ]);
}

/** หัวข้อหน้าพร้อมปุ่มด้านขวา */
export function pageHead(title, subtitle, actions = []) {
  return el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { text: title }),
      subtitle ? el('p', { class: 'subtitle', text: subtitle }) : null,
    ]),
    actions.length > 0 ? el('div', { class: 'plan-actions' }, actions) : null,
  ]);
}

/** ตัวเลือกวิชาสำหรับใส่ใน select */
export function subjectOptions(subjects, { includeNone = true } = {}) {
  const options = subjects.map((subject) => ({ value: subject.id, label: subject.name }));
  if (includeNone) options.unshift({ value: '', label: 'ไม่ระบุวิชา' });
  return options;
}
