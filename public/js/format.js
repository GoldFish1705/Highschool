/**
 * ตัวช่วยจัดรูปแบบวันที่ เวลา และตัวเลข ให้เป็นภาษาไทย
 * ใช้ Intl ที่ติดมากับเบราว์เซอร์ จึงแสดงปีเป็น พ.ศ. ให้อัตโนมัติ
 */

const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * แปลง "YYYY-MM-DD" เป็นวัตถุ Date ตามเวลาท้องถิ่น
 * จงใจไม่ใช้ new Date("2026-09-04") ตรง ๆ เพราะ JavaScript จะตีความเป็นเวลา UTC
 * ทำให้ผู้ใช้ในบางเขตเวลาเห็นวันที่คลาดไป 1 วัน
 */
export function parseDate(text) {
  const [year, month, day] = String(text).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** วันที่ของวันนี้ตามเวลาเครื่องผู้ใช้ ในรูปแบบ YYYY-MM-DD */
export function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** บวก/ลบวันจากสตริงวันที่ */
export function shiftDate(text, days) {
  const date = parseDate(text);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** เช่น "4 กันยายน 2569" */
export function formatDateLong(text) {
  return parseDate(text).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** เช่น "4 ก.ย. 69" */
export function formatDateShort(text) {
  return parseDate(text).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

/** เช่น "วันศุกร์" */
export function weekdayName(text) {
  return `วัน${WEEKDAYS[parseDate(text).getDay()]}`;
}

/** ป้ายกำกับวันที่แบบเป็นกันเอง: วันนี้ / พรุ่งนี้ / เมื่อวาน */
export function relativeDayLabel(text, today = todayISO()) {
  if (text === today) return 'วันนี้';
  if (text === shiftDate(today, 1)) return 'พรุ่งนี้';
  if (text === shiftDate(today, -1)) return 'เมื่อวาน';
  return null;
}

/** แปลงจำนวนนาทีเป็นข้อความ เช่น 90 -> "1 ชม. 30 น." */
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} นาที`;
  if (rest === 0) return `${hours} ชั่วโมง`;
  return `${hours} ชม. ${rest} น.`;
}

/** แปลงจำนวนนาทีเป็นชั่วโมงทศนิยม 1 ตำแหน่ง */
export function toHours(minutes) {
  return Math.round((minutes / 60) * 10) / 10;
}

export const UNIT_LABELS = {
  hours: 'ชั่วโมง',
  sessions: 'ครั้ง',
  chapters: 'บท',
  exercises: 'ข้อ',
};

export const GOAL_TYPE_LABELS = {
  short: 'เป้าหมายระยะสั้น',
  long: 'เป้าหมายระยะยาว',
};

/** จำนวนวันที่เหลือก่อนถึงกำหนด */
export function daysUntil(dateText, today = todayISO()) {
  const diff = parseDate(dateText).getTime() - parseDate(today).getTime();
  return Math.round(diff / 86400000);
}

/** ข้อความบอกกำหนดเวลา เช่น "เหลืออีก 5 วัน" หรือ "เลยกำหนดมาแล้ว 2 วัน" */
export function dueLabel(dateText, today = todayISO()) {
  const days = daysUntil(dateText, today);
  if (days === 0) return 'ครบกำหนดวันนี้';
  if (days === 1) return 'ครบกำหนดพรุ่งนี้';
  if (days > 0) return `เหลืออีก ${days} วัน`;
  return `เลยกำหนดมาแล้ว ${Math.abs(days)} วัน`;
}

/** วันที่และเวลาแบบเต็ม ใช้ในหน้าจัดการอุปกรณ์ */
export function formatDateTime(isoText) {
  return new Date(isoText).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
