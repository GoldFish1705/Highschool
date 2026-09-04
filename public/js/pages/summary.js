/**
 * หน้าสรุปผลการอ่าน (ตามข้อเสนอแนะ 5.3.2 ข้อ 6)
 * ตอบคำถามว่า "อ่านวิชาใดไปแล้วบ้าง" และ "ส่วนใดที่ยังไม่ได้ทำตามแผน"
 */
import { api } from '../api.js';
import { el, emptyState } from '../dom.js';
import { navigate, refresh } from '../store.js';
import { statCard, pageHead, planItem } from '../components.js';
import { todayISO, shiftDate, formatDateLong, formatMinutes, toHours } from '../format.js';

const RANGES = [
  { key: 30, label: '30 วันล่าสุด' },
  { key: 90, label: '90 วันล่าสุด' },
  { key: 365, label: '1 ปีล่าสุด' },
];

let activeRange = 30;

export default async function renderSummary() {
  const today = todayISO();
  const from = shiftDate(today, -(activeRange - 1));
  const data = await api.get(`/api/stats/summary?date=${today}&from=${from}&to=${today}`);

  const toolbar = el('div', { class: 'toolbar' }, RANGES.map((item) => el('button', {
    type: 'button', class: 'chip', text: item.label,
    attrs: { 'aria-pressed': String(item.key === activeRange) },
    onClick: () => { activeRange = item.key; refresh(); },
  })));

  const stats = el('div', { class: 'grid grid-stats' }, [
    statCard('แผนทั้งหมด', `${data.totals.total} แผน`, `ในช่วง ${activeRange} วัน`),
    statCard('อ่านสำเร็จ', `${data.totals.done} แผน`, `คิดเป็น ${data.totals.completionRate}%`),
    statCard('เวลาอ่านรวม', `${toHours(data.totals.doneMinutes)} ชม.`,
      `วางแผนไว้ ${toHours(data.totals.plannedMinutes)} ชม.`),
    statCard('ยังไม่ได้ทำตามแผน', `${data.overdue.length} แผน`,
      data.overdue.length > 0 ? 'เลยกำหนดแล้ว' : 'ไม่มีค้าง เยี่ยมมาก'),
  ]);

  /** ตารางสรุปรายวิชา */
  const subjectTable = data.bySubject.length === 0
    ? emptyState({ icon: '📊', title: 'ยังไม่มีข้อมูลรายวิชา', message: 'บันทึกแผนการอ่านแล้วกลับมาดูใหม่อีกครั้ง' })
    : el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'รายวิชา' }),
            el('th', { class: 'num', text: 'แผนทั้งหมด' }),
            el('th', { class: 'num', text: 'อ่านแล้ว' }),
            el('th', { class: 'num', text: 'เวลาที่อ่านจริง' }),
            el('th', { class: 'num', text: 'ทำได้ตามแผน' }),
          ]),
        ]),
        el('tbody', {}, data.bySubject.map((subject) => el('tr', {}, [
          el('td', {}, [
            el('span', { class: 'dot', style: { background: subject.color } }),
            ` ${subject.name}`,
          ]),
          el('td', { class: 'num', text: String(subject.total) }),
          el('td', { class: 'num', text: String(subject.done) }),
          el('td', { class: 'num', text: formatMinutes(subject.doneMinutes) }),
          el('td', { class: 'num', text: `${subject.completionRate}%` }),
        ]))),
      ]),
    ]);

  const overdueCard = el('div', { class: 'card' }, [
    el('h2', { text: 'แผนที่เลยกำหนดแล้วแต่ยังไม่ได้อ่าน' }),
    data.overdue.length === 0
      ? el('p', { class: 'subtitle', style: { 'margin-top': '8px' }, text: 'ไม่มีแผนค้างอยู่ ทำได้ตามแผนทั้งหมด' })
      : el('div', { class: 'plan-list', style: { 'margin-top': '12px' } },
        data.overdue.map((plan) => planItem(plan, { showDate: true }))),
  ]);

  const recentCard = el('div', { class: 'card' }, [
    el('h2', { text: 'อ่านสำเร็จล่าสุด' }),
    data.recentDone.length === 0
      ? el('p', { class: 'subtitle', style: { 'margin-top': '8px' }, text: 'ยังไม่มีรายการที่อ่านสำเร็จในช่วงนี้' })
      : el('div', { class: 'plan-list', style: { 'margin-top': '12px' } },
        data.recentDone.map((plan) => planItem(plan, { showDate: true }))),
  ]);

  if (data.totals.total === 0 && data.overdue.length === 0) {
    return [
      pageHead('สรุปผลการอ่าน', `${formatDateLong(data.range.from)} ถึง ${formatDateLong(data.range.to)}`),
      toolbar,
      el('div', { class: 'card' }, [emptyState({
        icon: '📊',
        title: 'ยังไม่มีข้อมูลให้สรุป',
        message: 'เริ่มบันทึกแผนการอ่าน แล้วระบบจะสรุปให้ว่าอ่านวิชาใดไปแล้วบ้าง',
        action: el('button', {
          type: 'button', class: 'btn btn-primary', text: 'ไปหน้าวางแผนการอ่าน',
          onClick: () => navigate('/plans'),
        }),
      })]),
    ];
  }

  return [
    pageHead('สรุปผลการอ่าน', `${formatDateLong(data.range.from)} ถึง ${formatDateLong(data.range.to)}`),
    toolbar,
    stats,
    el('div', { class: 'card', style: { 'margin-top': '16px' } }, [
      el('h2', { text: 'สรุปแยกตามรายวิชา' }),
      el('div', { style: { 'margin-top': '12px' } }, [subjectTable]),
    ]),
    el('div', { class: 'grid grid-2', style: { 'margin-top': '16px' } }, [overdueCard, recentCard]),
  ];
}
