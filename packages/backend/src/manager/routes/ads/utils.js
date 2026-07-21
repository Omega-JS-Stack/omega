/**
 * Shared utilities for the ads routes (house inventory).
 *
 * Owns the in-memory inventory cache (one Firestore read per instance per
 * TTL interval — Ian's ruling: runtime serving stays cheap), the selection
 * scoring pipeline (eligibility → contextual match score → weighted random),
 * and the self-contained ad unit HTML renderer.
 */

const BATCH_SIZE = 500;
const CACHE_TTL = 5 * 60 * 1000; // ~5 minutes

// Module-level inventory cache — shared by the serve and redirect routes.
const cache = {
  ads: null,
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
 * Resolve an ad's weight — required by spec, default 1. Anything
 * non-numeric or non-positive falls back to 1.
 */
function getWeight(ad) {
  const weight = Number(ad?.weight);

  return Number.isFinite(weight) && weight > 0
    ? weight
    : 1;
}

/**
 * Flatten an ad's targeting object (sites + categories + keywords) into
 * one normalized lowercase tag list.
 */
function getAdTags(ad) {
  const targeting = ad?.targeting || {};
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
 * advertise an ad whose link host IS the parent host (never-self).
 */
function isEligible(ad, parentHost) {
  // Disabled ads never serve
  if (ad?.enabled === false) {
    return false;
  }

  const whitelist = (ad?.whitelist || []).map(normalizeHost).filter((host) => host);
  const blacklist = (ad?.blacklist || []).map(normalizeHost).filter((host) => host);

  // Whitelisted ads only serve on their listed hosts (unknown parent fails closed)
  if (whitelist.length && !whitelist.includes(parentHost)) {
    return false;
  }

  // Blacklisted hosts never receive the ad
  if (parentHost && blacklist.includes(parentHost)) {
    return false;
  }

  // Never advertise a site to itself
  if (parentHost && normalizeHost(ad?.link) === parentHost) {
    return false;
  }

  return true;
}

/**
 * Filter an inventory down to the ads eligible for a parent host.
 */
function filterEligible(ads, parentHost) {
  return (ads || []).filter((ad) => isEligible(ad, parentHost));
}

/**
 * Contextual match score: the count of overlapping tags between the ad's
 * targeting and the request's tags. No tags on either side = 0 (neutral —
 * pure weighted shuffle, the legacy behavior).
 */
function scoreAd(ad, tags) {
  const adTags = getAdTags(ad);

  if (!adTags.length || !tags?.length) {
    return 0;
  }

  return tags.filter((tag) => adTags.includes(tag)).length;
}

/**
 * Weighted random pick from a list of ads (weight, default 1).
 */
function weightedPick(ads, random) {
  if (!ads?.length) {
    return null;
  }

  const roll = (random || Math.random)();
  const total = ads.reduce((sum, ad) => sum + getWeight(ad), 0);

  let cursor = roll * total;

  for (const ad of ads) {
    cursor -= getWeight(ad);

    if (cursor < 0) {
      return ad;
    }
  }

  return ads[ads.length - 1];
}

/**
 * Full selection pipeline: eligibility → adId pin → contextual match
 * score → weighted random among the top scorers. Returns null on no fill.
 */
function selectAd(ads, options) {
  options = options || {};

  const eligible = filterEligible(ads, options.parentHost || '');

  if (!eligible.length) {
    return null;
  }

  // Optional pin — serve the requested ad when it is eligible
  if (options.adId) {
    const pinned = eligible.find((ad) => ad.id === options.adId);

    if (pinned) {
      return pinned;
    }
  }

  // Score contextually and keep only the top scorers
  const tags = options.tags || [];
  const scored = eligible.map((ad) => ({ ad, score: scoreAd(ad, tags) }));
  const topScore = Math.max(...scored.map((entry) => entry.score));
  const top = scored.filter((entry) => entry.score === topScore).map((entry) => entry.ad);

  return weightedPick(top, options.random);
}

/**
 * Read the enabled ads inventory, cached in function memory (~5 min TTL —
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

  if (cache.ads && (now - cache.fetched) < ttl) {
    return cache.ads;
  }

  const { admin } = Manager.libraries;
  const db = admin.firestore();
  const ads = [];

  // Batch-read the collection (~500 cursor pagination per docs/firestore.md)
  let lastDoc = null;

  while (true) {
    let query = db.collection('ads').limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      ads.push({ id: doc.id, ...doc.data() });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }

  cache.ads = ads.filter((ad) => ad.enabled !== false);
  cache.fetched = now;

  return cache.ads;
}

/**
 * Reset the inventory cache (called by the admin CRUD writes so the same
 * instance serves fresh inventory immediately; also the test seam).
 */
function resetInventoryCache() {
  cache.ads = null;
  cache.fetched = 0;
}

/**
 * Look up a single ad by id — cache first, direct doc read on miss (a
 * freshly created or disabled ad must still resolve its OWN stored link).
 */
async function getAdById(Manager, id, options) {
  if (!id) {
    return null;
  }

  const inventory = await getInventory(Manager, options);
  const cached = inventory.find((ad) => ad.id === id);

  if (cached) {
    return cached;
  }

  const { admin } = Manager.libraries;
  const doc = await admin.firestore().doc(`ads/${id}`).get();

  if (!doc.exists) {
    return null;
  }

  return { id: doc.id, ...doc.data() };
}

/**
 * Render the self-contained ad unit page (inline CSS/JS only — no external
 * requests). Reports its rendered height via origin-checked postMessage
 * ('omega-ad:set-dimensions'), forwards clicks as 'omega-ad:click', and
 * links point at the redirect route. NO self-refresh timers — the HOST
 * owns the lifecycle (rotation, staleness recovery).
 */
function renderAdUnit(options) {
  const ad = options.ad || {};
  const theme = options.theme === 'dark' || options.theme === 'light'
    ? options.theme
    : '';
  const width = parseInt(options.width, 10) || 0;
  const height = parseInt(options.height, 10) || 0;
  // Origin-checked postMessage: when the parent origin is known (computed by
  // the serve route via normalizeOrigin — port-preserving), messages only
  // ever go to that origin.
  const targetOrigin = options.parentOrigin || '*';

  const image = isHttpUrl(ad.image)
    ? `<img class="omega-ad-image" src="${escapeHtml(ad.image)}" alt="">`
    : '';
  const description = ad.description
    ? `<p class="omega-ad-description">${escapeHtml(ad.description)}</p>`
    : '';
  const button = ad.button
    ? `<span class="omega-ad-button">${escapeHtml(ad.button)}</span>`
    : '';
  const footer = ad.footer
    ? `<footer class="omega-ad-footer">${escapeHtml(ad.footer)}</footer>`
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
      --omega-ad-bg: #ffffff;
      --omega-ad-border: #e2e2e2;
      --omega-ad-text: #1a1a1a;
      --omega-ad-muted: #6b6b6b;
      --omega-ad-accent: #1a1a1a;
      --omega-ad-accent-text: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --omega-ad-bg: #1a1a1a;
        --omega-ad-border: #333333;
        --omega-ad-text: #eeeeee;
        --omega-ad-muted: #999999;
        --omega-ad-accent: #eeeeee;
        --omega-ad-accent-text: #1a1a1a;
      }
    }
    :root[data-theme="light"] {
      --omega-ad-bg: #ffffff;
      --omega-ad-border: #e2e2e2;
      --omega-ad-text: #1a1a1a;
      --omega-ad-muted: #6b6b6b;
      --omega-ad-accent: #1a1a1a;
      --omega-ad-accent-text: #ffffff;
    }
    :root[data-theme="dark"] {
      --omega-ad-bg: #1a1a1a;
      --omega-ad-border: #333333;
      --omega-ad-text: #eeeeee;
      --omega-ad-muted: #999999;
      --omega-ad-accent: #eeeeee;
      --omega-ad-accent-text: #1a1a1a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: transparent; }
    body { font-family: -apple-system, system-ui, sans-serif; }
    .omega-ad {
      display: block;
      background: var(--omega-ad-bg);
      border: 1px solid var(--omega-ad-border);
      border-radius: 8px;
      color: var(--omega-ad-text);
      overflow: hidden;
      text-decoration: none;
      ${width ? `max-width: ${width}px;` : ''}
      ${height ? `max-height: ${height}px;` : ''}
    }
    .omega-ad-image { display: block; width: 100%; height: auto; }
    .omega-ad-content { padding: 12px 14px; }
    .omega-ad-title { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .omega-ad-description { font-size: 13px; color: var(--omega-ad-muted); line-height: 1.4; margin-top: 4px; }
    .omega-ad-button {
      display: inline-block;
      background: var(--omega-ad-accent);
      color: var(--omega-ad-accent-text);
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      padding: 6px 12px;
      margin-top: 10px;
    }
    .omega-ad-footer { font-size: 11px; color: var(--omega-ad-muted); padding: 0 14px 10px; }
  </style>
</head>
<body>
  <a class="omega-ad" id="omega-ad" href="${escapeHtml(options.redirectUrl)}" target="_blank" rel="noopener noreferrer sponsored">
    ${image}
    <div class="omega-ad-content">
      <h1 class="omega-ad-title">${escapeHtml(ad.title)}</h1>
      ${description}
      ${button}
    </div>
    ${footer}
  </a>
  <script>
    (function () {
      var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
      var AD_ID = ${JSON.stringify(ad.id || '')};

      function post(message) {
        if (!window.parent || window.parent === window) return;
        window.parent.postMessage(message, TARGET_ORIGIN);
      }

      function reportDimensions() {
        var doc = document.documentElement;
        post({ type: 'omega-ad:set-dimensions', id: AD_ID, width: doc.scrollWidth, height: doc.scrollHeight });
      }

      window.addEventListener('load', reportDimensions);

      if (window.ResizeObserver) {
        new ResizeObserver(reportDimensions).observe(document.documentElement);
      }

      document.getElementById('omega-ad').addEventListener('click', function () {
        post({ type: 'omega-ad:click', id: AD_ID });
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
  getAdTags,
  parseTags,
  isEligible,
  filterEligible,
  scoreAd,
  weightedPick,
  selectAd,
  getInventory,
  resetInventoryCache,
  getAdById,
  renderAdUnit,
};
