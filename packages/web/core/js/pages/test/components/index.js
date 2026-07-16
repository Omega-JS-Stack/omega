// Components styleguide page (/test/components) — wires the Bootstrap
// widgets that need explicit init (popovers, toasts) plus the password-eye
// demo. Tooltips are initialized theme-wide on DOM ready already.

// Libraries
import omega from '@omega.js/client';

// Module
export default () => {
  return new Promise(async function (resolve) {
    // Initialize when DOM is ready
    await omega.dom().ready();

    const bootstrap = window.bootstrap;
    if (bootstrap) {
      // Popovers opt in per element
      document.querySelectorAll('[data-bs-toggle="popover"]').forEach(($el) => {
        new bootstrap.Popover($el);
      });

      // Toast trigger
      const $toastButton = document.getElementById('sg-toast-btn');
      const $toast = document.getElementById('sg-toast');
      if ($toastButton && $toast) {
        $toastButton.addEventListener('click', () => {
          bootstrap.Toast.getOrCreateInstance($toast).show();
        });
      }
    }

    // Password eye demo — same markup contract as the auth pages
    document.querySelectorAll('.uj-password-toggle').forEach(($toggle) => {
      $toggle.addEventListener('click', () => {
        const $input = $toggle.closest('.input-group')?.querySelector('input');
        if (!$input) {
          return;
        }
        const show = $input.type === 'password';
        $input.type = show ? 'text' : 'password';
        $toggle.querySelector('.uj-password-show')?.classList.toggle('d-none', show);
        $toggle.querySelector('.uj-password-hide')?.classList.toggle('d-none', !show);
      });
    });

    // Resolve after initialization
    return resolve();
  });
};
