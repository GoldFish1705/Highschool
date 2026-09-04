/** หน้าเข้าสู่ระบบและสมัครสมาชิก */
import { api, ApiError } from './api.js';
import { el, render } from './dom.js';

const messageBox = document.getElementById('message');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const panelLogin = document.getElementById('panel-login');
const panelRegister = document.getElementById('panel-register');

/** แสดงข้อความแจ้ง — ใช้ textContent ทุกจุดจึงปลอดภัยจาก XSS */
function showMessage(text, kind = 'error', details = []) {
  render(messageBox, el('div', { class: `alert alert-${kind}` }, [
    el('div', { text }),
    details.length > 0
      ? el('ul', {}, details.map((item) => el('li', { text: item })))
      : null,
  ]));
}

function clearMessage() {
  render(messageBox);
}

function selectTab(which) {
  const isLogin = which === 'login';
  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabRegister.setAttribute('aria-selected', String(!isLogin));
  panelLogin.hidden = !isLogin;
  panelRegister.hidden = isLogin;
  clearMessage();
}

tabLogin.addEventListener('click', () => selectTab('login'));
tabRegister.addEventListener('click', () => selectTab('register'));

// เปิดแท็บสมัครสมาชิกทันทีถ้ามาด้วยลิงก์ /login?register=1
if (new URLSearchParams(location.search).get('register') === '1') {
  selectTab('register');
}

/** ครอบการส่งฟอร์มให้จัดการปุ่ม/ข้อผิดพลาดเหมือนกันทุกฟอร์ม */
function handleSubmit(form, button, action) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'กำลังดำเนินการ...';

    try {
      await action();
      location.replace('/');
    } catch (error) {
      if (error instanceof ApiError) {
        showMessage(error.message, 'error', error.details);
      } else {
        showMessage('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
}

handleSubmit(panelLogin, document.getElementById('login-submit'), () => api.post('/api/auth/login', {
  username: document.getElementById('login-username').value.trim().toLowerCase(),
  password: document.getElementById('login-password').value,
}));

handleSubmit(panelRegister, document.getElementById('register-submit'), () => {
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  if (password !== confirm) {
    throw new ApiError(400, 'รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  }
  return api.post('/api/auth/register', {
    displayName: document.getElementById('register-display').value.trim(),
    username: document.getElementById('register-username').value.trim().toLowerCase(),
    password,
  });
});

// ถ้าเข้าสู่ระบบอยู่แล้วให้พาไปหน้าหลักเลย
api.get('/api/session')
  .then((data) => {
    if (data && data.authenticated) location.replace('/');
  })
  .catch(() => { /* ยังไม่ได้เข้าสู่ระบบ ถือเป็นเรื่องปกติ */ });
