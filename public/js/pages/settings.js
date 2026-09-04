/**
 * หน้าตั้งค่าและความปลอดภัย
 * รวมการจัดการรายวิชา การเปลี่ยนรหัสผ่าน การดูอุปกรณ์ที่เข้าสู่ระบบ
 * ประวัติความปลอดภัย และการเปิดการแจ้งเตือน
 */
import { api } from '../api.js';
import { el, emptyState, render } from '../dom.js';
import { store, refresh } from '../store.js';
import { toast } from '../toast.js';
import { openForm, confirmAction } from '../forms.js';
import { pageHead } from '../components.js';
import { formatDateTime } from '../format.js';
import { notifications, requestPermission } from '../notify.js';

const COLOR_CHOICES = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f'];

function subjectFields(subject = null) {
  return [
    {
      name: 'name', label: 'ชื่อวิชา', type: 'text', required: true, maxLength: 60,
      value: subject ? subject.name : '', placeholder: 'เช่น ฟิสิกส์',
    },
    {
      name: 'color', label: 'สีประจำวิชา', type: 'color',
      value: subject ? subject.color : COLOR_CHOICES[Math.floor(Math.random() * COLOR_CHOICES.length)],
      help: 'ใช้แยกสีของวิชาในตารางและกราฟ',
    },
  ];
}

