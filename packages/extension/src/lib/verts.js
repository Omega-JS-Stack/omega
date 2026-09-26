/**
 * Vert auto-bind (ads-system phase 4) — wires the shared client verts module to
 * every [data-omega-vert] element on the page: present at boot, or inserted
 * later (MutationObserver). Each element is handed to omega.verts.mount()
 * with the type PINNED to 'house' — extension surfaces never run the AdSense
 * provider lane (store policy + the MV3 extension_pages CSP blocks the remote
 * script), so the whole ladder is the house/company inventory: lazy arming
 * near the viewport, sandboxed iframe to /omega/verts/serve, origin-validated
 * postMessage, host-owned rotation/staleness recovery, no-fill collapse.
 * All lifecycle logic lives in @omega.js/client (modules/verts.js) — this file
 * only binds the element vocabulary.
 *
 * Called from the page contexts' initialize() (src/page-context.js) after the
 * client boots:  wireAds(this);
 *
 * Content scripts deliberately do NOT auto-wire (same rule as lib/icons.js):
 * scanning a HOST page's whole DOM would mount verts into arbitrary websites.
 */
// The element vocabulary (mirrors @omega.js/desktop's renderer binder)
const SELECTOR = '[data-omega-vert]';

// Idempotence — one observer per page, no matter how often wireAds runs
let wired = false;

/**
 * Bind every present and future [data-omega-vert] element to the house lane.
 * @param {object} omega - the page context's Omega instance
 * @returns {void}
 */
function wireAds(omega) {
  if (wired || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }
  wired = true;

  const mount = ($el) => {
    // Type pinned to 'house': mount() merges passed options OVER the element
    // attributes, so render() can never take the AdSense lane here
    omega.verts.mount($el, { type: 'house' });
    $el.setAttribute('data-omega-vert-bound', 'house');
  };

  const scan = (root) => {
    if (root.matches?.(SELECTOR)) {
      mount(root);
    }
    root.querySelectorAll?.(SELECTOR).forEach(mount);
  };

  const start = () => {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            scan(node);
          }
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    scan(document.documentElement);
  };

  if (document.documentElement && document.readyState !== 'loading') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}

export { wireAds };
