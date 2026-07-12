/**
 * Extension-page icon auto-render (C4 cp112) — importing this module wires
 * the SAME shared watcher web and desktop run (@omega.js/client's
 * icon-renderer): plain fa-* markup, static or set/changed via JS, renders
 * inline SVGs. The extension's transport is its own packaged set —
 * dist/assets/fa/, emitted at build (gulp `fontawesome` task), fetched via
 * chrome.runtime.getURL, fully offline.
 *
 * Side-effect import, one line per page surface (popup/options/sidepanel/
 * page):  import './lib/icons.js';
 *
 * Content scripts deliberately do NOT auto-wire: watching a HOST page's
 * whole DOM would collide with sites that use Font Awesome themselves.
 * Injected UI can import { createIconRenderer } and scan() its own
 * container (assets/fa/* is web-accessible for exactly this).
 */
import { createIconRenderer } from '@omega.js/client/modules/icon-renderer.js';

if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof document !== 'undefined') {
  createIconRenderer({
    resolve: (name, style) => fetch(chrome.runtime.getURL(`assets/fa/${style}/${name}.svg`))
      .then((response) => (response.ok ? response.text() : null)),
  }).start(document);
}

export { createIconRenderer };
