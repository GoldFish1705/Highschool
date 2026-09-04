/**
 * หน้าติดตามความก้าวหน้า (ตามโครงสร้างข้อ 3.2.4 และข้อเสนอแนะ 5.3.2 ข้อ 4)
 * แสดงผลเป็นเปอร์เซ็นต์และกราฟ เพื่อให้เห็นความก้าวหน้าของตนเองได้ง่าย
 */
import { api } from '../api.js';
import { el, emptyState, progressBar } from '../dom.js';
import { navigate, refresh } from '../store.js';
import { statCard, pageHead } from '../components.js';
import { progressRing, dailyChart } from '../charts.js';
import { todayISO, formatMinutes, toHours, formatDateLong } from '../format.js';

const RANGES = [
  { days: 7, label: '7 วัน' },
  { days: 14, label: '14 วัน' },
  { days: 30, label: '30 วัน' },
  { days: 90, label: '90 วัน' },
];

let activeDays = 30;

export default async function renderProgress() {
  const today = todayISO();
  const data = await api.get(`/api/stats/progress?date=${today}&days=${activeDays}`);

  const toolbar = el('div', { class: 'toolbar' }, RANGES.map((item) => el('button', {
    type: 'button', class: 'chip', text: item.label,
    attrs: { 'aria-pressed': String(item.days === activeDays) },
    onClick: () => { activeDays = item.days; refresh(); },
  })));

  if (data.overall.total === 0) {
    return [
      pageHead('ติดตามความก้าวหน้า', `${formatDateLong(data.range.from)} ถึง ${formatDateLong(data.range.to)}`),
      toolbar,
      el('div', { class: 'card' }, [emptyState({
        icon: '📈',
        title: 'ยังไม่มีข้อมูลในช่วงนี้',
        message: 'เมื่อบันทึกแผนการอ่านและทำเครื่องหมายว่าอ่านแล้ว กราฟและสถิติจะแสดงขึ้นที่นี่',
        action: el('button', {
          type: 'button', class: 'btn btn-primary', text: 'ไปหน้าวางแผนการอ่าน',
          onClick: () => navigate('/plans'),
        }),
      })]),
    ];
  }

  const stats = el('div', { class: 'grid grid-stats' }, [
    statCard('ทำตามแผนได้', `${data.overall.completionRate}%`,
      `${data.overall.done} จาก ${data.overall.total} แผน`),
    statCard('เวลาอ่านจริง', `${toHours(data.overall.doneMinutes)} ชม.`,
      `วางแผนไว้ ${toHours(data.overall.plannedMinutes)} ชม.`),
    statCard('ยังไม่ได้อ่าน', `${data.overall.planned} แผน`,
      data.overall.skipped > 0 ? `ข้ามไป ${data.overall.skipped} แผน` : 'ไม่มีแผนที่ข้ามไป'),
    statCard('อ่านต่อเนื่อง', `${data.streak} วัน`, 'จำนวนวันติดต่อกันที่อ่านสำเร็จ'),
  ]);

  const overviewCard = el('div', { class: 'card' }, [
    el('h2', { text: 'ภาพรวมการทำตามแผน' }),
    el('div', { class: 'ring-wrap', style: { 'margin-top': '14px' } }, [
      progressRing(data.overall.completionRate, 118),
      el('div', { class: 'ring-text' }, [
        el('div', { class: 'big', text: formatMinutes(data.overall.doneMinutes) }),
        el('div', { class: 'small', text: 'เวลาที่อ่านจริงทั้งหมด' }),
        el('div', { class: 'small', text: `เฉลี่ยวันละ ${formatMinutes(data.overall.doneMinutes / data.range.days)}` }),
      ]),
    ]),
  ]);

  const chartCard = el('div', { class: 'card' }, [
    el('h2', { text: 'เวลาอ่านหนังสือรายวัน' }),
    el('div', { style: { 'margin-top': '12px' } }, [dailyChart(data.daily)]),
  ]);

  const subjectRows = data.bySubject.map((subject) => el('div', { style: { 'margin-bottom': '14px' } }, [
    el('div', { style: { display: 'flex', 'justify-content': 'space-between', gap: '10px', 'margin-bottom': '5px' } }, [
      el('span', {}, [
        el('span', { class: 'dot', style: { background: subject.color } }),
        ` ${subject.name}`,
      ]),
      el('span', { class: 'small', text: `${formatMinutes(subject.doneMinutes)} · ${subject.completionRate}%` }),
    ]),
    progressBar(subject.completionRate, subject.completionRate >= 100),
  ]));

  const subjectCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: 'แยกตามรายวิชา' }),
      el('button', {
        type: 'button', class: 'btn btn-sm', text: 'ดูสรุปผลแบบละเอียด',
        onClick: () => navigate('/summary'),
      }),
    ]),
    ...subjectRows,
  ]);

  return [
    pageHead('ติดตามความก้าวหน้า', `${formatDateLong(data.range.from)} ถึง ${formatDateLong(data.range.to)}`),
    toolbar,
    stats,
    el('div', { class: 'grid grid-2', style: { 'margin-top': '16px' } }, [overviewCard, subjectCard]),
    el('div', { style: { 'margin-top': '16px' } }, [chartCard]),
  ];
}
