/**
 * The account page's CONNECTION CARDS — who decides which providers a user can
 * link, and where a card's name and logo come from
 * ([#771](https://github.com/Omega-JS-Stack/omega/issues/771),
 * [#792](https://github.com/Omega-JS-Stack/omega/issues/792),
 * [#793](https://github.com/Omega-JS-Stack/omega/issues/793)).
 *
 * The list used to be closed twice over and the CARD had two homes: the layout
 * drew one per `connections:` frontmatter row (twelve of them, hardcoded CDN
 * URLs — the Twitch and Kick ones 404), and a row WON over the brand's own
 * config entry, so a brand could not correct one. The rows are gone: the CONFIG
 * is the only list, the framework's config DEFAULTS carry each packaged
 * provider's name, logo and description, and a brand's values win through the
 * ordinary merge chain.
 *
 * What is pinned here:
 *  - the packaged defaults exist, name a mark that SHIPS in this package, and a
 *    brand that declares nothing else still gets a drawn card;
 *  - a brand's own `logo` wins over the packaged one, and a full URL still
 *    renders as an `<img>` while a mark NAME renders inline;
 *  - no `connections:` frontmatter row survives anywhere in the theme;
 *  - an enabled provider with no name+logo still gets the unsupported card, and
 *    `connections.js` drives from `Object.keys(connectionsConfig)` alone.
 *
 * Two harnesses, because the feature has two halves: the REAL Liquid include
 * over the REAL base theme for the markup, and the REAL section module through
 * esbuild over a hand-rolled document for the behavior (node has no DOM and web
 * pulls in no jsdom) — the convention account-orders.test.js set. The document's
 * card ids come from the rendered Liquid, so the two halves meet where the page
 * makes them meet.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const yaml = require('js-yaml');
const { Liquid } = require('liquidjs');
const { registerLiquid } = require('@omega.js/template-kit/register-liquid');
const { schemaDefaults } = require('@omega.js/config');

const CORE_DIR = path.join(__dirname, '..', 'core');
const LOGOS_DIR = path.join(CORE_DIR, 'logos');
const MARKS_DIR = path.join(LOGOS_DIR, 'brandmarks', 'original');
const THEMES_DIR = path.join(__dirname, '..', 'themes');
const BASE_THEME = path.join(THEMES_DIR, 'base');
const CONNECTIONS_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections', 'connections.js');
const CONNECTIONS_SOURCE = fs.readFileSync(CONNECTIONS_ENTRY, 'utf8');
const ACCOUNT_LAYOUT = fs.readFileSync(path.join(BASE_THEME, '_layouts', 'frontend', 'pages', 'account', 'index.html'), 'utf8');

// The framework's own card table — the LOWEST layer of the merge chain, so a
// brand that writes `google: { enabled: true }` resolves to all of this
const PACKAGED = schemaDefaults().connections;

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-connections-cards-'));
const BUNDLE = path.join(BUNDLE_DIR, 'connections.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [CONNECTIONS_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager { on() {} }' };
        });
      },
    }],
  });

  return building;
}

// A brand's RESOLVED config: two packaged providers it enabled (nothing else
// declared, so the defaults are what draw them), one of its own with card
// fields, and one with nothing to draw
const CONNECTIONS_CONFIG = {
  google: { ...PACKAGED.google, enabled: true },
  twitch: { ...PACKAGED.twitch, enabled: true },
  'house-sso': { enabled: true, name: 'House SSO', logo: 'https://cdn.test/house.svg' },
  'no-card': { enabled: true },
};

// A provider name is `[a-z0-9-]` — the backend's confined loader refuses
// anything else, so a key like this can never resolve to a provider at all
const CONNECTIONS_CONFIG_BAD_KEY = {
  HouseSSO: { enabled: true, name: 'House SSO', logo: 'https://cdn.test/house.svg' },
};

/** The REAL include over the REAL base theme, with the brand's config bridged in. */
function renderConnections(connectionsConfig) {
  const engine = new Liquid({ root: [path.join(BASE_THEME, '_includes')], jekyllInclude: true });

  registerLiquid(engine, {
    site: {},
    getCollection: () => [],
    getCollectionNames: () => [],
    fileExists: () => false,
    markdown: (content) => content,
    icons: { fontAwesomeDirs: [], aliasFile: null, flagsDir: null, style: 'solid' },
    // The same directory the build hands the tag (src/engine.js), so a mark NAME
    // renders the SVG this package ships
    logos: { dir: LOGOS_DIR },
  });

  return engine.parseAndRender('{% include frontend/sections/account-connections.html %}', {
    resolved: { config: { connections: connectionsConfig } },
  });
}

