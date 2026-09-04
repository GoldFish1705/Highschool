/**
 * หน้าหลัก (ตามโครงสร้างข้อ 3.2.1 ของรายงานโครงงาน)
 * แสดงภาพรวมทั้งหมดไว้ในหน้าเดียว ตามแนวคิด Dashboard ที่ศึกษามาจาก Notion
 */
import { api } from '../api.js';
import { el, emptyState, progressBar } from '../dom.js';
import { store, navigate } from '../store.js';
import { statCard, planItem, pageHead } from '../components.js';
import { progressRing } from '../charts.js';
import { todayISO, formatDateLong, formatMinutes, toHours, dueLabel, UNIT_LABELS } from '../format.js';
import { watch, upcomingSoon } from '../notify.js';

export default async function renderDashboard() {
  const today = todayISO();
  const [overview] = await Promise.all([
    api.get(`/api/stats/overview?date=${today}`),
    store.loadSubjects(),
  ]);

  // ส่งข้อมูลให้ระบบแจ้งเตือนฝั่งเบราว์เซอร์ไปตั้งเวลารอ
  watch({ plans: overview.today.plans, goals: overview.goals.dueSoon });

  const soon = upcomingSoon(overview.today.plans);

  const stats = el('div', { class: 'grid grid-stats' }, [
    statCard('แผนวันนี้', `${overview.today.done}/${overview.today.total}`,
      overview.today.total === 0 ? 'ยังไม่มีแผนสำหรับวันนี้' : 'จำนวนที่อ่านแล้ว'),
    statCard('เวลาอ่านจริง 7 วันล่าสุด', `${toHours(overview.week.doneMinutes)} ชม.`,
      `จากที่วางแผนไว้ ${toHours(overview.week.plannedMinutes)} ชม.`),
    statCard('ทำตามแผนได้', `${overview.week.completionRate}%`,
      `${overview.week.done} จาก ${overview.week.total} แผนใน 7 วัน`),
    statCard('อ่านต่อเนื่อง', `${overview.streak} วัน`,
      overview.streak > 0 ? 'รักษาสถิติไว้นะ' : 'เริ่มวันนี้เลย'),
  ]);

  const todayCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: 'แผนการอ่านวันนี้' }),
      el('button', {
        type: 'button', class: 'btn btn-sm btn-primary', text: '+ เพิ่มแผน',
        onClick: () => navigate('/plans'),
      }),
    ]),
    soon.length > 0
      ? el('div', { class: 'alert alert-info', text: `ใกล้ถึงเวลาอ่านแล้ว: ${soon[0].title} เวลา ${soon[0].startTime} น.` })
      : null,
    overview.today.plans.length === 0
      ? emptyState({
        icon: '🗓️',
        title: 'ยังไม่มีแผนสำหรับวันนี้',
        message: 'ลองเพิ่มแผนการอ่านสักหัวข้อ แล้วเริ่มต้นวันนี้ให้เป็นระบบ',
        action: el('button', {
          type: 'button', class: 'btn btn-primary', text: 'ไปหน้าวางแผนการอ่าน',
          onClick: () => navigate('/plans'),
        }),
      })
      : el('div', { class: 'plan-list' }, overview.today.plans.map((plan) => planItem(plan))),
  ]);

  const weekCard = el('div', { class: 'card' }, [
    el('h2', { text: 'ความก้าวหน้า 7 วันล่าสุด' }),
    el('div', { class: 'ring-wrap', style: { 'margin-top': '14px' } }, [
      progressRing(overview.week.completionRate, 104),
      el('div', { class: 'ring-text' }, [
        el('div', { class: 'big', text: `${overview.week.done}/${overview.week.total}` }),
        el('div', { class: 'small', text: 'แผนที่ทำสำเร็จ' }),
        el('div', { class: 'small', text: `รวมเวลาอ่าน ${formatMinutes(overview.week.doneMinutes)}` }),
      ]),
    ]),
    el('button', {
      type: 'button', class: 'btn btn-sm', text: 'ดูรายละเอียดความก้าวหน้า',
      style: { 'margin-top': '14px' },
      onClick: () => navigate('/progress'),
    }),
  ]);

  const goalsCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: 'เป้าหมายใกล้ครบกำหนด' }),
      el('button', {
        type: 'button', class: 'btn btn-sm', text: 'ดูทั้งหมด',
        onClick: () => navigate('/goals'),
      }),
    ]),
    overview.goals.dueSoon.length === 0
      ? el('p', {
        class: 'subtitle',
        text: overview.goals.active > 0
          ? `มีเป้าหมายที่กำลังทำอยู่ ${overview.goals.active} รายการ และยังไม่มีรายการใดใกล้ครบกำหนด`
          : 'ยังไม่มีเป้าหมาย ลองตั้งเป้าหมายแรกของคุณดู',
      })
      : el('div', { class: 'grid', style: { gap: '13px' } }, overview.goals.dueSoon.map((goal) => el('div', {}, [
        el('div', { style: { display: 'flex', 'justify-content': 'space-between', gap: '10px' } }, [
          el('strong', { text: goal.title }),
          el('span', { class: 'badge badge-planned', text: dueLabel(goal.dueDate, today) }),
        ]),
        progressBar(goal.percent, goal.percent >= 100),
        el('div', { class: 'goal-numbers' }, [
          el('span', { text: `${goal.currentValue} / ${goal.targetValue} ${UNIT_LABELS[goal.targetUnit] || ''}` }),
          el('span', { text: `${goal.percent}%` }),
        ]),
      ]))),
  ]);

  return [
    pageHead(`สวัสดี ${store.user.displayName}`, formatDateLong(today)),
    stats,
    el('div', { class: 'grid grid-2', style: { 'margin-top': '16px' } }, [todayCard, weekCard]),
    el('div', { style: { 'margin-top': '16px' } }, [goalsCard]),
  ];
}
