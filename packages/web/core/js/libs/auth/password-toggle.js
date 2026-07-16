// The password eye — pure UI wiring for .uj-password-toggle input groups.
// Wired FIRST at boot (before any early-returning step) so the toggle works
// even when a custom token, OAuth redirect, or subdomain bounce takes over.

export function setupPasswordToggle() {
  const $toggleButtons = document.querySelectorAll('.uj-password-toggle');

  $toggleButtons.forEach(($button) => {
    $button.addEventListener('click', () => {
      // Find the password input in the same input group
      const $inputGroup = $button.closest('.input-group');
      const $passwordInput = $inputGroup.querySelector('input');

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
  });
}