/** Every `connection-<id>` CARD the markup carries, in order (never its form). */
function cardIds(html) {
  return [...html.matchAll(/id="connection-([A-Za-z0-9_-]+)"/g)]
    .map((match) => match[1])
    .filter((id) => !id.startsWith('form-'));
}

/** The first path data in a shipped mark — enough to tell one mark from another. */
function markSignature(name) {
  const svg = fs.readFileSync(path.join(MARKS_DIR, `${name}.svg`), 'utf8');

  return svg.match(/ d="([^"]{40,})"/)[1].slice(0, 40);
}

/** A document that answers exactly the ids the rendered markup carries. */
function documentFor(html) {
  const appended = [];

  const makeElement = (id) => ({
    id: id,
    classes: new Set(['d-none']),
    classList: {
      add: (name) => elements[id].classes.add(name),
      remove: (name) => elements[id].classes.delete(name),
    },
    innerHTML: '',
    textContent: '',
    querySelector: () => null,
    appendChild: (child) => appended.push(child),
  });

  const elements = {};

  for (const id of ['connections-loading', 'connections-empty', 'connections-list']) {
    elements[id] = makeElement(id);
  }

  for (const id of cardIds(html)) {
    elements[`connection-${id}`] = makeElement(`connection-${id}`);
    elements[`${id}-connection-status`] = makeElement(`${id}-connection-status`);
    elements[`${id}-connection-description`] = makeElement(`${id}-connection-description`);
  }

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ id: '', className: '', innerHTML: '' }),
  };
  globalThis.window = { location: { search: '', href: 'https://x.test/account' }, addEventListener() {} };
  globalThis.__omegaClient = {
    getApiUrl: () => 'https://api.x.test',
    utilities: () => ({ escapeHTML: (value) => `${value}` }),
    request: async () => ({}),
  };

  return { elements, appended };
}

/** Render the markup, run the REAL section over it, hand back what it did. */
async function runSection({ connectionsConfig = CONNECTIONS_CONFIG, account = {} } = {}) {
  await bundleOnce();

  const html = await renderConnections(connectionsConfig);
  const dom = documentFor(html);

  delete require.cache[require.resolve(BUNDLE)];
  const connectionsSection = require(BUNDLE);

  await connectionsSection.init();
  await connectionsSection.loadData(account, connectionsConfig);

  return { html, ...dom };
}

/** Every `.html` under the theme tree, so a case can read what ships. */
function themeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return themeFiles(full);
    }

    return entry.name.endsWith('.html') ? [full] : [];
  });
}

test('#793: the framework ships a card for every packaged provider, in the config defaults', () => {
  const expected = ['google', 'discord', 'spotify', 'twitch', 'kick'];

  assert.deepEqual(Object.keys(PACKAGED).sort(), [...expected].sort(), 'the five providers @omega.js/backend ships a module for');

  for (const provider of expected) {
    const entry = PACKAGED[provider];

    assert.ok(entry.name, `${provider} has the name its card says`);
    assert.ok(entry.description, `${provider} has the line under it`);
    assert.ok(!entry.logo.includes('/') && !entry.logo.includes(':'), `${provider}'s logo is a mark NAME, never a CDN url: ${entry.logo}`);
    assert.ok(fs.existsSync(path.join(MARKS_DIR, `${entry.logo}.svg`)), `and the mark SHIPS in this package: ${entry.logo}.svg`);
  }
});

test('#792: a brand that only ENABLES a packaged provider gets a drawn card', async () => {
  const html = await renderConnections({ google: { ...PACKAGED.google, enabled: true } });

  assert.deepEqual(cardIds(html), ['google'], 'the config is the whole list');
  assert.ok(html.includes('>Google<'), "the name comes from the framework's defaults");
  assert.ok(html.includes('<svg'), 'and the logo is the packaged mark, inlined by omega_logo');
  assert.ok(!html.includes('<img'), 'never an <img> for a mark name');
  assert.ok(!html.includes('cdn.itwcreativeworks.com'), 'and nothing points at the CDN files that 404');
  assert.ok(html.includes(markSignature('google')), "the mark drawn is the one the logo names");
});

test("#792: a brand's own logo wins over the packaged one, and a URL still renders an img", async () => {
  const overridden = await renderConnections({ google: { ...PACKAGED.google, enabled: true, logo: 'github' } });

  assert.ok(overridden.includes(markSignature('github')), "the brand's mark is what is drawn");
  assert.ok(!overridden.includes(markSignature('google')), 'and the packaged one is not');

  const url = await renderConnections({ google: { ...PACKAGED.google, enabled: true, logo: 'https://cdn.test/google.svg' } });

  assert.ok(url.includes('<img'), 'a full URL is still an <img>');
  assert.ok(url.includes('https://cdn.test/google.svg'), 'pointing at what the brand named');
});

