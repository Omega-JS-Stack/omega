// The password eye — web's own click trigger, registered on @omega.js/client's
// shared trigger registry (#16) as `omega-password-toggle`.
//
// Registered ONCE, from the global module (core/js/main.js), so it is armed on
// every page before any page module runs. The auth pages and the
// /test/components styleguide each used to wire this themselves with their own
// querySelectorAll loop, which meant two copies of the behavior and neither one
// seeing input groups rendered after boot. Delegation covers both.

// Libraries
import { registerTrigger } from '@omega.js/client/modules/triggers.js';

export function setupPasswordToggle() {
  registerTrigger('password-toggle', (event, $button) => {
    // Find the password input in the same input group
    const $inputGroup = $button.closest('.input-group');
    const $passwordInput = $inputGroup?.querySelector('input');

    if (!$passwordInput) {
      return;
    }

    // Toggle the input type
    const currentType = $passwordInput.type;
    const newType = currentType === 'password' ? 'text' : 'password';
    $passwordInput.type = newType;

    // Toggle icon visibility
    const $showIcon = $button.querySelector('.uj-password-show');
    const $hideIcon = $button.querySelector('.uj-password-hide');

    if (!$showIcon || !$hideIcon) {
      return;
    }

    if (newType === 'text') {
      $showIcon.classList.add('d-none');
      $hideIcon.classList.remove('d-none');
    } else {
      $showIcon.classList.remove('d-none');
      $hideIcon.classList.add('d-none');
    }
  });
}
