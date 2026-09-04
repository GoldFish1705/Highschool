/**
 * หน้ากำหนดเป้าหมายการเรียน (ตามโครงสร้างข้อ 3.2.3 และขอบเขตข้อ 1.3.2.2)
 * รองรับเป้าหมายทั้งระยะสั้นและระยะยาว พร้อมปรับความคืบหน้าได้
 */
import { api } from '../api.js';
import { el, emptyState, progressBar } from '../dom.js';
import { store, refresh } from '../store.js';
import { toast } from '../toast.js';
import { openForm, confirmAction } from '../forms.js';
import { pageHead, subjectOptions } from '../components.js';
import { todayISO, dueLabel, daysUntil, UNIT_LABELS, GOAL_TYPE_LABELS } from '../format.js';

const FILTERS = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'short', label: 'ระยะสั้น' },
  { key: 'long', label: 'ระยะยาว' },
  { key: 'done', label: 'สำเร็จแล้ว' },
];

let activeFilter = 'all';

function goalFields(subjects, goal = null) {
  return [
    {
      name: 'title', label: 'ชื่อเป้าหมาย', type: 'text', required: true, maxLength: 120,
      value: goal ? goal.title : '', placeholder: 'เช่น อ่านคณิตศาสตร์ให้ครบ 20 ชั่วโมง',
    },
    {
      name: 'goalType', label: 'ประเภท', type: 'select', half: true,
      value: goal ? goal.goalType : 'short',
      options: [
        { value: 'short', label: 'ระยะสั้น (รายวัน/รายสัปดาห์)' },
        { value: 'long', label: 'ระยะยาว (ก่อนสอบ/ปลายภาค)' },
      ],
    },
    {
      name: 'subjectId', label: 'รายวิชา', type: 'select', half: true,
      options: subjectOptions(subjects), value: goal && goal.subjectId ? goal.subjectId : '',
    },
    {
      name: 'targetValue', label: 'เป้าหมายที่ตั้งไว้', type: 'number', required: true, half: true,
      min: 0.5, max: 10000, step: 0.5, value: goal ? goal.targetValue : 10,
    },
    {
      name: 'targetUnit', label: 'หน่วย', type: 'select', half: true,
      value: goal ? goal.targetUnit : 'hours',
      options: [
        { value: 'hours', label: 'ชั่วโมง' },
        { value: 'sessions', label: 'ครั้ง' },
        { value: 'chapters', label: 'บท' },
        { value: 'exercises', label: 'ข้อ' },
      ],
    },
    {
      name: 'currentValue', label: 'ทำไปแล้ว', type: 'number', half: true,
      min: 0, max: 10000, step: 0.5, value: goal ? goal.currentValue : 0,
    },
    {
      name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date', half: true,
      value: goal && goal.dueDate ? goal.dueDate : '',
    },
    {
      name: 'description', label: 'รายละเอียด', type: 'textarea', maxLength: 500,
      value: goal ? goal.description : '',
    },
  ];
}

function toPayload(values, existingStatus = 'active') {
  return {
    title: values.title,
    description: values.description,
    goalType: values.goalType,
    subjectId: values.subjectId === '' ? null : Number(values.subjectId),
    targetValue: Number(values.targetValue),
    currentValue: Number(values.currentValue || 0),
    targetUnit: values.targetUnit,
    dueDate: values.dueDate === '' ? null : values.dueDate,
    status: existingStatus === 'archived' ? 'archived' : 'active',
  };
}

function openCreate(subjects) {
  openForm({
    title: 'ตั้งเป้าหมายใหม่',
    fields: goalFields(subjects),
    submitLabel: 'บันทึกเป้าหมาย',
    onSubmit: async (values) => {
      await api.post('/api/goals', toPayload(values));
      toast('ตั้งเป้าหมายแล้ว', 'success');
      await refresh();
    },
  });
}

function openEdit(subjects, goal) {
  openForm({
    title: 'แก้ไขเป้าหมาย',
    fields: goalFields(subjects, goal),
    onSubmit: async (values) => {
      await api.patch(`/api/goals/${goal.id}`, toPayload(values, goal.status));
      toast('บันทึกการแก้ไขแล้ว', 'success');
      await refresh();
    },
  });
}