test('#792: no connections: frontmatter row survives anywhere in the theme', () => {
  const offenders = themeFiles(THEMES_DIR).filter((file) => {
    const source = fs.readFileSync(file, 'utf8');

    if (!source.startsWith('---')) {
      return false;
    }

    const frontmatter = yaml.load(source.split('---')[1]) || {};

    return Object.prototype.hasOwnProperty.call(frontmatter, 'connections');
  });

  assert.deepEqual(offenders, [], `the config is the only card list: ${offenders.join(', ')}`);
  assert.ok(!ACCOUNT_LAYOUT.includes('cdn.itwcreativeworks.com/assets/general/images/brands/color/kick.svg'), 'and the CDN logos that 404 are gone with them');
  assert.ok(ACCOUNT_LAYOUT.includes('{% include frontend/sections/account-connections.html %}'), 'the layout renders the shared connections include');
});

test('#771: an enabled provider with a card is shown; one without gets the unsupported card', async () => {
  const { elements, appended } = await runSection();

  assert.ok(!elements['connection-google'].classes.has('d-none'), 'a packaged provider the brand enabled is shown');
  assert.ok(!elements['connection-house-sso'].classes.has('d-none'), "and a brand's own, with no allowlist to be on");

  assert.equal(appended.length, 1, 'exactly one provider had no card to show');

  const warning = appended[0];

  assert.equal(warning.id, 'connection-no-card-unconfigured', 'the unsupported card names the provider it stands for');
  assert.ok(warning.innerHTML.includes('Unsupported connection'), 'it says the connection is unsupported');
  assert.ok(warning.innerHTML.includes('"name"') && warning.innerHTML.includes('"logo"'), `it says what the config entry is missing: ${warning.innerHTML}`);
  assert.ok(!/Ultimate Jekyll Manager/i.test(warning.innerHTML), 'and never tells anyone to update a framework that does not exist');
});

test('#771: a disabled provider is hidden, and a page with nothing enabled says so', async () => {
  const { elements, appended } = await runSection({
    connectionsConfig: {
      google: { ...PACKAGED.google, enabled: false },
      twitch: { ...PACKAGED.twitch, enabled: false },
    },
  });

  assert.ok(elements['connection-google'].classes.has('d-none'), 'a disabled provider stays hidden');
  assert.ok(elements['connection-twitch'].classes.has('d-none'), 'even when its card exists');
  assert.equal(appended.length, 0, 'and a disabled provider never draws a warning');
  assert.ok(!elements['connections-empty'].classes.has('d-none'), 'the empty message is shown instead');
});

test('#771: a config key that is not a legal provider name never shows a live card', async () => {
  const { elements, appended } = await runSection({ connectionsConfig: CONNECTIONS_CONFIG_BAD_KEY });

  // The card may EXIST (the key carries name + logo), but it is never shown:
  // no authorize call could succeed for a name the backend's loader refuses
  assert.ok(elements['connection-HouseSSO'].classes.has('d-none'), 'the card stays hidden');
  assert.equal(appended.length, 1, 'and the warning card is drawn instead');

  const warning = appended[0];

  assert.ok(/lowercase/i.test(warning.innerHTML), `the warning says what a provider id may be: ${warning.innerHTML}`);
  assert.ok(/dash/i.test(warning.innerHTML), 'naming the allowed characters');
  assert.ok(!/"name"/.test(warning.innerHTML), 'and never blames the fields, which this entry has');
});

test('#793: the section drives from the config alone — no allowlist, no second description list', async () => {
  assert.ok(!/supportedProviders/.test(CONNECTIONS_SOURCE), 'the hardcoded provider allowlist is gone');
  assert.ok(!/defaultDescriptions/.test(CONNECTIONS_SOURCE), 'and the descriptions map naming providers this lane cannot connect');
  assert.ok(/Object\.keys\(availableProviders\)/.test(CONNECTIONS_SOURCE), 'the config keys are the list');
  assert.ok(!/Ultimate Jekyll Manager/i.test(CONNECTIONS_SOURCE), 'and the dead advice with it');

  // The description a card shows comes from the config entry, which is where
  // the framework's own default for a packaged provider lives now
  const { elements } = await runSection();

  assert.equal(
    elements['google-connection-description'].textContent,
    PACKAGED.google.description,
    "the packaged description is what the card says when the brand wrote none",
  );
});
