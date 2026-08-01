/**
 * Shared utilities for the verts routes (house inventory).
 *
 * Owns the in-memory inventory cache (one Firestore read per instance per
 * TTL interval — Ian's ruling: runtime serving stays cheap), the selection
 * scoring pipeline (eligibility → contextual match score → weighted random),
 * and the mapping of a stored vert onto the shared unit-document renderer in
 * @omega.js/client (this package holds no unit template of its own).
 */

const { BRAND_ID_PATTERN } = require('@omega.js/config');

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
 * Normalize a requesting brand's id (the `brand` param the client sends with
 * every impression, and it becomes utm_source on the click). Only a real config
 * slug survives (`brand.id`'s own pattern), so a caller-supplied value can
 * never write arbitrary text onto an advertiser's destination URL.
 * Returns '' when unusable.
 */
function normalizeBrandId(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const raw = input.trim().toLowerCase();

  return BRAND_ID_PATTERN.test(raw) ? raw : '';
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

  try {
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
  } catch (e) {
    // A transient Firestore error must not 500 the public serve route — fall back
    // to the last-good inventory (stale beats down), or [] (→ 204 no-fill). Leave
    // cache.fetched alone so the next impression retries instead of re-caching failure.
    console.error(`[@omega.js/backend:verts:utils] getInventory failed (${e.message}) — serving ${cache.verts ? 'last-good cache' : 'no-fill'}`);
    return cache.verts || [];
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
 * Render the self-contained vert unit page.
 *
 * The document itself comes from the ONE renderer in @omega.js/client
 * (`modules/vert-document.js`) — the same function the client's terminal
 * promo lane calls, so a served vert and the built-in promo are the same
 * markup, css, and script contract. This function only maps the stored vert
 * shape onto the renderer's options; no template lives here.
 *
 * Node >=22 (the declared engines floor and the pinned Functions runtime)
 * loads the client's ESM module through require() directly.
 */
async function renderVertUnit(options) {
  const { renderVertDocument } = require('@omega.js/client/modules/vert-document.js');
  const vert = options.vert || {};

  return renderVertDocument({
    id: vert.id || '',
    href: options.redirectUrl,
    title: vert.title,
    description: vert.description,
    button: vert.button,
    // The stored footer is the unit's muted label ('Sponsored by X'); the
    // renderer falls back to a plain 'Sponsored' when a vert carries none
    label: vert.footer,
    imageUrl: isHttpUrl(vert.image) ? vert.image : '',
    theme: options.theme,
    width: options.width,
    height: options.height,
    // Origin-checked postMessage: when the parent origin is known (computed by
    // the serve route via normalizeOrigin — port-preserving), messages only
    // ever go to that origin.
    targetOrigin: options.parentOrigin || '*',
  });
}

/**
 * Build a vert's click destination: its stored link tagged with the vert UTM
 * set. The tagging itself lives in the ONE helper both lanes share
 * (@omega.js/client's `modules/vert-document.js` — the client's promo lane
 * tags its own link with the same function), so existing params on an
 * advertiser's URL win here exactly as they do there.
 *
 * Node >=22 (the declared engines floor and the pinned Functions runtime)
 * loads the client's ESM module through require() directly.
 *
 * utm_source is the HOST brand's own id (the `brand` param the client sends
 * with the impression and the serve route stamps on this redirect URL), with
 * the parent host as the fallback when no id came along.
 *
 * @param {object} vert - the stored vert ({ id, link })
 * @param {string} [parentHost] - the referring host (utm_source fallback)
 * @param {string} [brandId] - the host brand's id (utm_source)
 * @returns {string} the tagged destination URL
 */
function buildClickDestination(vert, parentHost, brandId) {
  const { applyVertUtm, UTM_MEDIUM } = require('@omega.js/client/modules/vert-document.js');

  return applyVertUtm(vert.link, {
    source: brandId || parentHost,
    medium: UTM_MEDIUM,
    campaign: vert.id,
  });
}

module.exports = {
  CACHE_TTL,
  normalizeHost,
  normalizeOrigin,
  normalizeBrandId,
  isHttpUrl,
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
  buildClickDestination,
};
