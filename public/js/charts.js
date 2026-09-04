/**
 * กราฟที่วาดด้วย SVG เขียนเอง
 *
 * ไม่ใช้ไลบรารีกราฟสำเร็จรูป เพราะไลบรารีเหล่านั้นมีขนาดหลายร้อยกิโลไบต์
 * ต้องโหลดจาก CDN (ซึ่งนโยบาย CSP ของเว็บนี้ห้ามไว้) และทำให้หน้าเว็บหนักขึ้นมาก
 * โค้ดในไฟล์นี้ราว 100 บรรทัดก็เพียงพอกับกราฟที่โครงงานต้องใช้แล้ว
 *
 * สีทั้งหมดอ้างอิงตัวแปร CSS จึงเปลี่ยนตามธีมสว่าง/มืดได้เอง
 */
import { svg, el } from './dom.js';
import { formatMinutes, formatDateShort } from './format.js';

/**
 * วงแหวนแสดงเปอร์เซ็นต์ความก้าวหน้า
 * @param {number} percent 0-100
 * @param {number} size ขนาดเป็นพิกเซล
 */
export function progressRing(percent, size = 96) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = Math.round(size * 0.11);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const center = size / 2;

  // ใช้คลาส ring (ไม่ใช่ chart) เพราะ .chart ถูกตั้ง width:100% ไว้สำหรับกราฟที่ต้องยืดเต็มการ์ด
  // ส่วนวงแหวนต้องคงขนาดตายตัวตามที่ระบุ
  return svg('svg', {
    class: 'ring', width: size, height: size,
    viewBox: `0 0 ${size} ${size}`,
    role: 'img', 'aria-label': `ความก้าวหน้า ${value} เปอร์เซ็นต์`,
  }, [
    svg('circle', {
      cx: center, cy: center, r: radius, fill: 'none',
      stroke: 'var(--border)', 'stroke-width': stroke,
    }),
    svg('circle', {
      cx: center, cy: center, r: radius, fill: 'none',
      stroke: value >= 100 ? 'var(--success)' : 'var(--brand)',
      'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': circumference,
      'stroke-dashoffset': offset,
      transform: `rotate(-90 ${center} ${center})`,
    }),
    svg('text', {
      x: center, y: center, 'text-anchor': 'middle', 'dominant-baseline': 'central',
      fill: 'var(--text)', 'font-size': size * 0.24, 'font-weight': '700',
    }, [`${value}%`]),
  ]);
}

/**
 * กราฟแท่งรายวัน แสดงเวลาที่วางแผนไว้เทียบกับเวลาที่อ่านจริง
 * @param {Array<{date: string, plannedMinutes: number, doneMinutes: number}>} days
 */
export function dailyChart(days) {
  const width = 720;
  const height = 210;
  const padLeft = 44;
  const padBottom = 26;
  const padTop = 10;

  // เลือกระดับแกนตั้งให้ลงตัวสวย ๆ ไม่งั้นป้ายบอกระดับจะปัดเลขซ้ำกัน เช่น "1 ชม." สองอัน
  const NICE_STEPS = [15, 30, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720];
  const rawMax = Math.max(30, ...days.map((day) => day.plannedMinutes));
  const step = NICE_STEPS.find((candidate) => candidate * 4 >= rawMax) ?? Math.ceil(rawMax / 240) * 60;
  const maxValue = step * 4;

  const chartW = width - padLeft - 8;
  const chartH = height - padBottom - padTop;
  const slot = chartW / Math.max(days.length, 1);
  const barW = Math.max(2, Math.min(20, slot * 0.62));

  const children = [];

  /** ป้ายแกนตั้ง แสดงเป็นชั่วโมง ใส่ทศนิยมเฉพาะเมื่อจำเป็น */
  const axisLabel = (minutes) => {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ชม.`;
  };

  // เส้นแนวนอนบอกระดับ พร้อมป้ายบอกจำนวนชั่วโมง
  for (let index = 0; index <= 4; index += 1) {
    const value = step * index;
    const y = padTop + chartH - (value / maxValue) * chartH;
    children.push(svg('line', {
      x1: padLeft, y1: y, x2: width - 8, y2: y,
      stroke: 'var(--border)', 'stroke-width': 1,
    }));
    children.push(svg('text', {
      x: padLeft - 8, y: y + 4, 'text-anchor': 'end',
      fill: 'var(--text-faint)', 'font-size': 11,
    }, [axisLabel(value)]));
  }

  days.forEach((day, index) => {
    const x = padLeft + slot * index + (slot - barW) / 2;

    const plannedH = (day.plannedMinutes / maxValue) * chartH;
    const doneH = (day.doneMinutes / maxValue) * chartH;

    if (day.plannedMinutes > 0) {
      children.push(svg('rect', {
        x, y: padTop + chartH - plannedH, width: barW, height: Math.max(plannedH, 1),
        rx: Math.min(3, barW / 2), fill: 'var(--border)',
      }, [
        svg('title', {}, [`${formatDateShort(day.date)} • วางแผนไว้ ${formatMinutes(day.plannedMinutes)}`]),
      ]));
    }
    if (day.doneMinutes > 0) {
      children.push(svg('rect', {
        x, y: padTop + chartH - doneH, width: barW, height: Math.max(doneH, 1),
        rx: Math.min(3, barW / 2), fill: 'var(--brand)',
      }, [
        svg('title', {}, [`${formatDateShort(day.date)} • อ่านจริง ${formatMinutes(day.doneMinutes)}`]),
      ]));
    }
  });

  // ป้ายวันที่ด้านล่าง แสดงเท่าที่ไม่ทับกัน
  const labelEvery = Math.ceil(days.length / 8);
  days.forEach((day, index) => {
    if (index % labelEvery !== 0) return;
    children.push(svg('text', {
      x: padLeft + slot * index + slot / 2, y: height - 8,
      'text-anchor': 'middle', fill: 'var(--text-faint)', 'font-size': 10.5,
    }, [formatDateShort(day.date)]));
  });

  return el('div', {}, [
    svg('svg', {
      class: 'chart', viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img', 'aria-label': 'กราฟเปรียบเทียบเวลาที่วางแผนไว้กับเวลาที่อ่านจริงในแต่ละวัน',
    }, children),
    el('div', { class: 'chart-legend' }, [
      el('span', {}, [
        el('span', { class: 'dot', style: { background: 'var(--border)' } }),
        'เวลาที่วางแผนไว้',
      ]),
      el('span', {}, [
        el('span', { class: 'dot', style: { background: 'var(--brand)' } }),
        'เวลาที่อ่านจริง',
      ]),
    ]),
  ]);
}
