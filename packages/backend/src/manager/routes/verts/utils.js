/**
 * Shared utilities for the verts routes (house inventory).
 *
 * Owns the in-memory inventory cache (one Firestore read per instance per
 * TTL interval — Ian's ruling: runtime serving stays cheap), the selection
 * scoring pipeline (eligibility → contextual match score → weighted random),
 * and the self-contained vert unit HTML renderer.
 */

const BATCH_SIZE = 500;
const CACHE_TTL = 5 * 60 * 1000; // ~5 minutes

// Module-level inventory cache — shared by the serve and redirect routes.
const cache = {
  verts: null,
  fetched: 0,
};

/**
 * Normalize a host-ish value ('https://www.example.com/path', 'Example.com')
 * to a bare lowercase host ('example.com'). Returns '' when unparseable.
 */
function normalizeHost(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const raw = input.trim().toLowerCase();

  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
}

/**
 * Normalize a host-ish value to the ORIGIN parent-frame messages should
 * target — scheme + host with any explicit port PRESERVED
 * ('localhost:4100' → 'http://localhost:4100'; 'Example.com' →
 * 'https://example.com'). Local hosts speak http (dev servers have no TLS);
 * everything else https. A port-stripped origin would make the browser
 * silently drop every postMessage, collapsing dev units as no-fill.
 * Returns '' when unparseable.
 */
function normalizeOrigin(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const raw = input.trim().toLowerCase();

  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const hostname = url.hostname.replace(/^www\./, '');
    const isLocal = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
    const host = url.port ? `${hostname}:${url.port}` : hostname;

    return `${isLocal ? 'http' : 'https'}://${host}`;
  } catch (e) {
    return '';
  }
}

/**
 * True when the value is a usable http(s) URL.
 */
