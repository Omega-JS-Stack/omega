/**
 * Initialize Bootstrap Tooltips
 * Finds all elements with data-bs-toggle="tooltip" and initializes them
 *
 * The ONE home ([#99](https://github.com/Omega-JS-Stack/omega/issues/99)):
 * every theme shipped a byte-identical copy under its own `js/`, so a fix
 * had to be made three times. Themes import it off the core layer
 * (`__main_assets__/js/libs/initialize-tooltips.js`) — same lane as the
 * chart helper beside it — and `window.bootstrap` is already global by the
 * time a theme's DOM-ready handler calls this.
 *
 * @param {ParentNode} [$root] - the subtree to scan; markup injected AFTER the
 *   page-load pass (the change-plan modal's feature bullets) passes its own
 *   container so only the new triggers are wired.
 */
export default function initializeTooltips($root = document) {
  const $tooltipTriggers = $root.querySelectorAll('[data-bs-toggle="tooltip"]');

  // If no tooltips found, exit early
  if ($tooltipTriggers.length === 0) {
    return;
  }

  // Log the number of tooltips being initialized
  console.log(`Initializing ${$tooltipTriggers.length} tooltips`);

  // Initialize each tooltip
  $tooltipTriggers.forEach(($el) => {
    new bootstrap.Tooltip($el);
  });
}
