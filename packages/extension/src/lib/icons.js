/**
 * Extension-page icon auto-render (C4 cp112) — importing this module wires
 * the SAME shared watcher web and desktop run (@omega.js/client's
 * icon-renderer): plain fa-* markup, static or set/changed via JS, renders
 * inline SVGs. The extension's transport is its own packaged set —
 * dist/assets/icons/, emitted at build (gulp `fontawesome` task), fetched via
 * chrome.runtime.getURL, fully offline.
 *
 * Side-effect import, one line per page surface (popup/options/sidepanel/
 * page):  import './lib/icons.js';
 *
 * Content scripts deliberately do NOT auto-wire: watching a HOST page's
 * whole DOM would collide with sites that use Font Awesome themselves.
 * Injected UI can import { createIconRenderer } and scan() its own
 * container (assets/icons/* is web-accessible for exactly this).
 */
import { createIconRenderer } from '@omega.js/client/modules/icon-renderer.js';
import { ICONS_DIR, candidateRelPaths } from '@omega.js/client/modules/icon-core.js';

if (typeof chrome !== 'undefined' && chrome.runtime?.getURL && typeof document !== 'undefined') {
  createIconRenderer({
    // icon-core's candidate order — the requested style, then `brands/` — so
    // `<i class="fa-solid fa-github">` renders here exactly as it does on web
    // and desktop. Sequential by definition: brands/ is only ever asked for
    // when the requested style dir has no such file.
    resolve: async (name, style) => {
      for (const rel of candidateRelPaths(name, style)) {
        const response = await fetch(chrome.runtime.getURL(`assets/${ICONS_DIR}/${rel}`));
        if (response.ok) return response.text();
      }
      return null;
    },
  }).start(document);
}

export { createIconRenderer };
