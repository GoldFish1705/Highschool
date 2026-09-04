/**
 * ตัวกลางเรียก API
 *
 * หน้าที่ด้านความปลอดภัย: แนบ CSRF token ที่อยู่ในคุกกี้กลับไปทาง header X-CSRF-Token
 * ทุกครั้งที่เป็นคำขอชนิดเปลี่ยนแปลงข้อมูล เพราะเซิร์ฟเวอร์จะตรวจว่าค่าทั้งสองตรงกัน
 * เว็บของผู้โจมตีอ่านคุกกี้ของโดเมนเราไม่ได้ จึงปลอมคำขอไม่สำเร็จ
 */

const CSRF_COOKIE_NAMES = ['__Host-sp_csrf', 'sp_csrf'];

function readCsrfToken() {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (CSRF_COOKIE_NAMES.includes(name)) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** ข้อผิดพลาดจาก API ที่พกสถานะและรายละเอียดมาด้วย */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && method !== 'HEAD') {
    let token = readCsrfToken();
    if (!token) {
      // ยังไม่มี token (เช่น คุกกี้หมดอายุ) ขอใหม่ก่อนแล้วค่อยส่งคำขอจริง
      await fetch('/api/csrf', { credentials: 'same-origin' });
      token = readCsrfToken();
    }
    if (token) headers['X-CSRF-Token'] = token;
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = (payload && payload.error) || 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
    throw new ApiError(response.status, message, payload && payload.details);
  }

  return payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  delete: (path) => request('DELETE', path, {}),
};
