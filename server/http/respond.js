/**
 * ตัวช่วยส่ง response
 *
 * หลักสำคัญ: ข้อความ error ที่ส่งกลับไปหาผู้ใช้ต้องเป็นข้อความกลาง ๆ เท่านั้น
 * ห้ามส่ง stack trace, ชื่อไฟล์ หรือข้อความจากฐานข้อมูลออกไป เพราะเป็นการบอกใบ้
 * โครงสร้างภายในระบบให้ผู้โจมตี รายละเอียดจริงจะถูกเขียนลง log ของเซิร์ฟเวอร์แทน
 */
import { applySecurityHeaders } from '../security/headers.js';

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  applySecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }
  res.writeHead(status);
  res.end(body);
}

/** ส่ง error แบบมาตรฐาน: { error: "ข้อความ", details?: [...] } */
export function sendError(res, status, message, details) {
  const payload = { error: message };
  if (Array.isArray(details) && details.length > 0) payload.details = details;
  sendJson(res, status, payload);
}

/** ข้อผิดพลาดที่ "ตั้งใจ" ให้ผู้ใช้เห็น ใช้โยนออกมาจาก route handler ได้เลย */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (res) => sendError(res, 404, 'ไม่พบข้อมูลที่ต้องการ');
export const unauthorized = (res) => sendError(res, 401, 'กรุณาเข้าสู่ระบบก่อนใช้งาน');
