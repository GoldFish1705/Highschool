/**
 * ตัวสร้างฟอร์มในกล่องโต้ตอบ ใช้ร่วมกันทุกหน้า
 * ทุก label และข้อความ error ถูกใส่ผ่าน textContent จึงปลอดภัยจาก XSS
 */
import { el, render, clear } from './dom.js';
import { ApiError } from './api.js';

const dialog = document.getElementById('dialog');
const dialogForm = document.getElementById('dialog-form');
const dialogTitle = document.getElementById('dialog-title');
const dialogBody = document.getElementById('dialog-body');
const dialogSave = document.getElementById('dialog-save');
const dialogCancel = document.getElementById('dialog-cancel');
const dialogClose = document.getElementById('dialog-close');

let activeSubmit = null;

function buildControl(field) {
  const id = `f-${field.name}`;
  let control;

  if (field.type === 'textarea') {
    control = el('textarea', {
      id, name: field.name, value: field.value ?? '',
      attrs: { maxlength: field.maxLength ?? 500, rows: field.rows ?? 3 },
    });
  } else if (field.type === 'select') {
    control = el('select', { id, name: field.name },
      (field.options || []).map((option) => el('option', {
        value: String(option.value),
        text: option.label,
        selected: String(option.value) === String(field.value ?? ''),
      })));
  } else {
    control = el('input', {
      id, name: field.name, type: field.type || 'text',
      value: field.value ?? '',
      attrs: {
        ...(field.required ? { required: 'required' } : {}),
        ...(field.maxLength ? { maxlength: field.maxLength } : {}),
        ...(field.min !== undefined ? { min: field.min } : {}),
        ...(field.max !== undefined ? { max: field.max } : {}),
        ...(field.step !== undefined ? { step: field.step } : {}),
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      },
    });
  }

  return el('div', { class: 'field' }, [
    el('label', { text: field.label, attrs: { for: id } }),
    control,
    field.help ? el('p', { class: 'help', text: field.help }) : null,
  ]);
}

/**
 * เปิดกล่องโต้ตอบพร้อมฟอร์ม
 * @param {object} options
 * @param {string} options.title หัวข้อ
 * @param {Array} options.fields รายการช่องกรอก
 * @param {Function} options.onSubmit รับค่าที่กรอกแล้วคืน Promise
 * @param {string} [options.submitLabel]
 */
export function openForm({ title, fields, onSubmit, submitLabel = 'บันทึก' }) {
  dialogTitle.textContent = title;
  dialogSave.textContent = submitLabel;
  clear(dialogBody);

  const errorBox = el('div');
  dialogBody.append(errorBox);

  // จับคู่ช่องที่ตั้ง half: true ให้อยู่บรรทัดเดียวกัน
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const next = fields[index + 1];
    if (field.half && next && next.half) {
      dialogBody.append(el('div', { class: 'field-row' }, [buildControl(field), buildControl(next)]));
      index += 1;
    } else {
      dialogBody.append(buildControl(field));
    }
  }

  activeSubmit = async () => {
    const values = Object.create(null);
    for (const field of fields) {
      const control = dialogForm.elements.namedItem(field.name);
      if (!control) continue;
      values[field.name] = control.value;
    }

    render(errorBox);
    dialogSave.disabled = true;
    dialogSave.textContent = 'กำลังบันทึก...';

    try {
      await onSubmit(values);
      dialog.close();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่';
      const details = error instanceof ApiError ? error.details : [];
      render(errorBox, el('div', { class: 'alert alert-error' }, [
        el('div', { text: message }),
        details.length > 0 ? el('ul', {}, details.map((item) => el('li', { text: item }))) : null,
      ]));
    } finally {
      dialogSave.disabled = false;
      dialogSave.textContent = submitLabel;
    }
  };

  dialog.showModal();
  const firstInput = dialogBody.querySelector('input, select, textarea');
  if (firstInput) firstInput.focus();
}

dialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (activeSubmit) activeSubmit();
});

for (const button of [dialogCancel, dialogClose]) {
  button.addEventListener('click', () => dialog.close());
}

/** กล่องยืนยันก่อนลบ */
export function confirmAction(message) {
  // eslint-disable-next-line no-alert
  return window.confirm(message);
}
