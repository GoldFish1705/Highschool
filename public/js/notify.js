/**
 * ระบบแจ้งเตือน (ตามข้อเสนอแนะ 5.3.2 ข้อ 5 ของรายงานโครงงาน)
 *
 * ออกแบบให้ทำงานฝั่งเบราว์เซอร์ทั้งหมด ไม่ต้องมี push server และไม่ต้องให้เซิร์ฟเวอร์
 * ตั้งตัวจับเวลาไว้รอผู้ใช้ทีละคน จึงไม่กินแรมของเซิร์ฟเวอร์เลยแม้แต่น้อย
 * ซึ่งสำคัญมากเมื่อเว็บนี้ต้องรันบนโฮสต์ฟรีที่มีหน่วยความจำจำกัด
 *
 * แจ้งเตือน 2 แบบ:
 *   1. ใกล้ถึงเวลาอ่านหนังสือตามแผน (เตือนล่วงหน้า 10 นาที)
 *   2. เป้าหมายใกล้ครบกำหนด (เตือนวันละครั้ง)
 */
import { todayISO, formatMinutes, daysUntil } from './format.js';

const LEAD_MINUTES = 10;
const STORAGE_KEY = 'sp_notified';
const GOAL_KEY = 'sp_goal_notified';

let timer = null;
let currentPlans = [];
let currentGoals = [];

export const notifications = {
  get supported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  },
  get permission() {
    return this.supported ? Notification.permission : 'unsupported';
  },
};

/** อ่านรายการที่แจ้งเตือนไปแล้ววันนี้ (กันเตือนซ้ำเมื่อผู้ใช้เปิดหลายแท็บหรือรีเฟรช) */
function readNotified() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (raw.date !== todayISO()) return { date: todayISO(), ids: [] };
    return { date: raw.date, ids: Array.isArray(raw.ids) ? raw.ids : [] };
  } catch {
    return { date: todayISO(), ids: [] };
  }
}

function markNotified(id) {
  const state = readNotified();
  if (!state.ids.includes(id)) state.ids.push(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ ไม่เป็นไร */
  }
}

function show(title, body) {
  if (!notifications.supported || Notification.permission !== 'granted') return;
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag: title, badge: undefined });
  } catch {
    /* บางเบราว์เซอร์บนมือถือต้องใช้ผ่าน service worker เท่านั้น */
  }
}

/** ขออนุญาตแจ้งเตือน (ต้องเรียกจากการกดปุ่มของผู้ใช้เท่านั้น ตามข้อกำหนดของเบราว์เซอร์) */
export async function requestPermission() {
  if (!notifications.supported) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

/** นาทีตั้งแต่เที่ยงคืนของเวลาปัจจุบัน */
function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function toMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** ตรวจว่ามีอะไรต้องเตือนหรือยัง เรียกทุก 1 นาที */
function tick() {
  if (!notifications.supported || Notification.permission !== 'granted') return;

  const today = todayISO();
  const minutes = nowMinutes();
  const notified = readNotified().ids;

  for (const plan of currentPlans) {
    if (plan.planDate !== today || plan.status !== 'planned') continue;

    const start = toMinutes(plan.startTime);
    const key = `plan-${plan.id}`;
    const startedKey = `plan-start-${plan.id}`;

    // เตือนล่วงหน้า 10 นาที
    if (!notified.includes(key) && minutes >= start - LEAD_MINUTES && minutes < start) {
      show('ใกล้ถึงเวลาอ่านหนังสือแล้ว', `อีก ${start - minutes} นาที: ${plan.title} (${plan.startTime})`);
      markNotified(key);
    }
    // เตือนตอนถึงเวลาพอดี
    if (!notified.includes(startedKey) && minutes >= start && minutes < start + 2) {
      const length = toMinutes(plan.endTime) - start;
      show('ถึงเวลาอ่านหนังสือแล้ว', `${plan.title} • ใช้เวลา ${formatMinutes(length)}`);
      markNotified(startedKey);
    }
  }

  // เตือนเป้าหมายใกล้ครบกำหนด วันละครั้ง
  let lastGoalDate = null;
  try {
    lastGoalDate = localStorage.getItem(GOAL_KEY);
  } catch {
    lastGoalDate = null;
  }
  if (lastGoalDate !== today) {
    const soon = currentGoals.filter((goal) => {
      if (!goal.dueDate) return false;
      const left = daysUntil(goal.dueDate, today);
      return left >= 0 && left <= 3;
    });
    if (soon.length > 0) {
      const first = soon[0];
      const extra = soon.length > 1 ? ` และอีก ${soon.length - 1} เป้าหมาย` : '';
      show('เป้าหมายใกล้ครบกำหนด', `${first.title}${extra}`);
      try {
        localStorage.setItem(GOAL_KEY, today);
      } catch {
        /* เขียนไม่ได้ก็ข้ามไป */
      }
    }
  }
}

/** อัปเดตข้อมูลที่ใช้เตือน และเริ่มตัวจับเวลา */
export function watch({ plans = [], goals = [] } = {}) {
  currentPlans = plans;
  currentGoals = goals;

  if (timer === null && notifications.supported) {
    timer = setInterval(tick, 60_000);
    tick();
  }
}

/** รายการแผนที่กำลังจะถึงเวลาภายในชั่วโมงนี้ ใช้แสดงเป็นป้ายในหน้าเว็บ */
export function upcomingSoon(plans, withinMinutes = 60) {
  const today = todayISO();
  const minutes = nowMinutes();
  return plans.filter((plan) => {
    if (plan.planDate !== today || plan.status !== 'planned') return false;
    const start = toMinutes(plan.startTime);
    return start >= minutes && start - minutes <= withinMinutes;
  });
}
