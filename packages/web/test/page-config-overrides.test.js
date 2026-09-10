/**
 * The three namespaces (#607): a page overrides omega.json5 under a `config:`
 * parent, `meta` is page machinery that never appears in the config file, and
 * the `site` global keeps build facts only.
 *
 * Before this, a page restating a config section bare merged into the same
 * flat `resolved` tree the config seeded — `theme:` in frontmatter silently
 * overrode `theme` in omega.json5, and nothing else did, so the two namespaces
 * drifted with no signal either way.
 *
 * The membership rule runs BOTH ways (Ian's 2026-08-26 addendum): in the
 * config file means under `config:`, and not in the config file means not
 * allowed under `config:`. A typo there — `config: { them: … }` — would
 * otherwise merge a key nothing reads and change nothing, silently.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { configureOmega } = require('../src/index.js');
const { SITE_FACT_KEYS } = require('../src/config-sections.js');
const { buildSite, BARE } = require('./lib/build.js');

const bareData = JSON.parse(fs.readFileSync(path.join(BARE, 'site-data.json'), 'utf8'));

// A brand that runs the chat widget — the page-level override under test
// switches it off for ONE page.
const chatOn = {
  ...bareData,
  inbound: { chat: { providers: { chatsy: { enabled: true, agentId: 'agent-607' } } } },
};

/**
 * A one-page consumer whose index.md carries the given frontmatter lines.
 * @param {string[]} frontmatter
 * @returns {{ tmp: string, consumerDir: string }}
 */
function makeConsumer(frontmatter) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pageconfig-'));
  const consumerDir = path.join(tmp, 'src');
  fs.mkdirSync(path.join(consumerDir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '---',
    'layout: blueprint/index',
    'permalink: /',
    ...frontmatter,
    '---',
    '',
  ].join('\n'));
  return { tmp, consumerDir };
}

