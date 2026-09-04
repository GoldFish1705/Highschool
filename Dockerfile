# ---------------------------------------------------------------
# เว็บไซต์วางแผนการอ่านหนังสือและติดตามเป้าหมายการเรียน
#
# ใช้ image เดียวไม่ต้องแบ่งหลาย stage เพราะโครงงานนี้ไม่มี dependency
# และไม่มีขั้นตอน build จึงไม่ต้องรัน npm install เลย
# ผลคือ image เล็ก สร้างเร็ว และไม่มีโค้ดจากภายนอกติดมาให้ต้องกังวลเรื่องช่องโหว่
# ---------------------------------------------------------------
FROM node:22-alpine

# ติดตั้ง tini ไว้เป็น PID 1 เพื่อให้สัญญาณปิดระบบ (SIGTERM) ส่งถึงโปรเซส Node ได้ถูกต้อง
RUN apk add --no-cache tini

WORKDIR /app

# คัดลอกเฉพาะสิ่งที่ต้องใช้ตอนรันจริง
COPY package.json ./
COPY server ./server
COPY public ./public

# สร้างโฟลเดอร์เก็บฐานข้อมูลและมอบสิทธิ์ให้ผู้ใช้ที่ไม่ใช่ root
# การรันด้วยผู้ใช้ธรรมดาช่วยจำกัดความเสียหายหากมีช่องโหว่ในแอป
RUN mkdir -p /app/data && chown -R node:node /app

USER node

# UV_THREADPOOL_SIZE และ MALLOC_ARENA_MAX คือกุญแจสำคัญของการประหยัดแรม
#
# scrypt ที่ใช้แฮชรหัสผ่านจองหน่วยความจำ 16 MB ต่อการเรียก 1 ครั้ง และงานนี้ถูกส่งไปทำ
# ในชุดเธรดเบื้องหลังของ Node ยิ่งมีเธรดมาก ตัวจัดการหน่วยความจำก็ยิ่งกันพื้นที่ค้างไว้มาก
# วัดจริงแล้วพบว่า ค่าเริ่มต้นใช้แรมสูงสุด 148 MB แต่เมื่อจำกัด 2 ค่านี้เหลือ 109 MB
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    UV_THREADPOOL_SIZE=2 \
    MALLOC_ARENA_MAX=2

EXPOSE 8080

# ตรวจสุขภาพผ่านหน้าเข้าสู่ระบบ ถ้าเว็บไม่ตอบภายในเวลาที่กำหนดถือว่าไม่พร้อมใช้งาน
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]

# จำกัด heap ไว้ที่ 128 MB เพื่อให้แน่ใจว่าไม่กินแรมเกินโควตาของโฮสต์ฟรี
CMD ["node", "--no-warnings", "--max-old-space-size=128", "server/server.js"]
