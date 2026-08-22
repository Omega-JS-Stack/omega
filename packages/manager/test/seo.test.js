/**
 * SEO service tests — the github-repos operation against a method-level
 * recording fake of the gh-backed API, with the template pipeline real
 * (auto-discovery, generators, static files). Proves skip semantics, the
 * config/seo.json5 sidecar merge, the converged zero-mutation no-op, repo
 * creation with full template push, content-compared updates + stale-file
 * deletion, the MAX_STALE_FILES collision guardrail (nothing touched on a
 * suspected real repo), per-item author identity (env token + git
 * author/committer), the loud per-item error surfacing omega-manager
 * swallowed, and the dry-run zero-mutation guarantee.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { loadTemplate } = require('../src/services/seo/templates/index.js');
const service = require('../src/services/seo/index.js');

const BRAND = {
  id: 'fixture-brand',
  name: 'Fixture Brand',
  url: 'https://fixture-brand.test',
  description: 'A fixture brand for tests',
  images: { brandmark: 'https://fixture-brand.test/brandmark.png' },
};

const TEMPLATE_PATHS = [
  '.github/workflows/maintenance.yml',
  '.gitignore',
  '.nvmrc',
  'README.md',
  'package.json',
  'src/index.js',
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stageBrand() {
  return mkdtempSync(join(tmpdir(), 'omega-seo-'));
}

function contentItem(overrides = {}) {
  return {
    name: 'fixture-tool',
    org: 'fixture-org',
    title: 'Fixture Tool',
    description: 'automates fixture things',
    topics: ['fixture', 'automation'],
    features: ['**Fast:** does things quickly'],
    cta: { url: 'https://fixture-brand.test/download', platform: 'https://fixture-brand.test/tool' },
    ...overrides,
  };
}

function brandConfig({ seo, content = [contentItem()], github = { org: 'default-org' } } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    targets: { web: {} },
    repo: { providers: { github } },
  };
  if (seo !== undefined) {
    config.seo = seo;
  } else {
    config.seo = { ...structuredClone(DEFAULTS.seo), github: { content: structuredClone(content) } };
  }
  return config;
}

/** The exact file contents the template generates for an item. */
function templateContents(item, org = item.org) {
  const template = loadTemplate(item.template || 'developer-tool');
  const data = { ...item, org, brand: structuredClone(BRAND) };
  const map = {};
  for (const file of template.files) {
    map[file.path] = file.generate ? file.generate(data) : file.content;
  }
  return map;
}

const MUTATING = new Set(['createRepo', 'putContents', 'deleteContents', 'patchRepo', 'putTopics', 'starRepo']);

/** Method-level recording fake — a call with no configured response throws LOUDLY. */
function fakeSeo(responses = {}) {
  const api = { calls: [] };
  const methods = [
    'getRepo', 'createRepo', 'getTree', 'getContents', 'putContents',
    'deleteContents', 'patchRepo', 'getTopics', 'putTopics', 'isStarred', 'starRepo',
  ];

  for (const method of methods) {
    api[method] = async (...args) => {
      api.calls.push({ method, args });
      if (!(method in responses)) {
        throw new Error(`fakeSeo: unexpected call ${method}(${JSON.stringify(args[0])})`);
      }
      const responder = responses[method];
      return typeof responder === 'function' ? responder(...args) : structuredClone(responder);
    };
  }

  api.mutations = () => api.calls.filter((c) => MUTATING.has(c.method));
  api.of = (method) => api.calls.filter((c) => c.method === method);
  return api;
}

/** Responses for a repo fully converged to `item` (nothing to change). */
function convergedResponses(item, org = item.org) {
  const contents = templateContents(item, org);
  return {
    getRepo: { description: item.description || '', homepage: item.cta?.platform || item.cta?.url || BRAND.url },
    getTree: Object.keys(contents).map((path) => ({ path, type: 'blob' })),
    getContents: (slug, path) => ({ content: Buffer.from(contents[path]).toString('base64'), sha: `sha-${path}` }),
    getTopics: [...(item.topics || [])].reverse(), // order differs — must not count as drift
    isStarred: true,
  };
}

function runService(config, { root, api, options = {} } = {}) {
  return service.run({
    brandId: BRAND.id,
    brandRoot: root || stageBrand(),
    brandConfig: config,
    brand: { id: BRAND.id, config, enabledTargets: Object.keys(config.targets || {}), targets: [] },
    targets: [],
    operations: OPERATIONS.seo,
    options,
    serviceData: {},
    seoApi: api,
  });
}

// ─── Registry / defaults / template pins ─────────────────────────────────────