test('a page `config:` block overrides the brand config for that page only', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'config:',
    '  inbound:',
    '    chat:',
    '      providers:',
    '        chatsy:',
    '          enabled: false',
  ]);
  try {
    const pages = await buildSite(consumerDir, chatOn, { environment: 'development' }, 'page-config-chat-off');
    const html = pages.get('/');
    assert.ok(html, 'page built');
    assert.ok(!html.includes('href="https://chatsy.ai"'), 'the page config switched the chat preconnect off');
    assert.match(html, /chatsy:\s*\{\s*enabled:\s*false/, 'the Configuration blob carries the page value');
    assert.match(html, /agentId:\s*"agent-607"/, 'the rest of the brand chat block still merges underneath');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('with no page `config:`, the brand config stands', async () => {
  const { tmp, consumerDir } = makeConsumer([]);
  try {
    const pages = await buildSite(consumerDir, chatOn, { environment: 'development' }, 'page-config-chat-on');
    const html = pages.get('/');
    assert.ok(html.includes('href="https://chatsy.ai"'), 'the brand chat block still renders the preconnect');
    assert.match(html, /chatsy:\s*\{\s*enabled:\s*true/, 'the Configuration blob carries the brand value');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('restating a config section BARE in a page is a build error naming the file and the key', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'theme:',
    '  main:',
    '    class: "smuggled"',
  ]);
  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-bare-fail'),
      (error) => {
        // Eleventy wraps a preprocessor throw — the engine's message is down
        // the originalError/cause chain.
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /index\.md/, 'the error names the file');
        assert.match(message, /`theme`/, 'the error names the key');
        assert.match(message, /config:/, 'the error names the lane that replaced it');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a key under `config:` that is not a config section is a build error naming the file and the key', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'config:',
    '  headline: "not a section"',
  ]);
  try {
    await assert.rejects(
      () => buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-strict-fail'),
      (error) => {
        const parts = [];
        for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
        const message = parts.join(' | ');
        assert.match(message, /index\.md/, 'the error names the file');
        assert.match(message, /`headline`/, 'the error names the key');
        assert.match(message, /omega\.json5/, 'the error names what `config:` holds');
        return true;
      },
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// A `config:` that is not a MAP of sections is the loudest version of the same
// mistake: `deepMerge` lets a null/array/scalar REPLACE the seeded config, so
// resolved.config for that page stops being the brand config entirely and
// every read under it renders empty. Each spelling fails naming the shape.
for (const { label, lines, shape } of [
  { label: 'an empty key', lines: ['config:'], shape: /empty|null/i },
  { label: 'a list', lines: ['config:', '  - theme'], shape: /array/ },
  { label: 'a scalar', lines: ['config: "theme"'], shape: /string/ },
]) {
  test(`\`config:\` as ${label} is a build error naming the file and the shape`, async () => {
    const { tmp, consumerDir } = makeConsumer(lines);
    try {
      await assert.rejects(
        () => buildSite(consumerDir, bareData, { environment: 'development' }, `page-config-shape-${label.replace(/\s+/g, '-')}`),
        (error) => {
          const parts = [];
          for (let node = error; node; node = node.originalError || node.cause) parts.push(node.message);
          const message = parts.join(' | ');
          assert.match(message, /index\.md/, 'the error names the file');
          assert.match(message, /`config:`/, 'the error names the block');
          assert.match(message, shape, 'the error names the shape it received');
          return true;
        },
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('a brand section with no schema rule is still config — `config:` takes it', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'config:',
    '  brandOwn:',
    '    label: "page value"',
  ]);
  const withOwnSection = { ...bareData, brandOwn: { label: 'brand value', kept: 'yes' } };
  try {
    const pages = await buildSite(consumerDir, withOwnSection, { environment: 'development' }, 'page-config-brand-own');
    assert.ok(pages.get('/'), 'the page built — a key the brand config carries is a section');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('`meta` is PAGE machinery — omega.json5 has no meta section, so the head falls back to the brand', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'meta:',
    '  title: "Page title wins"',
  ]);
  // A leftover config `meta` block (the validator now refuses one) reaches
  // NOTHING: the engine seeds the walk from frontmatter alone.
  const leftover = { ...bareData, meta: { title: 'Config meta title', description: 'Config meta description' } };
  try {
    const pages = await buildSite(consumerDir, leftover, { environment: 'development' }, 'page-config-meta-bare');
    const html = pages.get('/');
    assert.ok(html.includes('<title>Page title wins</title>'), 'the page meta.title is the title');
    assert.ok(!html.includes('Config meta description'), 'no config meta section feeds the walk');
    assert.ok(html.includes(`content="${bareData.brand.description}"`), 'the description falls back to brand.description');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('with no page meta at all, the head is the brand — brand.name and brand.description', async () => {
  const { tmp, consumerDir } = makeConsumer([]);
  try {
    const pages = await buildSite(consumerDir, bareData, { environment: 'development' }, 'page-config-meta-site');
    const html = pages.get('/');
    assert.ok(html.includes(`<title>${bareData.brand.name}</title>`), 'brand.name is the site-wide title default');
    assert.ok(html.includes(`content="${bareData.brand.description}"`), 'brand.description is the site-wide description default');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('`resolved.config` is the WHOLE merged config, with the page block on top', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'config:',
    '  brandOwn:',
    '    label: "page value"',
  ]);
  fs.appendFileSync(path.join(consumerDir, 'pages', 'index.md'), [
    '<p id="own">{{ resolved.config.brandOwn.label }}</p>',
    '<p id="kept">{{ resolved.config.brandOwn.kept }}</p>',
    '<p id="deep">{{ resolved.config.theme.id }}</p>',
    '<p id="brand">{{ resolved.config.brand.name }}</p>',
    '',
  ].join('\n'));
  const withOwnSection = { ...bareData, brandOwn: { label: 'brand value', kept: 'yes' } };
  try {
    const pages = await buildSite(consumerDir, withOwnSection, { environment: 'development' }, 'page-config-whole');
    const html = pages.get('/');
    assert.match(html, /id="own">page value</, 'the page block wins its own key');
    assert.match(html, /id="kept">yes</, 'every sibling key of the overridden section is still there');
    assert.match(html, /id="deep">classy</, 'a section the page never named rides along');
    assert.match(html, new RegExp(`id="brand">${bareData.brand.name}<`), 'the whole config is under it, not a filtered subset');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the `site` global carries BUILD FACTS only — every config section moved to resolved.config', () => {
  const globals = {};
  const noop = () => {};
  const stub = {
    setLiquidOptions: noop,
    setIncludesDirectory: noop,
    amendLibrary: noop,
    addGlobalData: (name, value) => { globals[name] = value; },
    addPreprocessor: noop,
    addFilter: noop,
    addUrlTransform: noop,
    addTransform: noop,
    addTemplate: noop,
    addCollection: noop,
    addWatchTarget: noop,
    addPlugin: (plugin, ...args) => plugin(stub, ...args),
    on: noop,
    ignores: new Set(),
  };
  configureOmega(stub, {
    consumerDir: BARE,
    siteData: { ...bareData, analytics: { providers: { google: { id: 'G-1' } } }, payment: { products: [] } },
    environment: 'development',
    assetManifest: { js: { pages: {} }, css: { pages: {}, layouts: {} } },
  });

  const strays = Object.keys(globals.site).filter((key) => !SITE_FACT_KEYS.includes(key));
  assert.deepEqual(strays, [], `site.${strays.join(', site.')} is config, not a build fact — it belongs in resolved.config `
    + '(a collection this brand declares is a legitimate site key too, #593 — the bare fixture declares none)');
});
