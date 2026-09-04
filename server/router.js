/**
 * Router ขนาดเล็กที่เขียนเอง
 * รองรับ path แบบมีพารามิเตอร์ เช่น /api/plans/:id
 *
 * เหตุผลที่เขียนเองแทนใช้ library: เว็บนี้มีเส้นทางไม่กี่สิบเส้น
 * การเขียนเองราว 50 บรรทัดช่วยให้ไม่ต้องพึ่ง dependency ภายนอกเลย
 * ซึ่งทั้งประหยัดแรมและตัดความเสี่ยงจากช่องโหว่ใน package ของคนอื่น
 */

/** แปลง pattern เป็น RegExp โดย escape อักขระพิเศษของ regex ทั้งหมดก่อน */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

export function createRouter() {
  /** @type {Map<string, Array<{regex: RegExp, names: string[], handler: Function, options: object}>>} */
  const table = new Map();

  function add(method, pattern, handler, options = {}) {
    const { regex, names } = compile(pattern);
    if (!table.has(method)) table.set(method, []);
    table.get(method).push({ regex, names, handler, options });
  }

  /**
   * หา handler ที่ตรงกับ request
   * @returns {{handler: Function, params: object, options: object} | null}
   */
  function match(method, pathname) {
    const candidates = table.get(method);
    if (!candidates) return null;

    for (const entry of candidates) {
      const found = entry.regex.exec(pathname);
      if (!found) continue;

      // ใช้ Object.create(null) เพื่อไม่ให้พารามิเตอร์ชื่อ __proto__ ไปแก้ prototype ได้
      const params = Object.create(null);
      entry.names.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1]);
      });
      return { handler: entry.handler, params, options: entry.options };
    }
    return null;
  }

  /** ตรวจว่า path นี้มีอยู่จริงแต่คนละ method ไหม เพื่อตอบ 405 แทน 404 */
  function methodsFor(pathname) {
    const allowed = [];
    for (const [method, entries] of table) {
      if (entries.some((entry) => entry.regex.test(pathname))) allowed.push(method);
    }
    return allowed;
  }

  return {
    match,
    methodsFor,
    get: (pattern, handler, options) => add('GET', pattern, handler, options),
    post: (pattern, handler, options) => add('POST', pattern, handler, options),
    patch: (pattern, handler, options) => add('PATCH', pattern, handler, options),
    put: (pattern, handler, options) => add('PUT', pattern, handler, options),
    delete: (pattern, handler, options) => add('DELETE', pattern, handler, options),
  };
}
