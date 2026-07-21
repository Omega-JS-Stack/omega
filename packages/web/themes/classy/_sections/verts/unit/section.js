/**
 * Vert unit behavior — hands the inner host to the shared client verts module,
 * which owns the WHOLE lifecycle: lazy arming near the viewport, then the
 * ladder — AdSense when configured
 * (script-load failure IS the adblock detector) → the in-house/company
 * fallback lane (sandboxed iframe, origin-validated postMessage, host-owned
 * rotation + staleness recovery) → no-fill collapse. One implementation
 * across web/desktop/extension (the data-omega-vert vocabulary). Paying users
 * never see the unit: the host carries the standard
 * `@hide auth.resolved.active` binding.
 */
import omega from '@omega.js/client';

export default (el) => {
  const $host = el.querySelector('.omega-vert-unit');
  if (!$host) {
    return;
  }

  omega.verts().mount($host);
};