async function removeGoal(goal) {
  if (!confirmAction(`ต้องการลบเป้าหมาย "${goal.title}" ใช่หรือไม่?`)) return;
  try {
    await api.delete(`/api/goals/${goal.id}`);
    toast('ลบเป้าหมายแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(error.message || 'ลบไม่สำเร็จ', 'error');
  }
}

/** ปุ่มปรับความคืบหน้าอย่างรวดเร็ว */
function progressControls(goal) {
  const input = el('input', {
    type: 'number', value: goal.currentValue,
    attrs: { min: '0', max: '10000', step: '0.5', 'aria-label': `ความคืบหน้าของ ${goal.title}` },
  });

  const save = async (nextValue) => {
    const value = Math.max(0, Math.min(10000, Number(nextValue)));
    if (!Number.isFinite(value)) return;
    try {
      await api.patch(`/api/goals/${goal.id}/progress`, { currentValue: value });
      if (value >= goal.targetValue) toast('ยินดีด้วย ทำเป้าหมายนี้สำเร็จแล้ว!', 'success');
      await refresh();
    } catch (error) {
      toast(error.message || 'อัปเดตไม่สำเร็จ', 'error');
    }
  };

  return el('div', { class: 'goal-step' }, [
    el('button', {
      type: 'button', class: 'btn btn-sm', text: '−',
      attrs: { 'aria-label': 'ลดความคืบหน้า 1' },
      onClick: () => save(Number(input.value) - 1),
    }),
    input,
    el('button', {
      type: 'button', class: 'btn btn-sm', text: '+',
      attrs: { 'aria-label': 'เพิ่มความคืบหน้า 1' },
      onClick: () => save(Number(input.value) + 1),
    }),
    el('button', {
      type: 'button', class: 'btn btn-sm', text: 'บันทึก',
      onClick: () => save(input.value),
    }),
  ]);
}

function goalCard(goal, subjects, today) {
  const isDone = goal.status === 'done' || goal.percent >= 100;
  const overdue = goal.dueDate && !isDone && daysUntil(goal.dueDate, today) < 0;

  return el('div', { class: 'card goal-card' }, [
    el('div', { class: 'goal-head' }, [
      el('div', {}, [
        el('div', { class: 'goal-title', text: goal.title }),
        el('div', { class: 'plan-meta' }, [
          el('span', { text: GOAL_TYPE_LABELS[goal.goalType] }),
          goal.subjectName
            ? el('span', {}, [
              el('span', { class: 'dot', style: { background: goal.subjectColor || '#94a3b8' } }),
              ` ${goal.subjectName}`,
            ])
            : null,
        ]),
      ]),
      isDone
        ? el('span', { class: 'badge badge-done', text: 'สำเร็จแล้ว' })
        : (goal.dueDate
          ? el('span', {
            class: `badge ${overdue ? 'badge-overdue' : 'badge-planned'}`,
            text: dueLabel(goal.dueDate, today),
          })
          : null),
    ]),
    goal.description ? el('p', { class: 'goal-desc', text: goal.description }) : null,
    progressBar(goal.percent, isDone),
    el('div', { class: 'goal-numbers' }, [
      el('span', { text: `${goal.currentValue} / ${goal.targetValue} ${UNIT_LABELS[goal.targetUnit] || ''}` }),
      el('span', { text: `${goal.percent}%` }),
    ]),
    progressControls(goal),
    el('div', { class: 'plan-actions' }, [
      el('button', { type: 'button', class: 'btn btn-sm', text: 'แก้ไข', onClick: () => openEdit(subjects, goal) }),
      el('button', { type: 'button', class: 'btn btn-sm btn-danger', text: 'ลบ', onClick: () => removeGoal(goal) }),
    ]),
  ]);
}

export default async function renderGoals() {
  const today = todayISO();
  const [data, subjects] = await Promise.all([api.get('/api/goals'), store.loadSubjects()]);

  const filtered = data.goals.filter((goal) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'done') return goal.status === 'done' || goal.percent >= 100;
    return goal.goalType === activeFilter && goal.status !== 'done';
  });

  const toolbar = el('div', { class: 'toolbar' }, FILTERS.map((item) => el('button', {
    type: 'button', class: 'chip', text: item.label,
    attrs: { 'aria-pressed': String(item.key === activeFilter) },
    onClick: () => { activeFilter = item.key; refresh(); },
  })));

  const body = filtered.length === 0
    ? el('div', { class: 'card' }, [emptyState({
      icon: '🎯',
      title: data.goals.length === 0 ? 'ยังไม่มีเป้าหมาย' : 'ไม่มีเป้าหมายในหมวดนี้',
      message: 'ตั้งเป้าหมายที่วัดผลได้ เช่น "อ่านฟิสิกส์ให้ครบ 12 ชั่วโมงก่อนสอบกลางภาค"',
      action: el('button', {
        type: 'button', class: 'btn btn-primary', text: '+ ตั้งเป้าหมายแรก',
        onClick: () => openCreate(subjects),
      }),
    })])
    : el('div', { class: 'grid grid-cards' }, filtered.map((goal) => goalCard(goal, subjects, today)));

  return [
    pageHead('เป้าหมายการเรียน', `กำลังทำอยู่ ${data.goals.filter((g) => g.status === 'active').length} รายการ`, [
      el('button', {
        type: 'button', class: 'btn btn-primary', text: '+ ตั้งเป้าหมาย',
        onClick: () => openCreate(subjects),
      }),
    ]),
    toolbar,
    body,
  ];
}
