/**
 * อ่าน request body แบบปลอดภัย
 *
 * ป้องกัน 3 อย่าง:
 *   1. body ขนาดใหญ่เกินไปที่อาจทำให้แรมเต็ม — ตัดการเชื่อมต่อทันทีเมื่อเกินโควตา
 *      (ไม่รอจนอ่านครบแล้วค่อยตรวจ เพราะตอนนั้นแรมก็เต็มไปแล้ว)
 *   2. JSON ที่ผิดรูปแบบ — จับ error แล้วตอบ 400
 *   3. Content-Type ที่ไม่ใช่ JSON — ปฏิเสธ ทำให้ฟอร์มจากเว็บอื่นยิงเข้ามาตรง ๆ ไม่ได้
 *      (ฟอร์ม HTML ธรรมดาส่ง application/json ไม่ได้ จึงเป็นการกัน CSRF อีกชั้น)
 */
import { config } from '../config.js';
import { HttpError } from './respond.js';

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      reject(new HttpError(415, 'ต้องส่งข้อมูลเป็น JSON (Content-Type: application/json)'));
      return;
    }

    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > config.maxBodyBytes) {
      reject(new HttpError(413, 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป'));
      return;
    }

    let chunks = [];
    let received = 0;
    let finished = false;

    // เพดานแข็ง: ถ้าฝั่งตรงข้ามยังส่งต่อไม่หยุดเกิน 10 เท่าของโควตา ให้ตัดการเชื่อมต่อทิ้งเลย
    const hardLimit = config.maxBodyBytes * 10;

    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      received += chunk.length;

      if (finished) {
        // เกินโควตาไปแล้ว ไม่เก็บข้อมูลเพิ่มอีก ปล่อยให้ไหลทิ้งเพื่อให้ตอบ 413 กลับไปได้
        if (received > hardLimit) req.destroy();
        return;
      }

      if (received > config.maxBodyBytes) {
        // ทิ้งสิ่งที่เก็บมาแล้วทันที เพื่อไม่ให้ข้อมูลก้อนใหญ่ค้างอยู่ในหน่วยความจำ
        chunks = [];
        fail(new HttpError(413, 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim() === '') {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new HttpError(400, 'ข้อมูลที่ส่งมาต้องเป็นอ็อบเจกต์ JSON'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'รูปแบบ JSON ไม่ถูกต้อง'));
      }
    });

    req.on('error', () => fail(new HttpError(400, 'อ่านข้อมูลจากคำขอไม่สำเร็จ')));
  });
}
