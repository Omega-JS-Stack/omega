/**
 * icons: the instance's Font Awesome auto-render (`omega.icons`), the one
 * renderer a surface binds to its icon transport.
 *
 * icon-core owns the icon semantics and icon-renderer owns the DOM watcher;
 * this module owns the renderer STATE for the instance, so a surface starts
 * the page's renderer through the instance instead of keeping one of its own:
 *
 *   omega.icons.start({ resolve: (name, style) => fetch(...) });
 *   omega.icons.scan($detachedRoot);
 *
 * The transport stays the surface's (web fetches, desktop asks main over IPC,
 * the extension reads its packed files), so it is an argument to start().
 */

import { createIconRenderer } from './icon-renderer.js';

/**
 * The instance's icon renderer, bound to a transport on start().
 */
class Icons {
  constructor() {
    // The renderer, built on the first start() with the surface's transport
    this._renderer = null;
  }

  /**
   * Bind the renderer to its transport and start rendering the document: a
   * scan now, then a MutationObserver for inserted icons and class changes.
   * Idempotent: a second start() keeps the renderer (and transport) it has.
   * @param {object} options
   * @param {function(string, string): Promise<string|null>} options.resolve -
   *   Icon transport: (name, style) to raw SVG text or null.
   * @param {Document} [doc] - Defaults to the global document.
   */
  start(options, doc) {
    if (!this._renderer) {
      this._renderer = createIconRenderer(options);
    }

    this._renderer.start(doc);
  }

  /**
   * Render every icon inside a root the observer cannot see (a detached tree).
   * @param {Element|Document} root
   */
  scan(root) {
    if (!this._renderer) {
      throw new Error('icons.scan() before icons.start(): no icon transport is bound yet');
    }

    this._renderer.scan(root);
  }

  /**
   * Stop observing, drop the cache and the transport. A later start() binds
   * a transport again.
   */
  stop() {
    if (!this._renderer) {
      return;
    }

    this._renderer.stop();
    this._renderer = null;
  }
}

export default Icons;
