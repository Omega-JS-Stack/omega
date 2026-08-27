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

// Layouts whose pages carry no marketing copy — matched exactly or as a family
// prefix (`blueprint/auth` covers `blueprint/auth/signin`).
const NEVER_TRANSLATED_LAYOUTS = [
  'modules/utilities/redirect', // a redirect stub renders no prose at all
  'blueprint/404',
  'blueprint/app', // the user app shell
  'blueprint/account',
  'blueprint/auth',
  'blueprint/legal', // terms/privacy/cookies — legally binding in ONE language
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
 * Whether a layout renders framework plumbing rather than brand copy.
 * @param {*} layout - the frontmatter value
 * @returns {boolean}
 */
function isPlumbing(layout) {
  return typeof layout === 'string'
    && NEVER_TRANSLATED_LAYOUTS.some((family) => layout === family || layout.startsWith(`${family}/`));
}

/**
 * The framework's never-translated routes, read off the defaults tree.
 * @param {string} [defaultsDir] - the packaged defaults dir (tests override it)
 * @returns {Set<string>} routes, in routeOf() shape (no leading slash)
 */
function defaultExcludedRoutes(defaultsDir) {
  const dir = path.resolve(defaultsDir || PATHS.defaults);

  if (!derived.has(dir)) {
    const routes = new Set();

    for (const file of jetpack.find(path.join(dir, 'pages'), { matching: ['*.md', '*.html'] })) {
      const { layout, permalink } = readFrontmatter(file);
      const route = isPlumbing(layout) ? routeFromPermalink(permalink) : null;

      // The home route ('') would swallow the whole site as a folder prefix —
      // it is also never a plumbing page, so reaching it means a broken tree.
      if (route) {
        routes.add(route);
      }
    }

    derived.set(dir, routes);
  }

  return derived.get(dir);
}

module.exports = { defaultExcludedRoutes };
