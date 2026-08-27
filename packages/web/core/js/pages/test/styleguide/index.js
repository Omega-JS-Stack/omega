// Styleguide page (/test/styleguide, #549) — wires the Bootstrap
// widgets that need explicit init (popovers, toasts). Tooltips are initialized
// theme-wide on DOM ready already, and the password eye is the shared
// `omega-password-toggle` click trigger (#16), armed by the global module.

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

    // Resolve after initialization
    return resolve();
  });
};
