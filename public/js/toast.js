/** ข้อความแจ้งผลลอยมุมจอ */
import { el } from './dom.js';

let area = null;

function ensureArea() {
  if (!area) {
    area = el('div', { class: 'toast-area', attrs: { 'aria-live': 'polite' } });
    document.body.append(area);
  }
  return area;
}

/**
 * @param {string} message ข้อความ (ใส่ผ่าน textContent จึงปลอดภัยจาก XSS)
 * @param {'info'|'success'|'error'} kind
 */
export function toast(message, kind = 'info') {
  const node = el('div', { class: `toast is-${kind}`, text: message });
  ensureArea().append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 5200 : 3200);
}
