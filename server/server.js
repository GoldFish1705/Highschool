/**
 * จุดเริ่มต้นของเซิร์ฟเวอร์ — เปิดรับการเชื่อมต่อและดูแลการปิดระบบอย่างเรียบร้อย
 *
 * แยกไฟล์นี้ออกจาก app.js เพื่อให้ชุดทดสอบสามารถสร้างเซิร์ฟเวอร์ขึ้นมาทดสอบ
 * บนพอร์ตชั่วคราวได้ โดยไม่ต้องเปิดพอร์ตจริง
 */
import { config } from './config.js';
import { closeDatabase } from './db.js';
import { server } from './app.js';
import { purgeExpiredSessions } from './security/session.js';
import { purgeOldFailures, globalLimiter, authLimiter } from './security/ratelimit.js';
import { purgeOldEvents } from './security/audit.js';

/**
 * งานทำความสะอาดเป็นระยะ (ทุก 1 ชั่วโมง)
 * ป้องกันไม่ให้ฐานข้อมูลและหน่วยความจำโตขึ้นเรื่อย ๆ จนกินทรัพยากรเกินจำเป็น
 */
const maintenance = setInterval(() => {
  try {
    purgeExpiredSessions();
    purgeOldFailures();
    purgeOldEvents();
    globalLimiter.sweep();
    authLimiter.sweep();
  } catch (error) {
    console.error('[maintenance]', error.message);
  }
}, 60 * 60 * 1000);
// unref เพื่อให้ timer นี้ไม่ขัดขวางการปิดโปรเซส
maintenance.unref();

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ได้รับสัญญาณ ${signal} กำลังปิดระบบ...`);
  clearInterval(maintenance);
  server.close(() => {
    closeDatabase();
    console.log('[server] ปิดเรียบร้อย');
    process.exit(0);
  });
  // ถ้าปิดไม่ลงใน 10 วินาที ให้บังคับปิด
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ไม่ปล่อยให้ข้อผิดพลาดที่ไม่ได้จับทำให้เซิร์ฟเวอร์ล้มทั้งระบบ
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

server.listen(config.port, config.host, () => {
  console.log(`[server] เว็บไซต์วางแผนการอ่านหนังสือพร้อมใช้งานที่ http://${config.host}:${config.port}`);
  console.log(`[server] โหมด: ${config.nodeEnv} | ฐานข้อมูล: ${config.databasePath}`);

  if (config.appOrigin) {
    console.log(`[server] origin ที่ใช้ตรวจ CSRF: ${config.appOrigin}`);
  } else if (config.isProduction) {
    // ไม่ใช่ข้อผิดพลาดถึงขั้นหยุดระบบ เพราะการกัน CSRF ยังมีอีก 2 ชั้นทำงานอยู่
    // แต่ต้องเตือนให้เห็นชัด เพราะการตั้งค่านี้ทำให้ด่านตรวจ Origin แข็งแรงที่สุด
    console.warn(
      '[server] คำเตือน: ยังไม่ได้ตั้ง APP_ORIGIN ระบบจะใช้ header Host แทนในการตรวจ CSRF\n'
      + '          แนะนำให้ตั้ง APP_ORIGIN เป็น URL จริงของเว็บ เช่น https://ชื่อแอป.onrender.com',
    );
  }
});
