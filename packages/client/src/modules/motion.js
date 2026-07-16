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
 *   [data-omega-marquee]              — the logo set is cloned until half the
 *                                       track covers the container, then that
 *                                       half is doubled so the -50% CSS loop is
 *                                       seamless and NEVER runs dry; speed is a
 *                                       constant px/s (attr value overrides)
 *   [data-omega-scroll-watch="24"]    — stamps data-omega-scrolled="true|false"
 *                                       when window scrolls past the threshold
 *   [data-omega-segmented]            — gliding-thumb segmented control: the
 *                                       engine injects .omega-segmented__thumb
 *                                       and keeps it under the checked/.active
 *                                       segment (CSS transitions do the glide)
 *   [data-omega-dotfield="22"]        — canvas dot grid (value = px spacing):
 *                                       dots breathe on a slow traveling wave,
 *                                       tint toward the accent along it, and
 *                                       brighten/grow near the pointer
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
const MARQUEE_SPEED = 80; // px/s — data-omega-marquee="120" overrides per marquee

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
 * Grouping is inherited from the markup: "2017" stays ungrouped (years!),
 * "12,400" keeps its commas.
 * @param {string} text - the element's final text
 * @returns {{ prefix: string, value: number, decimals: number, suffix: string, grouped: boolean }|null}
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
  return { prefix: match[1], value, decimals, suffix: match[3], grouped: match[2].includes(',') };
}

/**
 * Format a count-up frame with the target's grouping and decimals.
 * @param {{ prefix: string, decimals: number, suffix: string, grouped: boolean }} target
 * @param {number} value - current frame value
 * @returns {string}
 */