function openSubjectForm(subject = null) {
  openForm({
    title: subject ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชา',
    fields: subjectFields(subject),
    onSubmit: async (values) => {
      const payload = { name: values.name, color: values.color };
      if (subject) await api.patch(`/api/subjects/${subject.id}`, payload);
      else await api.post('/api/subjects', payload);
      await store.loadSubjects(true);
      toast(subject ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มรายวิชาแล้ว', 'success');
      await refresh();
    },
  });
}

async function removeSubject(subject) {
  if (!confirmAction(`ลบวิชา "${subject.name}" ใช่หรือไม่?\nแผนและเป้าหมายที่เคยผูกกับวิชานี้จะยังอยู่ แต่จะกลายเป็น "ไม่ระบุวิชา"`)) return;
  try {
    await api.delete(`/api/subjects/${subject.id}`);
    await store.loadSubjects(true);
    toast('ลบรายวิชาแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(error.message || 'ลบไม่สำเร็จ', 'error');
  }
}

function openPasswordForm() {
  openForm({
    title: 'เปลี่ยนรหัสผ่าน',
    submitLabel: 'เปลี่ยนรหัสผ่าน',
    fields: [
      { name: 'currentPassword', label: 'รหัสผ่านปัจจุบัน', type: 'password', required: true, maxLength: 128 },
      {
        name: 'newPassword', label: 'รหัสผ่านใหม่', type: 'password', required: true, maxLength: 128,
        help: 'อย่างน้อย 10 ตัวอักษร ผสมตัวอักษรกับตัวเลข และต้องไม่มีชื่อผู้ใช้อยู่ภายใน',
      },
      { name: 'confirmPassword', label: 'ยืนยันรหัสผ่านใหม่', type: 'password', required: true, maxLength: 128 },
    ],
    onSubmit: async (values) => {
      if (values.newPassword !== values.confirmPassword) {
        const error = new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
        error.details = [];
        throw error;
      }
      const result = await api.post('/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast(`เปลี่ยนรหัสผ่านแล้ว และออกจากระบบอุปกรณ์อื่นอีก ${result.revokedSessions} เครื่อง`, 'success');
      await refresh();
    },
  });
}

async function revokeSession(session) {
  if (!confirmAction(`ออกจากระบบอุปกรณ์ "${session.deviceLabel}" ใช่หรือไม่?`)) return;
  try {
    await api.delete(`/api/auth/sessions/${session.id}`);
    toast('ออกจากระบบอุปกรณ์นั้นแล้ว', 'success');
    await refresh();
  } catch (error) {
    toast(error.message || 'ดำเนินการไม่สำเร็จ', 'error');
  }
}

/** ส่วนตั้งค่าการแจ้งเตือน */
function notificationCard() {
  const status = el('p', { class: 'subtitle' });
  const button = el('button', { type: 'button', class: 'btn', text: 'เปิดการแจ้งเตือน' });

  function paint() {
    if (!notifications.supported) {
      status.textContent = 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน';
      button.disabled = true;
      return;
    }
    if (notifications.permission === 'granted') {
      status.textContent = 'เปิดการแจ้งเตือนอยู่ — ระบบจะเตือนล่วงหน้า 10 นาทีก่อนถึงเวลาอ่าน และเตือนเมื่อเป้าหมายใกล้ครบกำหนด';
      button.disabled = true;
      button.textContent = 'เปิดอยู่แล้ว';
    } else if (notifications.permission === 'denied') {
      status.textContent = 'การแจ้งเตือนถูกปิดไว้ในเบราว์เซอร์ ต้องไปเปิดในการตั้งค่าเว็บไซต์ของเบราว์เซอร์เอง';
      button.disabled = true;
    } else {
      status.textContent = 'ยังไม่ได้เปิดการแจ้งเตือน กดปุ่มด้านล่างเพื่ออนุญาต';
    }
  }

  button.addEventListener('click', async () => {
    const result = await requestPermission();
    if (result === 'granted') toast('เปิดการแจ้งเตือนเรียบร้อย', 'success');
    else if (result === 'denied') toast('เบราว์เซอร์ปฏิเสธการแจ้งเตือน', 'error');
    paint();
  });

  paint();

  return el('div', { class: 'card' }, [
    el('h2', { text: 'การแจ้งเตือน' }),
    status,
    el('div', { style: { 'margin-top': '12px' } }, [button]),
  ]);
}

export default async function renderSettings() {
  const [subjects, sessionData, activityData] = await Promise.all([
    store.loadSubjects(true),
    api.get('/api/auth/sessions'),
    api.get('/api/auth/activity'),
  ]);

  const subjectCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-title' }, [
      el('h2', { text: 'รายวิชา' }),
      el('button', {
        type: 'button', class: 'btn btn-sm btn-primary', text: '+ เพิ่มวิชา',
        onClick: () => openSubjectForm(),
      }),
    ]),
    subjects.length === 0
      ? emptyState({ icon: '📚', title: 'ยังไม่มีรายวิชา', message: 'เพิ่มวิชาที่ต้องอ่าน เพื่อใช้จัดกลุ่มแผนและกราฟ' })
      : el('div', { class: 'plan-list' }, subjects.map((subject) => el('div', { class: 'plan-item' }, [
        el('span', { class: 'dot', style: { background: subject.color, 'margin-top': '7px' } }),
        el('div', { class: 'plan-main' }, [el('div', { class: 'plan-title', text: subject.name })]),
        el('div', { class: 'plan-actions' }, [
          el('button', { type: 'button', class: 'btn btn-sm', text: 'แก้ไข', onClick: () => openSubjectForm(subject) }),
          el('button', { type: 'button', class: 'btn btn-sm btn-danger', text: 'ลบ', onClick: () => removeSubject(subject) }),
        ]),
      ]))),
  ]);

  const accountCard = el('div', { class: 'card' }, [
    el('h2', { text: 'บัญชีผู้ใช้' }),
    el('div', { class: 'plan-meta', style: { 'margin-top': '8px' } }, [
      el('span', { text: `ชื่อที่ใช้แสดง: ${store.user.displayName}` }),
      el('span', { text: `ชื่อผู้ใช้: @${store.user.username}` }),
    ]),
    el('div', { style: { 'margin-top': '14px' } }, [
      el('button', { type: 'button', class: 'btn', text: 'เปลี่ยนรหัสผ่าน', onClick: openPasswordForm }),
    ]),
    el('p', {
      class: 'help', style: { 'margin-top': '10px' },
      text: 'เมื่อเปลี่ยนรหัสผ่าน ระบบจะออกจากระบบอุปกรณ์อื่นทั้งหมดโดยอัตโนมัติเพื่อความปลอดภัย',
    }),
  ]);

  const sessionCard = el('div', { class: 'card' }, [
    el('h2', { text: 'อุปกรณ์ที่เข้าสู่ระบบอยู่' }),
    el('div', { class: 'plan-list', style: { 'margin-top': '12px' } },
      sessionData.sessions.map((session) => el('div', { class: 'plan-item' }, [
        el('div', { class: 'plan-main' }, [
          el('div', { class: 'plan-title' }, [
            session.deviceLabel,
            session.current ? el('span', { class: 'badge badge-done', style: { 'margin-inline-start': '8px' }, text: 'เครื่องนี้' }) : null,
          ]),
          el('div', { class: 'plan-meta' }, [
            el('span', { text: `เข้าสู่ระบบเมื่อ ${formatDateTime(session.createdAt)}` }),
            el('span', { text: `ใช้งานล่าสุด ${formatDateTime(session.lastSeenAt)}` }),
          ]),
        ]),
        session.current ? null : el('div', { class: 'plan-actions' }, [
          el('button', {
            type: 'button', class: 'btn btn-sm btn-danger', text: 'ออกจากระบบ',
            onClick: () => revokeSession(session),
          }),
        ]),
      ]))),
  ]);

  const activityCard = el('div', { class: 'card' }, [
    el('h2', { text: 'ประวัติความปลอดภัย' }),
    el('p', { class: 'help', text: 'ตรวจสอบได้ว่ามีการพยายามเข้าบัญชีของคุณหรือไม่' }),
    activityData.events.length === 0
      ? el('p', { class: 'subtitle', style: { 'margin-top': '10px' }, text: 'ยังไม่มีประวัติ' })
      : el('div', { class: 'table-wrap', style: { 'margin-top': '12px' } }, [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'เหตุการณ์' }),
            el('th', { text: 'รายละเอียด' }),
            el('th', { text: 'เมื่อ' }),
          ])]),
          el('tbody', {}, activityData.events.map((event) => el('tr', {}, [
            el('td', { text: event.event }),
            el('td', { text: event.detail || '-' }),
            el('td', { text: formatDateTime(event.createdAt) }),
          ]))),
        ]),
      ]),
  ]);

  return [
    pageHead('ตั้งค่าและความปลอดภัย', 'จัดการรายวิชา บัญชีผู้ใช้ และการแจ้งเตือน'),
    el('div', { class: 'grid grid-2' }, [subjectCard, accountCard]),
    el('div', { class: 'grid grid-2', style: { 'margin-top': '16px' } }, [sessionCard, notificationCard()]),
    el('div', { style: { 'margin-top': '16px' } }, [activityCard]),
  ];
}
