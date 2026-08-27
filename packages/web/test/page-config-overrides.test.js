/**
 * The three namespaces (#607): a page overrides omega.json5 under a `config:`
 * parent, `meta` is the ONE section it may still restate bare, and the `site`
 * global keeps build facts only.
 *
 * Before this, a page restating a config section bare merged into the same
 * flat `resolved` tree the config seeded — `theme:` in frontmatter silently
 * overrode `theme` in omega.json5, and nothing else did, so the two namespaces
 * drifted with no signal either way.
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

test('`meta` is the one bare exception — a page `meta:` merges over the config meta section', async () => {
  const { tmp, consumerDir } = makeConsumer([
    'meta:',
    '  title: "Page title wins"',
  ]);
  const siteMeta = {
    ...bareData,
    meta: { title: 'Site default title', description: 'Site default description' },
  };
  try {
    const pages = await buildSite(consumerDir, siteMeta, { environment: 'development' }, 'page-config-meta-bare');
    const html = pages.get('/');
    assert.ok(html.includes('<title>Page title wins</title>'), 'the page meta.title wins');
    assert.ok(html.includes('content="Site default description"'), 'the config meta.description merges underneath');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the config `meta` section is the site default when no page or layout sets one', async () => {
  const { tmp, consumerDir } = makeConsumer([]);
  const siteMeta = { ...bareData, meta: { title: 'Config meta title' } };
  try {
    const pages = await buildSite(consumerDir, siteMeta, { environment: 'development' }, 'page-config-meta-site');
    assert.ok(pages.get('/').includes('<title>Config meta title</title>'), 'the config meta.title reaches the head');
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
    assetManifest: { js: { pages: {} }, css: { pages: {}, themePages: {} } },
  });

  const strays = Object.keys(globals.site).filter((key) => !SITE_FACT_KEYS.includes(key));
  assert.deepEqual(strays, [], `site.${strays.join(', site.')} is config, not a build fact — it belongs in resolved.config`);
});
