/**
 * icon-renderer — the ONE Font Awesome DOM auto-render (C4 cp112), shared
 * by every browser surface: desktop renderers, web pages, and extension
 * pages when one appears. Authoring is plain Font Awesome markup:
 *
 *   <i class="fa-solid fa-rocket"></i>          — static HTML
 *   <i class="omega-flag omega-flag-us"></i>    — the flags namespace (#619)
 *   el.className = 'fa-sharp fa-light fa-play'  — set or CHANGED via JS,
 *                                                  any time; both render.
 *
 * The module owns everything except transport: scanning, the
 * MutationObserver (insertions AND class changes), class parsing
 * (icon-core's parseIconClasses), SVG root attributes, caching, and
 * re-render/clear semantics. The caller injects ONE function — where SVG
 * text comes from:
 *
 *   desktop  →  (name, style) => ipc.invoke('desktop:fontawesome:get', …)
 *   web      →  (name, style) => fetch(`/assets/icons/${style}/${name}.svg`)
 *   extension→  (name, style) => fetch(chrome.runtime.getURL(…))
 *
 * Rendered elements carry data-omega-fa="<style>/<name>". Unknown icons
 * leave the element empty (marked) — a missing icon is a content problem,
 * never a crash, and never a wrong-style fallback.
 */

const { parseIconClasses, isValidIconName, isValidStyle, injectSvgAttributes } = require('./icon-core.js');

// Both namespaces the class parser understands (#619): Font Awesome's fa-*
// and the country flags' omega-flag-*.
const ICON_SELECTOR = 'i[class*="fa-"], i[class*="omega-flag-"]';
const RENDERED_SELECTOR = `${ICON_SELECTOR}, i[data-omega-fa]`;

/**
 * Create an icon renderer bound to a transport.
 *
 * @param {object} options
 * @param {function(string, string): Promise<string|null>} options.resolve -
 *   Icon transport: (name, style) → raw SVG text or null.
 * @returns {{ start: function, stop: function, scan: function }}
 */
function createIconRenderer(options) {
  const cache = new Map(); // 'style/name' → Promise<string|null>
  let observer = null;
  let started = false;

  const resolve = (name, style) => {
    const key = `${style}/${name}`;
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve()
        .then(() => options.resolve(name, style))
        .then((svg) => (svg ? injectSvgAttributes(svg) : null))
        .catch(() => null));
    }
    return cache.get(key);
  };

  const render = (el) => {
    const parsed = parseIconClasses(el.classList);
    if (!parsed || !isValidIconName(parsed.name) || !isValidStyle(parsed.style)) {
      // No (valid) icon classes left — clear a previously rendered icon.
      if (el.dataset.omegaFa) {
        delete el.dataset.omegaFa;
        el.innerHTML = '';
      }
      return;
    }

    const key = `${parsed.style}/${parsed.name}`;
    if (el.dataset.omegaFa === key) {
      return;
    }

    el.dataset.omegaFa = key;
    el.innerHTML = '';
    resolve(parsed.name, parsed.style).then((svg) => {
      // Stale guard: classes may have changed again while resolving.
      if (svg && el.isConnected && el.dataset.omegaFa === key && !el.querySelector('svg')) {
        el.innerHTML = svg;
      }
    });
  };

  const scan = (root) => {
    if (root.matches?.(ICON_SELECTOR)) {
      render(root);
    }
    root.querySelectorAll?.(ICON_SELECTOR).forEach(render);
  };

  /**
   * Scan the document and observe it for inserted icons AND class changes
   * on existing ones. Idempotent.
   *
   * @param {Document} [doc] - Defaults to the global document.
   */
  const start = (doc = typeof document !== 'undefined' ? document : null) => {
    if (!doc || started) {
      return;
    }
    started = true;

    const begin = () => {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') {
            if (mutation.target.matches?.(RENDERED_SELECTOR)) {
              render(mutation.target);
            }
            continue;
          }
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              scan(node);
            }
          });
        }
      });
      observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
      });

      scan(doc.documentElement);
    };

    // Deferred until the document exists — preload-time callers (the
    // desktop test harness) run before documentElement is built.
    if (doc.documentElement && doc.readyState !== 'loading') {
      begin();
    } else {
      doc.addEventListener('DOMContentLoaded', begin, { once: true });
    }
  };

  const stop = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    started = false;
    cache.clear();
  };

  return { start, stop, scan };
}

module.exports = { createIconRenderer };
