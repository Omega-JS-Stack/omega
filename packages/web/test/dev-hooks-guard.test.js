/**
 * The hard-to-forget enforcement behind #342: the dev palette is the ONE home
 * for the dev testing experience. A `_dev_*` param or a `window.<helper>` that
 * only a person who already knows the name can reach is the thing this rule
 * exists to stop — hidden functions get forgotten in six months, and the ones
 * this sweep found (`window.showDownloadModal`, `window.triggerExtensionInstall`,
 * `?_dev_prefill`, `?_dev_simulateRedirect`) had all been shipping to
 * production besides.
 *
 * Static by design, exactly like config-reads-guard.test.js: the guard greps
 * the client sources, so it fails the moment a new hook appears, without
 * needing a browser to reach the surface it hides behind. Exceptions are named
 * HERE, not in the source, each with the reason it is not a hidden hook.
 *
 * Three rules, and each one has teeth:
 *   1. Every `_dev_*` param in client code is listed below.
 *   2. Its entry names the palette section file that OFFERS it, and that file
 *      really carries the control — a table entry cannot rubber-stamp a hook.
 *   3. The read sits inside a `@dev-only` block, so production ships neither
 *      the param nor what it unlocks (#226/#235/#245 were all this bug).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const PKG = path.resolve(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');

// The client code a browser runs: web's own modules, the boot runtime every
// generated bundle imports, the theme and section entries a page loads, plus
// the shared runtime every framework embeds. Build output is not source and is
// never scanned.
const SCAN_ROOTS = [
  path.join(PKG, 'core', 'js'),
  path.join(PKG, 'runtime'),
  path.join(PKG, 'themes'),
  path.join(ROOT, 'packages', 'client', 'src'),
];

// Vendored upstream trees sitting inside a scan root: Bootstrap's own source
// and its Sass test harness are third-party code, not ours to rule on.
const SCAN_EXCLUDES = [
  path.join(PKG, 'themes', 'bootstrap', 'js'),
  path.join(PKG, 'themes', 'bootstrap', 'scss'),
];

// Every `_dev_*` hook that may exist, and the palette control that offers it.
// `offeredBy` is the file whose section hands the control to the palette — the
// guard reads it, so adding a key here without wiring the control fails too.
// `exception` is the other kind of entry: a param that is NOT a dev affordance,
// with the reason.
const DEV_HOOKS = {
  // The checkout's controls, all six on one registered section (#234).
  _dev_preDelay: { offeredBy: 'core/js/pages/payment/checkout/modules/dev-section.js' },
  _dev_trialEligible: { offeredBy: 'core/js/pages/payment/checkout/modules/dev-section.js' },
  _dev_cardProcessor: { offeredBy: 'core/js/pages/payment/checkout/modules/dev-section.js' },
  _dev_recaptcha: { offeredBy: 'core/js/pages/payment/checkout/modules/dev-section.js' },
  _dev_decline: { offeredBy: 'core/js/pages/payment/checkout/modules/dev-section.js' },
  // The auth pages' returning-redirect rehearsal.
  _dev_simulateRedirect: { offeredBy: 'core/js/libs/auth/index.js' },
  // NOT a test hook: the per-request API-base escape (`?_dev_apiEnvironment=
  // production` against a local site), documented in docs/web/index.md, and it
  // belongs to no page — @omega.js/client resolves it for every framework.
  _dev_apiEnvironment: { exception: 'environment escape hatch, documented in docs/web/index.md' },
};

// A `window.<name> =` assignment that is NOT a dev helper. Everything else is
// the pattern this guard rejects: a capability you can only reach by knowing
// its name.
const ALLOWED_GLOBALS = {
  Sentry: 'the vendor SDK\'s own documented global (client/src/modules/sentry.js)',
  bootstrap: 'the vendor UMD bundle\'s own documented global, published by every theme entry and read in production (core/js/core/exit-popup.js)',
  adsbygoogle: 'AdSense\'s own queue, pushed the way Google documents it',
  // The consent-gated loader installs each provider's own documented globals
  // (#383) — the queues the vendor snippets used to create inline in foot.html,
  // moved into JS so consent decides whether they exist at all.
  gtag: 'Google\'s own documented command queue (core/js/core/analytics-loader.js)',
  fbq: 'the Meta pixel snippet\'s own global, verbatim from the vendor bootstrap',
  dataLayer: 'Google\'s own documented queue (core/js/core/analytics-loader.js)',
  _fbq: 'the Meta pixel snippet\'s own global, verbatim from the vendor bootstrap',
  ttq: 'the TikTok pixel\'s own documented global',
  TiktokAnalyticsObject: 'the TikTok pixel snippet\'s own name marker, verbatim from the vendor bootstrap',
  onbeforeunload: 'a standard window handler, not a helper',
  __OMEGA_SIGNOUT_IN_PROGRESS: 'auth flow coordination across modules, production behaviour',
  __OMEGA_REVERSING_SIGNUP: 'auth flow coordination across modules, production behaviour',
  __OMEGA_CUSTOM_TOKEN_SIGNIN: 'auth flow coordination across modules, production behaviour',
  // Kept deliberately (#342): the e2e flows lane reads `window._checkout.state`
  // to assert the checkout bound the URL's product (scripts/e2e-flows.js). It
  // is a machine seam behind omega.isDevelopment(), not a console helper.
  _checkout: 'the e2e flows lane\'s read seam, dev-gated (scripts/e2e-flows.js)',
};

// Modules that are themselves dev-only — nothing outside a `@dev-only` block
// imports them, so their contents need no block of their own.
const DEV_ONLY_MODULES = [
  'core/js/pages/payment/checkout/modules/dev-section.js',
];

const START = '@dev-only:start';
const END = '@dev-only:end';

/** Every .js file under the scan roots, relative to the repo root. */
function sources() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SCAN_EXCLUDES.includes(full)) continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) {
        found.push(full);
      }
    }
  };
  SCAN_ROOTS.forEach(walk);
  return found;
}

