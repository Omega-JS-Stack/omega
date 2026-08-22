/**
 * Every internal link the DEFAULT pages emit lands on a page the same build
 * wrote ([#427](https://github.com/Omega-JS-Stack/omega/issues/427)).
 *
 * kirue's dist-side resolver found ten framework-owned links that 404 in a
 * standard brand build — the page, the link and the missing route all belong
 * to `@omega.js/web`, so no consumer could fix them. Nothing on this side read
 * a link and asked whether the thing on the other end exists, so the breaks
 * shipped green. This is that question, asked in the framework: build the
 * defaults over the bare fixture (its only page of its own is `/`, so every
 * other URL here IS a framework default) and resolve every href/src the built
 * pages carry.
 *
 * The URL contract is omega's flat, extensionless one: `/foo` is served by
 * `foo.html` or `foo/index.html`, so the emitted URL set is the resolution
 * table, and a relative value resolves against its emitting page's directory.
 *
 * SCOPE: assets are out of reach here and skipped on purpose — the fixture
 * build injects a synthetic manifest (`/assets/js/main-TEST.js`) and writes no
 * asset tree, so an asset href proves nothing about the real build. A dist
 * walk is where asset paths get checked; this is the pages half.
 *
 * The resolver itself is `src/link-resolver.js`, the ONE home it shares with
 * the native `omega test` check ([#430](https://github.com/Omega-JS-Stack/omega/issues/430)).
 * This file supplies the half that is its own: the emitted URL set as the
 * resolution table, with assets excused.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { buildSite, BARE } = require('./lib/build.js');
const { scanLinks, applyExceptions, normalize, HTML_OUTPUT } = require('../src/link-resolver.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

let building = null;

/** The bare fixture's default pages, scanned once. */
function scanDefaults() {
  building ||= buildSite(BARE, bareData, {}, 'default-page-links').then((pages) => {
    const urls = new Set([...pages.keys()].map(normalize));

    const unresolved = scanLinks(
      [...pages].filter(([pageUrl]) => HTML_OUTPUT.test(pageUrl)),
      // The emitted URL set IS the resolution table here; assets are excused
      // because no asset tree exists to check them against (see SCOPE above).
      { resolves: (url) => url.startsWith('/assets/') || urls.has(url) },
    );

    return { pages, unresolved };
  });

  return building;
}

test('#427: the default pages emit no link to a route the build never wrote', async () => {
  const { pages, unresolved } = await scanDefaults();

  // The defaults really did build — an empty build would pass vacuously.
  assert.ok(pages.has('/dashboard/account'), 'the account default is in the build');
  assert.ok(pages.has('/admin'), 'the admin default is in the build');
  assert.ok(pages.has('/test/translation'), 'the translation test default is in the build');

  // ZERO exceptions is the framework's acceptance state (#430): a brand
  // inherits these pages, so a gap here would be one every brand must declare.
  const { offenders } = applyExceptions(unresolved, {});

  assert.deepStrictEqual(offenders, [], 'these links 404 in every brand build — fix the href or drop the link');
});
