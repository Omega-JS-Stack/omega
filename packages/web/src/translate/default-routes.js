/**
 * The routes the framework never translates (#605) — DERIVED from the packaged
 * defaults tree rather than typed out. Every default page declares the layout
 * that renders it, and a layout says which side of the line the page is on:
 * the auth flows, the user app, the account/payment/portal screens, the legal
 * boilerplate, and the redirect stubs are plumbing, and no brand should have to
 * name any of them in `translation.exclude` — that key is for the brand's OWN
 * pages. Deriving means a default page that moves, arrives, or is renamed can
 * never drift out of the list.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const yaml = require('js-yaml');
const { PATHS } = require('../paths.js');

// The legal boilerplate's family, named because TWO derivations read it: the
// never-translated set below, and legalRoutes() — the generator harvests those
// routes from nowhere, so the framework packages no copy for them.
const LEGAL_LAYOUT = 'blueprint/legal';

// Layouts whose pages carry no marketing copy — matched exactly or as a family
// prefix (`blueprint/auth` covers `blueprint/auth/signin`).
const NEVER_TRANSLATED_LAYOUTS = [
  'modules/utilities/redirect', // a redirect stub renders no prose at all
  'blueprint/404',
  'blueprint/app', // the user app shell
  'blueprint/account',
  'blueprint/auth',
  'blueprint/connections', // the provider redirect lands here — a spinner, not copy
  LEGAL_LAYOUT, // terms/privacy/cookies — legally binding in ONE language
  'blueprint/payment',
  'blueprint/portal',
];

// Derivation is per defaults tree and the tree ships with the package, so the
// scan happens once per process.
const derived = new Map();

/**
 * Read a default page's frontmatter (the two keys this derivation needs).
 * @param {string} file - absolute path to a default page
 * @returns {object} the parsed frontmatter ({} when there is none)
 */
function readFrontmatter(file) {
  const match = (jetpack.read(file) || '').match(/^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {};
  }

  try {
    return yaml.load(match[1]) || {};
  } catch {
    // Unparseable frontmatter is the engine's error to raise, not ours.
    return {};
  }
}

/**
 * The route a permalink lands on, in the shape routeOf() produces from a built
 * file ('/signin' → 'signin', '/404.html' → '404').
 * @param {*} permalink - the frontmatter value
 * @returns {string|null} null when the permalink is templated, non-HTML, or absent
 */
function routeFromPermalink(permalink) {
  if (typeof permalink !== 'string' || /[{}]/.test(permalink)) {
    return null;
  }

  const withoutExt = permalink.trim().replace(/\.html$/i, '');

  // A meta file (robots.txt, feeds/posts.xml) is not a page.
  if (/\.[a-z0-9]+$/i.test(withoutExt)) {
    return null;
  }

  return withoutExt.replace(/^\/+|\/+$/g, '');
}

/**
 * Whether a layout belongs to a family — exactly, or as its prefix.
 * @param {*} layout - the frontmatter value
 * @param {string} family - a layout family
 * @returns {boolean}
 */
function inFamily(layout, family) {
  return typeof layout === 'string' && (layout === family || layout.startsWith(`${family}/`));
}

/**
 * Whether a layout renders framework plumbing rather than brand copy.
 * @param {*} layout - the frontmatter value
 * @returns {boolean}
 */
function isPlumbing(layout) {
  return NEVER_TRANSLATED_LAYOUTS.some((family) => inFamily(layout, family));
}

/**
 * Scan a defaults tree once — every never-translated route, and the legal
 * subset of them.
 * @param {string} [defaultsDir] - the packaged defaults dir (tests override it)
 * @returns {{ excluded: Set<string>, legal: Set<string> }} routes, in routeOf()
 *   shape (no leading slash)
 */
function scanDefaults(defaultsDir) {
  const dir = path.resolve(defaultsDir || PATHS.defaults);

  if (!derived.has(dir)) {
    const excluded = new Set();
    const legal = new Set();

    for (const file of jetpack.find(path.join(dir, 'pages'), { matching: ['*.md', '*.html'] })) {
      const { layout, permalink } = readFrontmatter(file);
      const route = isPlumbing(layout) ? routeFromPermalink(permalink) : null;

      // The home route ('') would swallow the whole site as a folder prefix —
      // it is also never a plumbing page, so reaching it means a broken tree.
      if (route) {
        excluded.add(route);

        if (inFamily(layout, LEGAL_LAYOUT)) {
          legal.add(route);
        }
      }
    }

    derived.set(dir, { excluded, legal });
  }

  return derived.get(dir);
}

/**
 * The framework's never-translated routes, read off the defaults tree.
 * @param {string} [defaultsDir] - the packaged defaults dir (tests override it)
 * @returns {Set<string>} routes, in routeOf() shape (no leading slash)
 */
function defaultExcludedRoutes(defaultsDir) {
  return scanDefaults(defaultsDir).excluded;
}

/**
 * The framework's legal routes — the never-translated pages the generator also
 * harvests nothing for, so no packaged copy of them exists (#621).
 * @param {string} [defaultsDir] - the packaged defaults dir (tests override it)
 * @returns {Set<string>} routes, in routeOf() shape (no leading slash)
 */
function legalRoutes(defaultsDir) {
  return scanDefaults(defaultsDir).legal;
}

module.exports = { defaultExcludedRoutes, legalRoutes };
