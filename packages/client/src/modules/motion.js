/**
 * motion — the ONE animation engine (C3 classy v2), shared by every browser
 * surface the same way icon-renderer is: web pages today, desktop/extension
 * at C4. It drives the `data-omega-*` motion attributes that the core motion
 * stylesheet (web: core/css/motion/_index.scss) styles:
 *
 *   [data-omega-reveal="up|fade|left|right|scale"] — reveal once on scroll-in
 *   [data-omega-reveal-stagger="60"]  — parent staggers child reveals (ms step)
 *   [data-omega-countup]              — number counts up from 0 on first view
 *                                       (markup carries the FINAL text: "12,400+")
 *   [data-omega-rotate="2600"]        — children cycle via data-omega-active (ms)
 *   [data-omega-marquee]              — track content duplicated once for the
 *                                       seamless -50% CSS loop
 *   [data-omega-scroll-watch="24"]    — stamps data-omega-scrolled="true|false"
 *                                       when window scrolls past the threshold
 *
 * Resilience contract (mirrors the stylesheet):
 *   - The page stamps html[data-omega-motion] via an inline head script; the
 *     stylesheet only hides reveal targets under that stamp, so no-JS pages
 *     render fully visible.
 *   - prefers-reduced-motion: reveals resolve instantly, countups render their
 *     final value, rotators hold the first word, marquees stay static.
 *   - start() is idempotent; a MutationObserver picks up inserted content, and
 *     scan(root) is exposed for callers that render into detached roots.
 */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const COUNTUP_DURATION = 1200;

/**
 * Whether the user asked for reduced motion.
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_QUERY).matches;
}

/**
 * Parse a rendered number ("12,400+", "$1.2M", "99.98%") into its parts.
 * @param {string} text - the element's final text
 * @returns {{ prefix: string, value: number, decimals: number, suffix: string }|null}
 */
function parseCountTarget(text) {
  const match = String(text).trim().match(/^([^0-9-]*)(-?[\d,]*\.?\d+)(.*)$/s);
  if (!match) {
    return null;
  }

  const raw = match[2].replace(/,/g, '');
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }

  const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
  return { prefix: match[1], value, decimals, suffix: match[3] };
}

/**
 * Format a count-up frame with the target's grouping and decimals.
 * @param {{ prefix: string, decimals: number, suffix: string }} target
 * @param {number} value - current frame value
 * @returns {string}
 */
