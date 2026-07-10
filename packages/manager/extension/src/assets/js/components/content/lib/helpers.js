// ============================================
// Shared DOM Helpers for Content Script Fillers
// ============================================

export const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value',
).set;

export function setInput(el, value) {
  if (!el) {
    return false;
  }

  el.focus();
  nativeSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return true;
}

export function setSelect(el, value) {
  if (!el) {
    return false;
  }

  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function typeInto(el, value, delay = 30) {
  if (!el) {
    return Promise.resolve(false);
  }

  el.focus();
  nativeSetter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));

  return new Promise((resolve) => {
    let i = 0;

    function next() {
      if (i >= value.length) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        resolve(true);
        return;
      }

      nativeSetter.call(el, value.slice(0, i + 1));
      el.dispatchEvent(new Event('input', { bubbles: true }));

      const charCode = value.charCodeAt(i);
      for (const evtType of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(new KeyboardEvent(evtType, {
          key: value[i], code: `Digit${value[i]}`,
          charCode, keyCode: charCode, which: charCode,
          bubbles: true,
        }));
      }

      i++;
      setTimeout(next, delay);
    }

    next();
  });
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function createEl(tag, styles, attrs) {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
  }
  return e;
}