function isHttpUrl(input) {
  if (!input || typeof input !== 'string') {
    return false;
  }

  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Escape a string for safe insertion into HTML text/attribute context.
 */
function escapeHtml(input) {
  return `${input || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve a vert's weight — required by spec, default 1. Anything
 * non-numeric or non-positive falls back to 1.
 */
function getWeight(vert) {
  const weight = Number(vert?.weight);

  return Number.isFinite(weight) && weight > 0
    ? weight
    : 1;
}

/**
 * Flatten a vert's targeting object (sites + categories + keywords) into
 * one normalized lowercase tag list.
 */
function getVertTags(vert) {
  const targeting = vert?.targeting || {};
  const tags = []
    .concat(targeting.sites || [])
    .concat(targeting.categories || [])
    .concat(targeting.keywords || []);

  return tags
    .map((tag) => `${tag}`.trim().toLowerCase())
    .filter((tag) => tag);
}

/**
 * Parse a request's comma-separated tags string into a normalized list.
 */
function parseTags(input) {
  return `${input || ''}`
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag);
}

/**
 * Eligibility: enabled + whitelist/blacklist vs the parent host + never
 * advertise a vert whose link host IS the parent host (never-self).
 */
function isEligible(vert, parentHost) {
  // Disabled verts never serve
  if (vert?.enabled === false) {
    return false;
  }

  const whitelist = (vert?.whitelist || []).map(normalizeHost).filter((host) => host);
  const blacklist = (vert?.blacklist || []).map(normalizeHost).filter((host) => host);

  // Whitelisted verts only serve on their listed hosts (unknown parent fails closed)
  if (whitelist.length && !whitelist.includes(parentHost)) {
    return false;
  }

  // Blacklisted hosts never receive the vert
  if (parentHost && blacklist.includes(parentHost)) {
    return false;
  }

  // Never advertise a site to itself
  if (parentHost && normalizeHost(vert?.link) === parentHost) {
    return false;
  }

  return true;
}

/**
 * Filter an inventory down to the verts eligible for a parent host.
 */
function filterEligible(verts, parentHost) {
  return (verts || []).filter((vert) => isEligible(vert, parentHost));
}

/**
 * Contextual match score: the count of overlapping tags between the vert's
 * targeting and the request's tags. No tags on either side = 0 (neutral —
 * pure weighted shuffle, the legacy behavior).
 */
function scoreVert(vert, tags) {
  const vertTags = getVertTags(vert);

  if (!vertTags.length || !tags?.length) {
    return 0;
  }

  return tags.filter((tag) => vertTags.includes(tag)).length;
}

/**
 * Weighted random pick from a list of verts (weight, default 1).
 */
function weightedPick(verts, random) {
  if (!verts?.length) {
    return null;
  }

  const roll = (random || Math.random)();
  const total = verts.reduce((sum, vert) => sum + getWeight(vert), 0);

  let cursor = roll * total;

  for (const vert of verts) {
    cursor -= getWeight(vert);

    if (cursor < 0) {
      return vert;
    }
  }

  return verts[verts.length - 1];
}

/**
 * Full selection pipeline: eligibility → vertId pin → contextual match
 * score → weighted random among the top scorers. Returns null on no fill.
 */
function selectVert(verts, options) {
  options = options || {};

  const eligible = filterEligible(verts, options.parentHost || '');

  if (!eligible.length) {
    return null;
  }

  // Optional pin — serve the requested vert when it is eligible
  if (options.vertId) {
    const pinned = eligible.find((vert) => vert.id === options.vertId);

    if (pinned) {
      return pinned;
    }
  }

  // Score contextually and keep only the top scorers
  const tags = options.tags || [];
  const scored = eligible.map((vert) => ({ vert, score: scoreVert(vert, tags) }));
  const topScore = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === topScore).map((entry) => entry.vert);

  return weightedPick(top, options.random);
}

/**
 * Read the enabled verts inventory, cached in function memory (~5 min TTL —
 * one Firestore read per instance per interval, not per impression).
 *
 * Under the emulator (FIRESTORE_EMULATOR_HOST) the default TTL is 0 so dev
 * and route round-trip tests always see freshly seeded docs; cache-behavior
 * tests pass an explicit options.ttl instead.
 */
async function getInventory(Manager, options) {
  options = options || {};

  const ttl = typeof options.ttl === 'number'
    ? options.ttl
    : process.env.FIRESTORE_EMULATOR_HOST ? 0 : CACHE_TTL;
  const now = Date.now();

  if (cache.verts && (now - cache.fetched) < ttl) {
    return cache.verts;
  }

  const { admin } = Manager.libraries;
  const db = admin.firestore();
  const verts = [];

  // Batch-read the collection (~500 cursor pagination per docs/firestore.md)
  let lastDoc = null;

  while (true) {
    let query = db.collection('verts').limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      verts.push({ id: doc.id, ...doc.data() });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  cache.verts = verts.filter((vert) => vert.enabled !== false);
  cache.fetched = now;

  return cache.verts;
}

/**
 * Reset the inventory cache (called by the admin CRUD writes so the same
 * instance serves fresh inventory immediately; also the test seam).
 */
function resetInventoryCache() {
  cache.verts = null;
  cache.fetched = 0;
}

/**
 * Look up a single vert by id — cache first, direct doc read on miss (a
 * freshly created or disabled vert must still resolve its OWN stored link).
 */
async function getVertById(Manager, id, options) {
  if (!id) {
    return null;
  }

  const inventory = await getInventory(Manager, options);
  const cached = inventory.find((vert) => vert.id === id);

  if (cached) {
    return cached;
  }

  const { admin } = Manager.libraries;
  const doc = await admin.firestore().doc(`verts/${id}`).get();

  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() };
}

/**
 * Render the self-contained vert unit page (inline CSS/JS only — no external
 * requests). Reports its rendered height via origin-checked postMessage
 * ('omega-vert:set-dimensions'), forwards clicks as 'omega-vert:click', and
 * links point at the redirect route. NO self-refresh timers — the HOST
 * owns the lifecycle (rotation, staleness recovery).
 */
function renderVertUnit(options) {
  const vert = options.vert || {};
  const theme = options.theme === 'dark' || options.theme === 'light'
    ? options.theme
    : '';
  const width = parseInt(options.width, 10) || 0;
  const height = parseInt(options.height, 10) || 0;
  // Origin-checked postMessage: when the parent origin is known (computed by
  // the serve route via normalizeOrigin — port-preserving), messages only
  // ever go to that origin.
  const targetOrigin = options.parentOrigin || '*';

  const image = isHttpUrl(vert.image)
    ? `<img class="omega-vert-image" src="${escapeHtml(vert.image)}" alt="">`
    : '';
  const description = vert.description
    ? `<p class="omega-vert-description">${escapeHtml(vert.description)}</p>`
    : '';
  const button = vert.button
    ? `<span class="omega-vert-button">${escapeHtml(vert.button)}</span>`
    : '';
  const footer = vert.footer
    ? `<footer class="omega-vert-footer">${escapeHtml(vert.footer)}</footer>`
    : '';

  return `<!DOCTYPE html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Sponsored</title>
  <style>
    :root {
      --omega-vert-bg: #ffffff;
      --omega-vert-border: #e2e2e2;
      --omega-vert-text: #1a1a1a;
      --omega-vert-muted: #6b6b6b;
      --omega-vert-accent: #1a1a1a;
      --omega-vert-accent-text: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --omega-vert-bg: #1a1a1a;
        --omega-vert-border: #333333;
        --omega-vert-text: #eeeeee;
        --omega-vert-muted: #999999;
        --omega-vert-accent: #eeeeee;
        --omega-vert-accent-text: #1a1a1a;
      }
    }
    :root[data-theme="light"] {
      --omega-vert-bg: #ffffff;
      --omega-vert-border: #e2e2e2;
      --omega-vert-text: #1a1a1a;
      --omega-vert-muted: #6b6b6b;
      --omega-vert-accent: #1a1a1a;
      --omega-vert-accent-text: #ffffff;
    }
    :root[data-theme="dark"] {
      --omega-vert-bg: #1a1a1a;
      --omega-vert-border: #333333;
      --omega-vert-text: #eeeeee;
      --omega-vert-muted: #999999;
      --omega-vert-accent: #eeeeee;
      --omega-vert-accent-text: #1a1a1a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: transparent; }
    body { font-family: -apple-system, system-ui, sans-serif; }
    .omega-vert {
      display: block;
      background: var(--omega-vert-bg);
      border: 1px solid var(--omega-vert-border);
      border-radius: 8px;
      color: var(--omega-vert-text);
      overflow: hidden;
      text-decoration: none;
      ${width ? `max-width: ${width}px;` : ''}
      ${height ? `max-height: ${height}px;` : ''}
    }
    .omega-vert-image { display: block; width: 100%; height: auto; }
    .omega-vert-content { padding: 12px 14px; }
    .omega-vert-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .omega-vert-description { font-size: 13px; color: var(--omega-vert-muted); line-height: 1.4; margin-top: 4px; }
    .omega-vert-button {
      display: inline-block;
      background: var(--omega-vert-accent);
      color: var(--omega-vert-accent-text);
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      margin-top: 10px;
    }
    .omega-vert-footer { font-size: 11px; color: var(--omega-vert-muted); padding: 0 14px 10px; }
  </style>
</head>
<body>
  <a class="omega-vert" id="omega-vert" href="${escapeHtml(options.redirectUrl)}" target="_blank" rel="noopener noreferrer sponsored">
    ${image}
    <div class="omega-vert-content">
      <h1 class="omega-vert-title">${escapeHtml(vert.title)}</h1>
      ${description}
      ${button}
    </div>
    ${footer}
  </a>
  <script>
    (function () {
      var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
      var VERT_ID = ${JSON.stringify(vert.id || '')};

      function post(message) {
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage(message, TARGET_ORIGIN);
      }

      function reportDimensions() {
        var doc = document.documentElement;
        post({ type: 'omega-vert:set-dimensions', id: VERT_ID, width: doc.scrollWidth, height: doc.scrollHeight });
      }

      window.addEventListener('load', reportDimensions);

      if (window.ResizeObserver) {
        new ResizeObserver(reportDimensions).observe(document.documentElement);
      }

      document.getElementById('omega-vert').addEventListener('click', function () {
        post({ type: 'omega-vert:click', id: VERT_ID });
      });
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  CACHE_TTL,
  normalizeHost,
  normalizeOrigin,
  isHttpUrl,
  escapeHtml,
  getWeight,
  getVertTags,
  parseTags,
  isEligible,
  filterEligible,
  scoreVert,
  weightedPick,
  selectVert,
  getInventory,
  resetInventoryCache,
  getVertById,
  renderVertUnit,
};