test('seo: registered after disperse with the github-repos operation', () => {
  assert.equal(SERVICE_ORDER[SERVICE_ORDER.indexOf('disperse') + 1], 'seo');
  assert.deepEqual(OPERATIONS.seo.map((o) => o.name), ['github-repos']);
  assert.deepEqual(DEFAULTS.seo, { enabled: true });
});

test('seo: the developer-tool template auto-discovers all six files', () => {
  const template = loadTemplate('developer-tool');
  assert.deepEqual(template.files.map((f) => f.path).sort(), TEMPLATE_PATHS);
  const generated = template.files.filter((f) => f.generate).map((f) => f.path).sort();
  assert.deepEqual(generated, ['README.md', 'package.json']);
  const workflow = template.files.find((f) => f.path === '.github/workflows/maintenance.yml');
  assert.match(workflow.content, /cron: '0 1 \* \* \*'/);
  assert.match(workflow.content, /git push --force origin maintenance/);
});

test('seo: an unknown template name throws with the available list', () => {
  assert.throws(() => loadTemplate('nope'), /Unknown SEO template: "nope".*developer-tool/);
});

test('seo: the README generator renders hero, features, custom section, and star history', () => {
  const item = contentItem({ custom: '## Extra Section\n\nInjected markdown' });
  const readme = templateContents(item)['README.md'];

  assert.match(readme, /<h1>Fixture Tool<\/h1>/);
  assert.match(readme, /<img src="https:\/\/fixture-brand\.test\/brandmark\.png" width="60"/);
  assert.match(readme, /> A fixture brand for tests/);
  assert.match(readme, /- \*\*Fast:\*\* does things quickly/);
  assert.match(readme, /## Extra Section\n\nInjected markdown/);
  assert.match(readme, /fixture-brand\.test\/download\?download=windows/);
  assert.match(readme, /api\.star-history\.com\/svg\?repos=fixture-org\/fixture-tool/);
  assert.match(readme, /git clone https:\/\/github\.com\/fixture-org\/fixture-tool\.git/);
});

test('seo: the package.json generator derives name, keywords, and homepage', () => {
  const pkg = JSON.parse(templateContents(contentItem())['package.json']);
  assert.equal(pkg.name, 'fixture-org-fixture-tool');
  assert.equal(pkg.description, 'Fixture Tool automates fixture things');
  assert.deepEqual(pkg.keywords, ['fixture', 'automation']);
  assert.equal(pkg.homepage, 'https://fixture-brand.test/tool');
  assert.equal(pkg.repository.url, 'git+https://github.com/fixture-org/fixture-tool.git');
});

// ─── Setup / skip semantics ──────────────────────────────────────────────────

test('seo: seo.enabled = false skips the service', async () => {
  const result = await runService(brandConfig({ seo: { enabled: false } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /seo\.enabled/);
});

test('seo: scalar seo: false skips the service', async () => {
  const result = await runService(brandConfig({ seo: false }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /seo\.enabled/);
});

test('seo: no content anywhere skips with sidecar guidance', async () => {
  const result = await runService(brandConfig({ seo: { enabled: true } }));
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no SEO content configured.*seo\.json5/);
});

test('seo: content from the config/seo.json5 sidecar merges over the config section', async () => {
  const root = stageBrand();
  const item = contentItem();
  jetpack.write(
    join(root, 'config', 'seo.json5'),
    `{\n  // sidecar content\n  github: { content: [${JSON.stringify(item)}] },\n}\n`,
  );

  const api = fakeSeo(convergedResponses(item));
  const result = await runService(brandConfig({ seo: { enabled: true } }), { root, api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.output.githubRepos.synced, 1);
});

// ─── Converged no-op ─────────────────────────────────────────────────────────

test('seo: a fully converged repo is a zero-mutation no-op', async () => {
  const item = contentItem();
  const api = fakeSeo(convergedResponses(item));

  const result = await runService(brandConfig(), { api });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(result.output.githubRepos.repos, [{ repo: 'fixture-org/fixture-tool', status: 'synced' }]);
  // no durable state — the repos ARE the sync target
  assert.equal(result.state, null);
});

// ─── Creation ────────────────────────────────────────────────────────────────

test('seo: a missing repo is created and the full template is pushed', async () => {
  const item = contentItem();
  let repoExists = false;
  const api = fakeSeo({
    getRepo: () => (repoExists ? { description: item.description, homepage: '' } : null),
    createRepo: () => { repoExists = true; },
    // auto-init leaves the default README in the tree
    getTree: [{ path: 'README.md', type: 'blob' }],
    getContents: (slug, path) => (path === 'README.md'
      ? { content: Buffer.from('# auto-init').toString('base64'), sha: 'sha-init' }
      : null),
    putContents: {},
    patchRepo: {},
    getTopics: [],
    putTopics: {},
    isStarred: false,
    starRepo: {},
  });

  const result = await runService(brandConfig(), { api });

  assert.equal(result.status, 'success');
  assert.deepEqual(result.output.githubRepos.repos, [{ repo: 'fixture-org/fixture-tool', status: 'created' }]);

  // createRepo carried the description
  assert.deepEqual(api.of('createRepo')[0].args, ['fixture-org/fixture-tool', 'automates fixture things', null]);

  // All six template files pushed; the auto-init README updates in place
  const puts = api.of('putContents');
  assert.deepEqual(puts.map((c) => c.args[1]).sort(), TEMPLATE_PATHS);
  const readmePut = puts.find((c) => c.args[1] === 'README.md');
  assert.equal(readmePut.args[2].message, 'Update README.md');
  assert.equal(readmePut.args[2].sha, 'sha-init');
  assert.match(Buffer.from(readmePut.args[2].content, 'base64').toString(), /<h1>Fixture Tool<\/h1>/);
  const nvmrcPut = puts.find((c) => c.args[1] === '.nvmrc');
  assert.equal(nvmrcPut.args[2].message, 'Add .nvmrc');
  assert.equal(nvmrcPut.args[2].sha, undefined);
  assert.equal(nvmrcPut.args[2].author, undefined);

  // Settings, topics, and the star all reconciled
  assert.deepEqual(api.of('patchRepo')[0].args[1], { description: 'automates fixture things', homepage: 'https://fixture-brand.test/tool' });
  assert.deepEqual(api.of('putTopics')[0].args[1], ['fixture', 'automation']);
  assert.equal(api.of('starRepo').length, 1);
});

test('seo: a repo that never appears after creation errors with owner guidance', async () => {
  const api = fakeSeo({ getRepo: null, createRepo: {} });

  const result = await runService(brandConfig(), { api });

  assert.equal(result.status, 'error');
  assert.match(result.output.githubRepos.repos[0].error, /is "fixture-org" an org/);
});

// ─── Updates ─────────────────────────────────────────────────────────────────

test('seo: a drifted README and a stale file update surgically', async () => {
  const item = contentItem();
  const contents = templateContents(item);
  const api = fakeSeo({
    getRepo: { description: item.description, homepage: item.cta.platform },
    getTree: [...Object.keys(contents).map((path) => ({ path, type: 'blob' })), { path: 'old-script.js', type: 'blob' }],
    getContents: (slug, path) => {
      if (path === 'old-script.js') return { content: Buffer.from('stale').toString('base64'), sha: 'sha-old' };
      if (path === 'README.md') return { content: Buffer.from('# outdated').toString('base64'), sha: 'sha-readme' };
      return { content: Buffer.from(contents[path]).toString('base64'), sha: `sha-${path}` };
    },
    putContents: {},
    deleteContents: {},
    getTopics: item.topics,
    isStarred: true,
  });

  const result = await runService(brandConfig(), { api });

  assert.equal(result.status, 'success');
  assert.equal(result.output.githubRepos.repos[0].status, 'updated');

  // Exactly ONE file rewritten (the drifted README, with its sha)
  const puts = api.of('putContents');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].args[1], 'README.md');
  assert.equal(puts[0].args[2].sha, 'sha-readme');

  // Exactly ONE stale file removed
  const deletes = api.of('deleteContents');
  assert.deepEqual(deletes.map((c) => [c.args[1], c.args[2]]), [['old-script.js', { message: 'Remove old-script.js', sha: 'sha-old' }]]);

  assert.equal(api.of('patchRepo').length, 0);
  assert.equal(api.of('putTopics').length, 0);
});

// ─── Collision guardrail ─────────────────────────────────────────────────────

test('seo: a suspected real repo (too many stale files) is refused untouched, other items still run', async () => {
  const collider = contentItem({ name: 'free-proxy-list' });
  const safe = contentItem();
  const bigTree = Array.from({ length: 11 }, (_, i) => ({ path: `data/real-file-${i}.json`, type: 'blob' }));
  const converged = convergedResponses(safe);
  const safeTree = Object.keys(templateContents(safe)).map((path) => ({ path, type: 'blob' }));

  const api = fakeSeo({
    getRepo: (slug) => (slug === 'fixture-org/free-proxy-list'
      ? { description: 'A REAL flagship repo', homepage: 'https://real.example' }
      : converged.getRepo),
    getTree: (slug) => (slug === 'fixture-org/free-proxy-list' ? structuredClone(bigTree) : safeTree),
    getContents: converged.getContents,
    getTopics: converged.getTopics,
    isStarred: true,
  });

  const result = await runService(brandConfig({ content: [collider, safe] }), { api });

  // The collision is a LOUD service error (omega-manager reported success)
  assert.equal(result.status, 'error');
  assert.match(result.error, /fixture-org\/free-proxy-list/);
  assert.match(result.output.githubRepos.repos[0].error, /refusing to manage: 11 non-template files exceed cap of 10/);

  // NOTHING was modified on either repo; the safe item still reconciled
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.output.githubRepos.repos[1].status, 'synced');
});

// ─── Author identity ─────────────────────────────────────────────────────────

test('seo: author token + git identity ride every call and commit', async () => {
  process.env.FIXTURE_GH_TOKEN = 'tok-123';
  try {
    const item = contentItem({
      author: { token: 'env:FIXTURE_GH_TOKEN', git: { name: 'sockpuppet', email: 'sock@example.test' } },
    });
    const contents = templateContents(item);
    const api = fakeSeo({
      getRepo: { description: item.description, homepage: item.cta.platform },
      getTree: Object.keys(contents).map((path) => ({ path, type: 'blob' })),
      getContents: (slug, path) => (path === 'README.md'
        ? { content: Buffer.from('# outdated').toString('base64'), sha: 'sha-readme' }
        : { content: Buffer.from(contents[path]).toString('base64'), sha: `sha-${path}` }),
      putContents: {},
      getTopics: item.topics,
      isStarred: true,
    });

    const result = await runService(brandConfig({ content: [item] }), { api });

    assert.equal(result.status, 'success');
    // Every API call carried the resolved token
    for (const call of api.calls) {
      assert.equal(call.args[call.args.length - 1], 'tok-123');
    }
    // The commit carried the git identity as author AND committer
    const body = api.of('putContents')[0].args[2];
    assert.deepEqual(body.author, { name: 'sockpuppet', email: 'sock@example.test' });
    assert.deepEqual(body.committer, { name: 'sockpuppet', email: 'sock@example.test' });
  } finally {
    delete process.env.FIXTURE_GH_TOKEN;
  }
});

test('seo: an unset token env var falls back to default auth', async () => {
  delete process.env.FIXTURE_MISSING_TOKEN;
  const item = contentItem({ author: { token: 'env:FIXTURE_MISSING_TOKEN' } });
  const api = fakeSeo(convergedResponses(item));

  const result = await runService(brandConfig({ content: [item] }), { api });

  assert.equal(result.status, 'success');
  assert.equal(api.of('getRepo')[0].args[1], null);
});

// ─── Defaults ────────────────────────────────────────────────────────────────

test('seo: org defaults to github.org and homepage to brand.url', async () => {
  const item = contentItem({ org: undefined, cta: undefined });
  const contents = templateContents(item, 'default-org');
  const api = fakeSeo({
    getRepo: { description: item.description, homepage: '' },
    getTree: Object.keys(contents).map((path) => ({ path, type: 'blob' })),
    getContents: (slug, path) => ({ content: Buffer.from(contents[path]).toString('base64'), sha: `sha-${path}` }),
    patchRepo: {},
    getTopics: item.topics,
    isStarred: true,
  });

  const result = await runService(brandConfig({ content: [item] }), { api });

  assert.equal(result.status, 'success');
  assert.equal(result.output.githubRepos.repos[0].repo, 'default-org/fixture-tool');
  // Homepage fell back to brand.url → the empty-homepage repo gets patched
  assert.deepEqual(api.of('patchRepo')[0].args[1], { description: 'automates fixture things', homepage: 'https://fixture-brand.test' });
});

test('seo: an item with no org anywhere errors without touching the API', async () => {
  const item = contentItem({ org: undefined });
  const api = fakeSeo();

  const result = await runService(brandConfig({ content: [item], github: {} }), { api });

  assert.equal(result.status, 'error');
  assert.match(result.output.githubRepos.repos[0].error, /missing org or name/);
  assert.deepEqual(api.calls, []);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('seo: dry run on a missing repo plans the create without creating', async () => {
  const api = fakeSeo({ getRepo: null });

  const result = await runService(brandConfig(), { api, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.deepEqual(result.output.githubRepos.repos, [{ repo: 'fixture-org/fixture-tool', status: 'planned' }]);
});

test('seo: dry run on a fully drifted repo performs zero mutations', async () => {
  const item = contentItem();
  const contents = templateContents(item);
  const api = fakeSeo({
    getRepo: { description: 'old description', homepage: 'https://old.example' },
    getTree: [...Object.keys(contents).map((path) => ({ path, type: 'blob' })), { path: 'stale.txt', type: 'blob' }],
    getContents: (slug, path) => ({ content: Buffer.from('outdated').toString('base64'), sha: `sha-${path}` }),
    getTopics: ['wrong-topic'],
    isStarred: false,
  });

  const result = await runService(brandConfig(), { api, options: { dryRun: true } });

  assert.equal(result.status, 'success');
  assert.deepEqual(api.mutations(), []);
  assert.equal(result.output.githubRepos.repos[0].status, 'planned');
  assert.equal(result.state, null);
});
