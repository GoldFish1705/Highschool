/**
 * สถานะที่ใช้ร่วมกันทั้งแอป และตัวช่วยเปลี่ยนหน้า
 *
 * แยกออกมาเป็นไฟล์ต่างหากเพื่อไม่ให้ app.js กับไฟล์ในโฟลเดอร์ pages
 * import วนกลับไปกลับมา (circular import) ซึ่งทำให้ลำดับการโหลดโมดูลพัง
 */
import { api } from './api.js';

export const store = {
  user: null,
  subjects: [],

  /** โหลดรายวิชาแล้วเก็บไว้ใช้ซ้ำ ลดจำนวนคำขอที่ยิงไปยังเซิร์ฟเวอร์ */
  async loadSubjects(force = false) {
    if (this.subjects.length > 0 && !force) return this.subjects;
    const data = await api.get('/api/subjects');
    this.subjects = data.subjects;
    return this.subjects;
  },

  /** ค้นหาวิชาจาก id (ใช้ตอนแสดงชื่อ/สีในรายการ) */
  subjectById(id) {
    return this.subjects.find((subject) => subject.id === Number(id)) || null;
  },
};

/* ตัวชี้ไปยังฟังก์ชันของ router ที่ app.js จะลงทะเบียนไว้ให้ */
const hooks = { navigate: () => {}, refresh: () => {} };

export function registerRouter({ navigate, refresh }) {
  hooks.navigate = navigate;
  hooks.refresh = refresh;
}

/** เปลี่ยนหน้า */
export function navigate(path) {
  hooks.navigate(path);
}

/** โหลดหน้าปัจจุบันใหม่ (ใช้หลังเพิ่ม/แก้/ลบข้อมูล) */
export function refresh() {
  return hooks.refresh();
}
