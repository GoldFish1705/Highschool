/**
 * ตัวช่วยสร้าง DOM แบบปลอดภัยจาก XSS
 *
 * กฎเหล็กของไฟล์นี้: ไม่มีการใช้ innerHTML กับข้อมูลของผู้ใช้เด็ดขาด
 * ข้อความทุกชิ้นถูกใส่ผ่าน textContent ซึ่งเบราว์เซอร์จะถือว่าเป็น "ข้อความ" เสมอ
 * ต่อให้ผู้ใช้ตั้งชื่อแผนว่า <script>alert(1)</script> ก็จะแสดงเป็นตัวอักษรธรรมดา
 * ไม่ถูกรันเป็นโค้ด ทั้งเว็บใช้ฟังก์ชันในไฟล์นี้สร้างหน้าจอทั้งหมด
 */

/**
 * สร้าง element
 * @param {string} tag ชื่อแท็ก
 * @param {object} props คุณสมบัติ เช่น { class, text, onClick, attrs, dataset }
 * @param {Array<Node|string|null>} children ลูกที่จะใส่ข้างใน
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;

    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      // ปลอดภัยเสมอ: ถือว่าเป็นข้อความล้วน ไม่ใช่ HTML
      node.textContent = String(value);
    } else if (key === 'attrs') {
      for (const [name, attrValue] of Object.entries(value)) {
        if (attrValue !== null && attrValue !== undefined) node.setAttribute(name, String(attrValue));
      }
    } else if (key === 'dataset') {
      for (const [name, dataValue] of Object.entries(value)) node.dataset[name] = String(dataValue);
    } else if (key === 'style') {
      for (const [name, styleValue] of Object.entries(value)) node.style.setProperty(name, styleValue);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node[key] = value;
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }

  return node;
}

/** สร้าง SVG element (ต้องใช้ namespace ต่างจาก HTML) */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
  return node;
}

/** ล้างลูกทั้งหมดของ element */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** ล้างแล้วใส่เนื้อหาใหม่ */
export function render(node, ...children) {
  clear(node);
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** กล่องแสดงเมื่อยังไม่มีข้อมูล */
export function emptyState({ icon = '📚', title, message, action = null }) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'icon', text: icon }),
    el('h3', { text: title }),
    el('p', { text: message }),
    action,
  ]);
}

/** ป้ายสถานะของแผนการอ่าน */
const STATUS_LABELS = { planned: 'ยังไม่ได้อ่าน', done: 'อ่านแล้ว', skipped: 'ข้ามไป' };

export function statusBadge(status) {
  return el('span', { class: `badge badge-${status}`, text: STATUS_LABELS[status] || status });
}

/** แถบความคืบหน้า */
export function progressBar(percent, isDone = false) {
  return el('div', {
    class: 'progress-track',
    attrs: {
      role: 'progressbar',
      'aria-valuenow': String(Math.round(percent)),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
  }, [
    el('div', {
      class: `progress-fill${isDone ? ' is-done' : ''}`,
      style: { width: `${Math.max(0, Math.min(100, percent))}%` },
    }),
  ]);
}