/**
 * The file with its comments blanked, line structure intact. A hook NAMED in a
 * comment (the account page still explains where `?_dev_subscription` went) is
 * prose, not a hook — only what runs counts.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (match, before) => before + ' '.repeat(match.length - before.length));
}

/** The 0-based line numbers that sit inside a `@dev-only` block. */
function devOnlyLines(source) {
  const inside = new Set();
  let depth = 0;
  source.split('\n').forEach((line, index) => {
    if (line.includes(START)) depth += 1;
    if (depth > 0) inside.add(index);
    if (line.includes(END)) depth -= 1;
  });
  return inside;
}

/** Every scanned file, read once: raw text, comment-free text, block lines. */
function scan() {
  return sources().map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    return {
      rel: path.relative(PKG, file),
      code: codeOnly(raw),
      devOnly: devOnlyLines(raw),
    };
  });
}

test('#342: every `_dev_*` hook in client code is one the palette offers', () => {
  const unknown = [];

  for (const file of scan()) {
    file.code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/_dev_[A-Za-z0-9_]+/g)) {
        if (!DEV_HOOKS[match[0]]) {
          unknown.push(`${file.rel}:${index + 1} — ${match[0]}`);
        }
      }
    });
  }

  assert.deepStrictEqual(
    unknown,
    [],
    'a new `_dev_*` hook must be a palette control, and listed in DEV_HOOKS with the section that offers it',
  );
});

test('#342: each listed hook really is wired to a palette section, and is really still read', () => {
  const files = scan();
  const byRel = new Map(files.map((file) => [file.rel, file]));
  const used = new Set();

  files.forEach((file) => {
    for (const match of file.code.matchAll(/_dev_[A-Za-z0-9_]+/g)) {
      used.add(match[0]);
    }
  });

  for (const [param, entry] of Object.entries(DEV_HOOKS)) {
    assert.ok(used.has(param), `DEV_HOOKS lists "${param}", but no client code reads it any more — drop the entry`);

    if (entry.exception) {
      continue;
    }

    const section = byRel.get(entry.offeredBy);
    assert.ok(section, `DEV_HOOKS points "${param}" at ${entry.offeredBy}, which does not exist`);
    assert.ok(
      section.code.includes(`'${param}'`),
      `${entry.offeredBy} should carry the palette control for "${param}" — the table may not stand in for the wiring`,
    );
  }
});

test('#342: every hook read sits inside a `@dev-only` block, so production ships none of it', () => {
  const leaked = [];

  for (const file of scan()) {
    if (DEV_ONLY_MODULES.includes(file.rel)) {
      continue;
    }

    file.code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/_dev_[A-Za-z0-9_]+/g)) {
        if (DEV_HOOKS[match[0]]?.exception || file.devOnly.has(index)) {
          continue;
        }
        leaked.push(`${file.rel}:${index + 1} — ${match[0]}`);
      }
    });
  }

  assert.deepStrictEqual(
    leaked,
    [],
    'a dev hook read outside a `@dev-only` block survives the strip and ships to production',
  );
});

test('#342: no debug helper is hung on window — the palette is the way in', () => {
  const helpers = [];

  for (const file of scan()) {
    file.code.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
        if (!ALLOWED_GLOBALS[match[1]]) {
          helpers.push(`${file.rel}:${index + 1} — window.${match[1]}`);
        }
      }
    });
  }

  assert.deepStrictEqual(
    helpers,
    [],
    'hand the capability to the palette with registerDevSection instead of hanging it on window',
  );
});
