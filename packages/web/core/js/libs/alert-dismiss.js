// The site alerts' dismiss — the × on a `.main-alert` closes it
// ([#719](https://github.com/Omega-JS-Stack/omega/issues/719)).
//
// #719 made the control a real `<button>` so it is keyboard-reachable and
// named; this is what listening to it. Registered ONCE, from the global module
// (core/js/main.js), so every page's alerts are dismissible before any page
// module runs — the same lane the password eye rides.
//
// Delegated off `document` (the idiom core/js/core/app-shell.js and
// appearance.js use for their own markup-driven controls), so the alerts stay
// pure markup: `core/_includes/core/body.html` ships three of them hidden, a
// fourth may be injected by a theme, and none of them needs wiring.

export function setupAlertDismiss() {
  document.addEventListener('click', (event) => {
    const $close = event.target.closest('.main-alert-close');

    if (!$close) {
      return;
    }

    const $alert = $close.closest('.main-alert');

    if (!$alert) {
      return;
    }

    event.preventDefault();

    // `hidden` is how the alerts ship (body.html stamps it on every one), so
    // dismissing puts an alert back exactly where it started — whatever raised
    // it can raise it again.
    $alert.hidden = true;
  });
}
