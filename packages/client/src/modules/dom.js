// Load external script dynamically
export function loadScript(options) {
  return new Promise((resolve, reject) => {
    // Handle simple string parameter
    if (typeof options === 'string') {
      options = { src: options };
    }

    const {
      src,
      async = true,
      defer = false,
      crossorigin = false,
      integrity = null,
      attributes = {},
      timeout = 60000,
      retries = 0,
      parent = null
    } = options;

    if (!src) {
      return reject(new Error('Script source is required'));
    }

    let timeoutId;
    let retryCount = 0;

    function createAndLoadScript() {
      const script = document.createElement('script');
      script.src = src;
      script.async = async;
      script.defer = defer;

      if (crossorigin) {
        script.crossOrigin = typeof crossorigin === 'string' ? crossorigin : 'anonymous';
      }

      if (integrity) {
        script.integrity = integrity;
      }

      // Add custom attributes
      Object.keys(attributes).forEach(name => {
        script.setAttribute(name, attributes[name]);
      });

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          script.remove();
          handleError(new Error(`Script load timeout: ${src}`));
        }, timeout);
      }

      // Event handlers
      script.onload = () => {
        clearTimeout(timeoutId);
        resolve({ script, cached: false });
      };

      script.onerror = (error) => {
        clearTimeout(timeoutId);
        script.remove();
        handleError(new Error(`Failed to load script ${src}`, { cause: error }));
      };

      // Append to document
      const $targetParent = parent || document.head || document.documentElement;
      $targetParent.appendChild(script);
    }

    function handleError(error) {
      if (retryCount < retries) {
        retryCount++;
        setTimeout(createAndLoadScript, 1000 * retryCount);
      } else {
        reject(error);
      }
    }

    createAndLoadScript();
  });
}

// The longest a settle waits for the window's load event: a page whose load
// never fires still starts its deferred work
const LOAD_CEILING_MS = 10000;

/**
 * Run `fn` once first paint has settled: after the window's load event (or
 * LOAD_CEILING_MS, whichever comes first), at the next idle callback. The ONE
 * scheduler for work kept out of the first-paint window (the motion dotfield,
 * the Sentry SDK).
 * @param {Function} fn - the work that waits for the settle signal
 * @param {object} options
 * @param {number} options.timeout - the idle callback's deadline, in ms
 * @param {number} [options.fallbackDelay] - where requestIdleCallback is missing, the ms to wait; omitted, `fn` runs at once
 * @param {Document} [options.doc] - the document whose readyState counts; none means settled already
 */
export function whenSettled(fn, { timeout, fallbackDelay, doc } = {}) {
  const idle = () => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout });
    } else if (fallbackDelay === undefined) {
      fn();
    } else {
      setTimeout(fn, fallbackDelay);
    }
  };

  if (!doc || doc.readyState === 'complete') {
    idle();
    return;
  }

  // Whichever of the load event and the ceiling comes first starts the wait
  let started = false;
  let ceiling = null;
  const start = () => {
    if (started) {
      return;
    }
    started = true;
    clearTimeout(ceiling);
    idle();
  };

  ceiling = setTimeout(start, LOAD_CEILING_MS);
  window.addEventListener('load', start, { once: true });
}

/**
 * Swap an element's children for `nodes`: the native replaceChildren where the
 * browser has it (newer than the browser floor), else a clear and an append.
 */
export function replaceChildren(el, ...nodes) {
  if (typeof el.replaceChildren === 'function') {
    el.replaceChildren(...nodes);
    return;
  }

  el.innerHTML = '';
  el.append(...nodes);
}

// Return promise that resolves when DOM is ready
export function ready() {
  return new Promise((resolve) => {
    if (document.readyState === 'loading') {
      // Wait for DOM if still loading
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      // DOM is already ready
      resolve();
    }
  });
}