function formatCount(target, value) {
  const fixed = value.toFixed(target.decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${target.prefix}${grouped}${fraction ? `.${fraction}` : ''}${target.suffix}`;
}

/**
 * Create the motion engine. One instance per document is plenty.
 * @returns {{ start: function, stop: function, scan: function }}
 */
function createMotion() {
  let started = false;
  let revealObserver = null;
  let countObserver = null;
  let mutationObserver = null;
  let scrollWatchers = [];
  let rotateTimers = new Map();
  let scrollHandler = null;

  // ── reveals ────────────────────────────────────────────────────────────────

  const markInview = (el) => el.setAttribute('data-omega-inview', 'true');

  const observeReveal = (el) => {
    if (el.hasAttribute('data-omega-inview')) {
      return;
    }
    if (!revealObserver) {
      markInview(el);
      return;
    }
    revealObserver.observe(el);
  };

  const applyStagger = (parent) => {
    const step = Number(parent.getAttribute('data-omega-reveal-stagger')) || 60;
    parent.querySelectorAll('[data-omega-reveal]').forEach((el, index) => {
      el.style.setProperty('--omega-reveal-delay', `${index * step}ms`);
    });
  };

  // ── count-up ───────────────────────────────────────────────────────────────

  const runCountup = (el) => {
    if (el.dataset.omegaCountupDone) {
      return;
    }
    el.dataset.omegaCountupDone = 'true';

    const target = parseCountTarget(el.textContent);
    if (!target || prefersReducedMotion()) {
      return; // markup already shows the final value
    }

    const startTime = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startTime) / COUNTUP_DURATION, 1);
      const eased = 1 - ((1 - progress) ** 3);
      el.textContent = formatCount(target, target.value * eased);
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };
    el.textContent = formatCount(target, 0);
    requestAnimationFrame(tick);
  };

  const observeCountup = (el) => {
    if (el.dataset.omegaCountupDone) {
      return;
    }
    if (!countObserver) {
      runCountup(el);
      return;
    }
    countObserver.observe(el);
  };

  // ── word rotator ───────────────────────────────────────────────────────────

  const setupRotate = (el) => {
    if (rotateTimers.has(el)) {
      return;
    }

    const words = Array.from(el.children);
    if (!words.length) {
      return;
    }

    let index = 0;
    words.forEach((word, i) => word.toggleAttribute('data-omega-active', i === 0));

    if (prefersReducedMotion() || words.length < 2) {
      rotateTimers.set(el, null); // static first word, but marked as handled
      return;
    }

    const interval = Number(el.getAttribute('data-omega-rotate')) || 2600;
    const timer = setInterval(() => {
      if (!el.isConnected) {
        clearInterval(timer);
        rotateTimers.delete(el);
        return;
      }
      index = (index + 1) % words.length;
      words.forEach((word, i) => word.toggleAttribute('data-omega-active', i === index));
    }, interval);
    rotateTimers.set(el, timer);
  };

  // ── marquee ────────────────────────────────────────────────────────────────

  const setupMarquee = (el) => {
    if (el.dataset.omegaMarqueeReady) {
      return;
    }
    el.dataset.omegaMarqueeReady = 'true';

    if (prefersReducedMotion()) {
      return; // CSS animation is off — leave the single static row
    }

    const track = el.querySelector('.omega-marquee__track');
    if (!track || !track.children.length) {
      return;
    }

    // Duplicate the content ONCE so translateX(-50%) loops seamlessly.
    Array.from(track.children).forEach((item) => {
      const clone = item.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    });
  };

  // ── scroll watch ───────────────────────────────────────────────────────────

  const syncScrollWatchers = () => {
    const y = window.scrollY;
    scrollWatchers = scrollWatchers.filter((entry) => entry.el.isConnected);
    scrollWatchers.forEach((entry) => {
      entry.el.setAttribute('data-omega-scrolled', y > entry.threshold ? 'true' : 'false');
    });
  };

  const setupScrollWatch = (el) => {
    if (scrollWatchers.some((entry) => entry.el === el)) {
      return;
    }
    scrollWatchers.push({ el, threshold: Number(el.getAttribute('data-omega-scroll-watch')) || 24 });
    syncScrollWatchers();
  };

  // ── scan ───────────────────────────────────────────────────────────────────

  /**
   * Wire every motion attribute under (and on) a root. Idempotent.
   * @param {Element|Document} root
   */
  const scan = (root) => {
    if (!root || !root.querySelectorAll) {
      return;
    }

    const all = (selector) => {
      const found = Array.from(root.querySelectorAll(selector));
      if (root.matches?.(selector)) {
        found.unshift(root);
      }
      return found;
    };

    all('[data-omega-reveal-stagger]').forEach(applyStagger);
    all('[data-omega-reveal]').forEach(observeReveal);
    all('[data-omega-countup]').forEach(observeCountup);
    all('[data-omega-rotate]').forEach(setupRotate);
    all('[data-omega-marquee]').forEach(setupMarquee);
    all('[data-omega-scroll-watch]').forEach(setupScrollWatch);
  };

  /**
   * Scan the document and observe it for inserted motion targets. Idempotent.
   * @param {Document} [doc] - Defaults to the global document.
   */
  const start = (doc = typeof document !== 'undefined' ? document : null) => {
    if (!doc || started) {
      return;
    }
    started = true;

    const begin = () => {
      if (typeof IntersectionObserver === 'function' && !prefersReducedMotion()) {
        revealObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              markInview(entry.target);
              revealObserver.unobserve(entry.target);
            }
          });
        }, { threshold: 0.1, rootMargin: '0px 0px -8% 0px' });

        countObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              runCountup(entry.target);
              countObserver.unobserve(entry.target);
            }
          });
        }, { threshold: 0.4 });
      }

      scrollHandler = (() => {
        let ticking = false;
        return () => {
          if (ticking) {
            return;
          }
          ticking = true;
          requestAnimationFrame(() => {
            syncScrollWatchers();
            ticking = false;
          });
        };
      })();
      window.addEventListener('scroll', scrollHandler, { passive: true });

      if (typeof MutationObserver === 'function') {
        mutationObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) {
                scan(node);
              }
            });
          }
        });
        mutationObserver.observe(doc.documentElement, { childList: true, subtree: true });
      }

      scan(doc);
    };

    if (doc.documentElement && doc.readyState !== 'loading') {
      begin();
    } else {
      doc.addEventListener('DOMContentLoaded', begin, { once: true });
    }
  };

  const stop = () => {
    revealObserver?.disconnect();
    countObserver?.disconnect();
    mutationObserver?.disconnect();
    revealObserver = null;
    countObserver = null;
    mutationObserver = null;
    if (scrollHandler) {
      window.removeEventListener('scroll', scrollHandler);
      scrollHandler = null;
    }
    rotateTimers.forEach((timer) => timer && clearInterval(timer));
    rotateTimers = new Map();
    scrollWatchers = [];
    started = false;
  };

  return { start, stop, scan };
}

module.exports = { createMotion, parseCountTarget, formatCount };
