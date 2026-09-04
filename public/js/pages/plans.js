/**
 * หน้าวางแผนการอ่านหนังสือ (ตามโครงสร้างข้อ 3.2.2 และขอบเขตข้อ 1.3.2.1)
 * ผู้ใช้กำหนดรายวิชา วันที่ และเวลาที่ต้องการอ่านได้ พร้อมแก้ไขและลบ
 */
import { api } from '../api.js';
import { el, emptyState } from '../dom.js';
import { store, refresh } from '../store.js';
import { toast } from '../toast.js';
import { openForm, confirmAction } from '../forms.js';
import { groupPlansByDate, pageHead, subjectOptions } from '../components.js';
import { todayISO, shiftDate, formatDateLong } from '../format.js';

/** ช่วงเวลาที่ให้เลือกดู */
const RANGES = [
  { key: 'week', label: '7 วันนี้', from: (today) => today, to: (today) => shiftDate(today, 6) },
  { key: 'twoWeeks', label: '14 วันนี้', from: (today) => today, to: (today) => shiftDate(today, 13) },
  { key: 'past', label: 'ย้อนหลัง 30 วัน', from: (today) => shiftDate(today, -30), to: (today) => shiftDate(today, -1) },
  { key: 'all', label: 'ทั้งหมด', from: () => null, to: () => null },
];

let activeRange = 'week';

function planFields(subjects, plan = null) {
  const today = todayISO();
  return [
    {
      name: 'title', label: 'หัวข้อที่จะอ่าน', type: 'text', required: true, maxLength: 120,
      value: plan ? plan.title : '', placeholder: 'เช่น ตรีโกณมิติ บทที่ 3',
    },
    {
      name: 'subjectId', label: 'รายวิชา', type: 'select',
      options: subjectOptions(subjects),
      // ตอนเพิ่มแผนใหม่ให้เลือกวิชาแรกไว้ก่อน เพราะการระบุวิชาคือหัวใจของการวางแผน
      // ผู้ใช้ยังเลือก "ไม่ระบุวิชา" เองได้ถ้าต้องการ
      value: plan ? (plan.subjectId ?? '') : (subjects[0] ? subjects[0].id : ''),
    },
    {
      name: 'planDate', label: 'วันที่', type: 'date', required: true,
      value: plan ? plan.planDate : today,
    },
    {
      name: 'status', label: 'สถานะ', type: 'select', value: plan ? plan.status : 'planned',
      options: [
        { value: 'planned', label: 'ยังไม่ได้อ่าน' },
        { value: 'done', label: 'อ่านแล้ว' },
        { value: 'skipped', label: 'ข้ามไป' },
      ],
    },
    {
      name: 'startTime', label: 'เวลาเริ่ม', type: 'time', required: true, half: true,
      value: plan ? plan.startTime : '18:00',
    },
    {
      name: 'endTime', label: 'เวลาสิ้นสุด', type: 'time', required: true, half: true,
      value: plan ? plan.endTime : '19:00',
    },
    {
      name: 'note', label: 'บันทึกเพิ่มเติม', type: 'textarea', maxLength: 500,
      value: plan ? plan.note : '', help: 'เช่น หน้าที่ต้องอ่าน หรือโจทย์ที่ต้องทำ',
    },
  ];
}

/** แปลงค่าจากฟอร์มให้เป็นรูปแบบที่ API ต้องการ */
function toPayload(values) {
  return {
    title: values.title,
    subjectId: values.subjectId === '' ? null : Number(values.subjectId),
    planDate: values.planDate,
    startTime: values.startTime,
    endTime: values.endTime,
    note: values.note,
    status: values.status,
  };
}

function openCreate(subjects) {
  openForm({
    title: 'เพิ่มแผนการอ่าน',
    fields: planFields(subjects),
    submitLabel: 'เพิ่มแผน',
    onSubmit: async (values) => {
      await api.post('/api/plans', toPayload(values));
      toast('เพิ่มแผนการอ่านแล้ว', 'success');
      await refresh();
    },
  });
}

function openEdit(subjects, plan) {
  openForm({
    title: 'แก้ไขแผนการอ่าน',
    fields: planFields(subjects, plan),
    onSubmit: async (values) => {
      await api.patch(`/api/plans/${plan.id}`, toPayload(values));
      toast('บันทึกการแก้ไขแล้ว', 'success');
      await refresh();
    },
  });
}

async function removePlan(plan) {
  if (!confirmAction(`ต้องการลบแผน "${plan.title}" ใช่หรือไม่?`)) return;
  try {
    await api.delete(`/api/plans/${plan.id}`);
    toast('ลบแผนแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(error.message || 'ลบไม่สำเร็จ', 'error');
  }
}

export default async function renderPlans() {
  const today = todayISO();
  const range = RANGES.find((item) => item.key === activeRange);
  const from = range.from(today);
  const to = range.to(today);

  const query = from && to ? `?from=${from}&to=${to}` : '';
  const [data, subjects] = await Promise.all([
    api.get(`/api/plans${query}`),
    store.loadSubjects(),
  ]);

  const toolbar = el('div', { class: 'toolbar' }, RANGES.map((item) => el('button', {
    type: 'button',
    class: 'chip',
    text: item.label,
    attrs: { 'aria-pressed': String(item.key === activeRange) },
    onClick: () => {
      activeRange = item.key;
      refresh();
    },
  })));

  const itemOptions = {
    onEdit: (plan) => openEdit(subjects, plan),
    onDelete: removePlan,
  };

  const body = data.plans.length === 0
    ? el('div', { class: 'card' }, [emptyState({
      icon: '🗓️',
      title: 'ยังไม่มีแผนการอ่านในช่วงนี้',
      message: 'เริ่มจากเลือกวิชา วันที่ และเวลาที่อยากอ่าน แล้วระบบจะช่วยติดตามให้เอง',
      action: el('button', {
        type: 'button', class: 'btn btn-primary', text: '+ เพิ่มแผนแรก',
        onClick: () => openCreate(subjects),
      }),
    })])
    : el('div', {}, groupPlansByDate(data.plans, itemOptions));

  const rangeText = from && to
    ? `${formatDateLong(from)} ถึง ${formatDateLong(to)}`
    : 'แผนทั้งหมดที่บันทึกไว้';

  return [
    pageHead('วางแผนการอ่านหนังสือ', rangeText, [
      el('button', {
        type: 'button', class: 'btn btn-primary', text: '+ เพิ่มแผน',
        onClick: () => openCreate(subjects),
      }),
    ]),
    toolbar,
    body,
  ];
}