function formatCount(target, value) {
  const fixed = value.toFixed(target.decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = target.grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  return `${target.prefix}${grouped}${fraction ? `.${fraction}` : ''}${target.suffix}`;
}

/**
 * Normalize any CSS color (hex, rgb, named, token value) to [r, g, b] using
 * the canvas context's own parser. Returns null for unparseable input.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} value
 * @returns {number[]|null}
 */
function parseColor(ctx, value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  ctx.fillStyle = '#000000';
  ctx.fillStyle = raw;
  const parsed = String(ctx.fillStyle);

  if (parsed.startsWith('#')) {
    return [
      parseInt(parsed.slice(1, 3), 16),
      parseInt(parsed.slice(3, 5), 16),
      parseInt(parsed.slice(5, 7), 16),
    ];
  }

  const match = parsed.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  const parts = match[1].split(',').map((part) => parseFloat(part));
  return [parts[0], parts[1], parts[2]];
}

/**
 * How many copies of the item set each track HALF needs so the -50% loop
 * never shows a gap: the half must be at least as wide as the container.
 * Unmeasurable geometry (jsdom, display:none) falls back to one copy.
 * @param {number} setWidth - width of one full set of items
 * @param {number} containerWidth - visible marquee width
 * @returns {number}
 */
function marqueeCopies(setWidth, containerWidth) {
  if (!(setWidth > 0) || !(containerWidth > 0)) {
    return 1;
  }
  return Math.max(1, Math.ceil(containerWidth / setWidth));
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

    const setItems = Array.from(track.children);
    const speed = Number(el.getAttribute('data-omega-marquee')) || MARQUEE_SPEED;

    // (Re)build: reset to the original set, clone it until half the track
    // covers the container, then double that half so translateX(-50%) loops
    // seamlessly. Duration scales with the half width → constant px/s.
    const build = () => {
      track.replaceChildren(...setItems);
      const setWidth = track.getBoundingClientRect().width;
      const copies = marqueeCopies(setWidth, el.clientWidth);
      const total = copies * 2 * setItems.length;

      while (track.children.length < total) {
        const clone = setItems[track.children.length % setItems.length].cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      }

      if (setWidth > 0) {
        track.style.setProperty('--omega-marquee-speed', `${Math.round((setWidth * copies) / speed)}s`);
      }
    };

    build();

    // Re-run when geometry settles or changes: container resize, webfont
    // swap, and images inside the set finishing their load.
    if (typeof ResizeObserver === 'function') {
      let lastWidth = el.clientWidth;
      new ResizeObserver(() => {
        if (el.clientWidth !== lastWidth) {
          lastWidth = el.clientWidth;
          build();
        }
      }).observe(el);
    }
    if (typeof document !== 'undefined') {
      document.fonts?.ready?.then(() => build()).catch(() => {});
    }
    setItems.forEach((item) => {
      item.querySelectorAll?.('img').forEach((img) => {
        if (!img.complete) {
          img.addEventListener('load', () => build(), { once: true });
        }
      });
    });
  };

  // ── segmented controls ─────────────────────────────────────────────────────

  const setupSegmented = (el) => {
    if (el.dataset.omegaSegmentedReady) {
      return;
    }

    const doc = el.ownerDocument;
    const thumb = doc.createElement('span');
    thumb.className = 'omega-segmented__thumb';
    thumb.setAttribute('aria-hidden', 'true');
    el.prepend(thumb);
    el.dataset.omegaSegmentedReady = 'true';

    const position = () => {
      const active = el.querySelector('.btn-check:checked + *')
        || el.querySelector('.active, [aria-pressed="true"]');
      if (!active || !active.offsetWidth) {
        thumb.style.opacity = '0';
        return;
      }
      thumb.style.opacity = '';
      thumb.style.setProperty('--omega-segment-x', `${active.offsetLeft}px`);
      thumb.style.setProperty('--omega-segment-y', `${active.offsetTop}px`);
      thumb.style.setProperty('--omega-segment-w', `${active.offsetWidth}px`);
      thumb.style.setProperty('--omega-segment-h', `${active.offsetHeight}px`);
    };

    // First position lands without a glide-in from 0,0
    thumb.style.transition = 'none';
    position();
    requestAnimationFrame(() => {
      thumb.style.transition = '';
      position();
    });

    // User input, programmatic .active/aria-pressed stamps (tab JS, platform
    // detection, appearance boot), geometry changes — all re-position.
    const deferred = () => requestAnimationFrame(position);
    el.addEventListener('click', deferred);
    el.addEventListener('change', deferred);
    if (typeof MutationObserver === 'function') {
      new MutationObserver(position).observe(el, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class', 'aria-pressed', 'aria-selected'],
      });
    }
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(position).observe(el);
    }
    doc.fonts?.ready?.then(position).catch(() => {});
  };

  // ── dot field ──────────────────────────────────────────────────────────────

  const setupDotfield = (el) => {
    if (el.dataset.omegaDotfieldReady) {
      return;
    }

    if (prefersReducedMotion()) {
      return; // the static CSS dot grid stays
    }

    const doc = el.ownerDocument;
    const canvas = doc.createElement('canvas');
    canvas.className = 'omega-dotfield__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext?.('2d');
    if (!ctx) {
      return; // no canvas support — the static CSS dot grid stays
    }

    el.dataset.omegaDotfieldReady = 'true';
    el.prepend(canvas);

    const spacing = Number(el.getAttribute('data-omega-dotfield')) || 22;
    const colors = { base: [128, 128, 128], accent: [128, 128, 128] };
    const pointer = { x: -1e4, y: -1e4, targetX: -1e4, targetY: -1e4 };
    let width = 0;
    let height = 0;
    let dpr = 1;
    let running = false;
    let raf = 0;
    let lastColorRead = 0;

    const readColors = () => {
      const styles = window.getComputedStyle(el);
      colors.base = parseColor(ctx, styles.getPropertyValue('--omega-line-strong')) || colors.base;
      colors.accent = parseColor(ctx, styles.getPropertyValue('--omega-accent')) || colors.accent;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = el.clientWidth;
      height = el.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    const WAVE_LENGTH = (Math.PI * 2) / 900; // ~900px crest-to-crest diagonal
    const POINTER_RADIUS = 2 * 110 * 110; // gaussian falloff (~110px reach)

    const draw = (now) => {
      raf = 0;
      if (!running) {
        return;
      }

      // Theme flips (data-bs-theme) land within a second
      if (now - lastColorRead > 1000) {
        lastColorRead = now;
        readColors();
      }

      // Ease the pointer toward its target for a soft trail
      pointer.x += (pointer.targetX - pointer.x) * 0.12;
      pointer.y += (pointer.targetY - pointer.y) * 0.12;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const [br, bg, bb] = colors.base;
      const [ar, ag, ab] = colors.accent;
      const t = now / 1000;

      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          // Slow diagonal wave sweeping the grid; pointer adds a local lift
          const wave = 0.5 + 0.5 * Math.sin((x + y * 0.6) * WAVE_LENGTH - t * 0.7);
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const boost = Math.exp(-(dx * dx + dy * dy) / POINTER_RADIUS);

          const mix = Math.min(1, wave * 0.45 + boost * 0.55);
          const alpha = Math.min(1, 0.28 + wave * 0.38 + boost * 0.5);
          const radius = 1 + wave * 0.35 + boost * 0.9;

          ctx.fillStyle = `rgba(${Math.round(br + (ar - br) * mix)},${Math.round(bg + (ag - bg) * mix)},${Math.round(bb + (ab - bb) * mix)},${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    const setRunning = (on) => {
      if (on === running) {
        return;
      }
      running = on;
      if (on && !raf) {
        raf = requestAnimationFrame(draw);
      }
    };

    readColors();
    resize();

    el.addEventListener('pointermove', (event) => {
      const rect = el.getBoundingClientRect();
      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = event.clientY - rect.top;
    });
    el.addEventListener('pointerleave', () => {
      pointer.targetX = -1e4;
      pointer.targetY = -1e4;
    });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(resize).observe(el);
    }

    // Only draw while on screen and the tab is visible
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => setRunning(entry.isIntersecting && !doc.hidden));
      }).observe(el);
    } else {
      setRunning(true);
    }
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) {
        setRunning(false);
      } else if (el.isConnected) {
        setRunning(true);
      }
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
    all('[data-omega-segmented]').forEach(setupSegmented);
    all('[data-omega-dotfield]').forEach(setupDotfield);
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

module.exports = { createMotion, parseCountTarget, formatCount, marqueeCopies, parseColor };
