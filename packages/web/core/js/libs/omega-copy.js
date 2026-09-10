// Declarative copy-to-clipboard — an element carrying `data-omega-copy` IS a
// copy control ([#709](https://github.com/Omega-JS-Stack/omega/issues/709)).
//
// Every copy button was hand-wired before this: the account page's api-keys
// section wrote `clipboardCopy` + `showNotification` three times over, and
// each brand that wanted a copy row wrote the same handler again. Marking the
// control is now the whole job — no page JS at all.
//
// Delegated off `document` (the alert-dismiss lane), registered ONCE from the
// global module (core/js/main.js), so a row rendered after boot is a copy
// control too, with nothing to rewire.
//
// What gets copied is RESOLVED, in this order:
//   1. an explicit value — the `omegaCopyValue` property a page module set, or
//      a `data-omega-copy-value` attribute. Load-bearing, not sugar: a
//      key-bearing row DISPLAYS a mask and must COPY the real credential, so
//      display and clipboard are allowed to differ.
//   2. `data-omega-copy` holding a selector → that target's value (an input)
//      or its text (a `<pre>` block).
//   3. the sibling input in the same `.input-group` — the bare
//      `<input><button data-omega-copy>` row, which needs no value at all.

import omega from '@omega.js/client';

const CONTROL_SELECTOR = '[data-omega-copy]';
const GROUP_SELECTOR = '.input-group';
const FIELD_SELECTOR = 'input, textarea';

export function setupCopy() {
  document.addEventListener('click', async (event) => {
    const $control = event.target.closest(CONTROL_SELECTOR);

    if (!$control) {
      return;
    }

    event.preventDefault();

    const value = resolveValue($control);

    // An empty field is the account page's "still loading" case, not a
    // failure — and never a silently emptied clipboard.
    if (!value) {
      omega.utilities().showNotification('Nothing to copy', 'warning');
      return;
    }

    try {
      await omega.utilities().clipboardCopy(value);
      omega.utilities().showNotification('Copied!', 'success');
    } catch (e) {
      // Reachable since #726 — `clipboardCopy` rejects on a real refusal, so
      // this notification stopped being dead code and the reason belongs in
      // the console, not only in a toast.
      console.error('Failed to copy to clipboard:', e);
      omega.utilities().showNotification('Failed to copy', 'danger');
    }
  });
}

// The resolution order above, first answer wins.
function resolveValue($control) {
  if (typeof $control.omegaCopyValue === 'string') {
    return $control.omegaCopyValue;
  }

  const explicit = $control.getAttribute('data-omega-copy-value');

  if (explicit !== null) {
    return explicit;
  }

  const selector = $control.getAttribute('data-omega-copy');

  if (selector) {
    const $target = document.querySelector(selector);

    return $target ? readValue($target) : null;
  }

  const $field = $control.closest(GROUP_SELECTOR)?.querySelector(FIELD_SELECTOR);

  return $field ? readValue($field) : null;
}

// A field answers with its value, anything else (a `<pre>` snippet) with its text.
function readValue($target) {
  return typeof $target.value === 'string' ? $target.value : $target.textContent;
}
