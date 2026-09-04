/**
 * แกนหลักของหน้าเว็บ: ตรวจการเข้าสู่ระบบ สร้างเมนู และสลับหน้าตามเส้นทาง
 *
 * ใช้ History API ทำให้เปลี่ยนหน้าได้โดยไม่ต้องโหลดใหม่ทั้งหน้า
 * ซึ่งเร็วกว่าและประหยัดทั้งอินเทอร์เน็ตของผู้ใช้และทรัพยากรของเซิร์ฟเวอร์
 */
import { api } from './api.js';
import { el, render } from './dom.js';
import { store, registerRouter } from './store.js';

import renderDashboard from './pages/dashboard.js';
import renderPlans from './pages/plans.js';
import renderGoals from './pages/goals.js';
import renderProgress from './pages/progress.js';
import renderSummary from './pages/summary.js';
import renderSettings from './pages/settings.js';

const NAV_ITEMS = [
  { path: '/', label: 'หน้าหลัก', short: 'หน้าหลัก', icon: '🏠', render: renderDashboard },
  { path: '/plans', label: 'วางแผนการอ่าน', short: 'แผน', icon: '🗓️', render: renderPlans },
  { path: '/goals', label: 'เป้าหมายการเรียน', short: 'เป้าหมาย', icon: '🎯', render: renderGoals },
  { path: '/progress', label: 'ติดตามความก้าวหน้า', short: 'ก้าวหน้า', icon: '📈', render: renderProgress },
  { path: '/summary', label: 'สรุปผลการอ่าน', short: 'สรุปผล', icon: '📊', render: renderSummary },
  { path: '/settings', label: 'ตั้งค่าและความปลอดภัย', short: 'ตั้งค่า', icon: '⚙️', render: renderSettings },
];

const view = document.getElementById('view');
const sidebarNav = document.getElementById('sidebar-nav');
const mobileNav = document.getElementById('mobile-nav');
const whoBox = document.getElementById('who');

function normalizePath(path) {
  if (path === '/dashboard') return '/';
  return NAV_ITEMS.some((item) => item.path === path) ? path : '/';
}

function navigate(path, { replace = false } = {}) {
  const target = normalizePath(path);
  if (replace) history.replaceState({}, '', target);
  else history.pushState({}, '', target);
  renderRoute();
}

function buildNav() {
  render(sidebarNav, ...NAV_ITEMS.map((item) => el('button', {
    class: 'nav-link',
    type: 'button',
    dataset: { path: item.path },
    onClick: () => navigate(item.path),
  }, [
    el('span', { class: 'icon', text: item.icon, attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: item.label }),
  ])));

  render(mobileNav, ...NAV_ITEMS.map((item) => el('button', {
    type: 'button',
    dataset: { path: item.path },
    onClick: () => navigate(item.path),
  }, [
    el('span', { class: 'icon', text: item.icon, attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: item.short }),
  ])));
}

function markActive(path) {
  for (const button of document.querySelectorAll('[data-path]')) {
    if (button.dataset.path === path) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

let renderToken = 0;

async function renderRoute() {
  const path = normalizePath(location.pathname);
  const item = NAV_ITEMS.find((entry) => entry.path === path);
  markActive(path);
  document.title = `${item.label} | วางแผนการอ่านหนังสือ`;

  const token = ++renderToken;
  render(view, el('p', { class: 'loading', text: 'กำลังโหลด...' }));

  try {
    const content = await item.render();
    // ถ้าผู้ใช้กดเปลี่ยนหน้าไปแล้วระหว่างรอข้อมูล ให้ทิ้งผลลัพธ์เก่าไป
    if (token !== renderToken) return;
    render(view, content);
    view.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (token !== renderToken) return;
    if (error.status === 401) {
      location.replace('/login');
      return;
    }
    render(view, el('div', { class: 'alert alert-error', text: error.message || 'โหลดข้อมูลไม่สำเร็จ' }));
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api.post('/api/auth/logout');
  } catch {
    /* ถึงจะล้มเหลวก็ยังพาออกจากระบบฝั่งหน้าเว็บ */
  }
  location.replace('/login');
});

window.addEventListener('popstate', renderRoute);

registerRouter({ navigate, refresh: renderRoute });

/** เริ่มต้นแอป */
(async function start() {
  try {
    const session = await api.get('/api/session');
    if (!session || !session.authenticated) {
      location.replace('/login');
      return;
    }
    store.user = session.user;
  } catch {
    location.replace('/login');
    return;
  }

  render(whoBox, [
    el('strong', { text: store.user.displayName }),
    el('span', { text: `@${store.user.username}` }),
  ]);

  buildNav();
  await renderRoute();
})();
