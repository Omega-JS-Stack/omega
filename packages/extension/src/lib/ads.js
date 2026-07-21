/**
 * Ad auto-bind (ads-system phase 4) — wires the shared client ads module to
 * every [data-omega-ad] element on the page: present at boot, or inserted
 * later (MutationObserver). Each element is handed to omega.ads().mount()
 * with the type PINNED to 'house' — extension surfaces never run the AdSense
 * provider lane (store policy + the MV3 extension_pages CSP blocks the remote
 * script), so the whole ladder is the house/company inventory: lazy arming
 * near the viewport, sandboxed iframe to /omega/ads/serve, origin-validated
 * postMessage, host-owned rotation/staleness recovery, no-fill collapse.
 * All lifecycle logic lives in @omega.js/client (modules/ads.js) — this file
 * only binds the element vocabulary.
 *
 * Called from each page-surface Manager (popup/options/sidepanel/page) after
 * omega.initialize():  wireAds();
 *
 * Content scripts deliberately do NOT auto-wire (same rule as lib/icons.js):
 * scanning a HOST page's whole DOM would mount ads into arbitrary websites.
 */
import omega from '@omega.js/client';

// The element vocabulary (mirrors @omega.js/desktop's renderer binder)
const SELECTOR = '[data-omega-ad]';

// Idempotence — one observer per page, no matter how often wireAds runs
let wired = false;

function wireAds() {
  if (wired || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return;
  }
  wired = true;

  const mount = ($el) => {
    // Type pinned to 'house': mount() merges passed options OVER the element
    // attributes, so render() can never take the AdSense lane here
    omega.ads().mount($el, { type: 'house' });
    $el.setAttribute('data-omega-ad-bound', 'house');
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
