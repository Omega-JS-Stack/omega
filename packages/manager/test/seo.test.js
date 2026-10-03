/**
 * SEO service tests — the github-repos operation against a method-level
 * recording fake of the gh-backed API, with the template pipeline real
 * (auto-discovery, generators, static files). Proves skip semantics, the
 * loaded seo section as the only content source, the converged zero-mutation no-op, repo
 * creation with full template push, content-compared updates + stale-file
 * deletion, the MAX_STALE_FILES collision guardrail (nothing touched on a
 * suspected real repo), per-item author identity (a named .env token + git
 * author/committer), the loud per-item error surfacing omega-manager
 * swallowed, and the dry-run zero-mutation guarantee.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

// The machine registry is per-machine state: the playground load records into a temp home.
require('@omega.js/devkit/test/temp-home');

const { loadConfig } = require('@omega.js/config');

const { SERVICE_ORDER, OPERATIONS, DEFAULTS } = require('../src/config.js');
const { loadTemplate } = require('../src/services/seo/templates/index.js');
const service = require('../src/services/seo/index.js');
const { activate } = require('./lib/fake-gh.js');

// A run with no injected API reaches the `gh` on PATH: the fake, signed out.
const { useGh } = activate();

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
    owner: 'fixture-org',
    title: 'Fixture Tool',
    description: 'automates fixture things',
    topics: ['fixture', 'automation'],
    features: ['**Fast:** does things quickly'],
    cta: { url: 'https://fixture-brand.test/download', platform: 'https://fixture-brand.test/tool' },
    ...overrides,
  };
}

function brandConfig({ seo, content = [contentItem()], repo = { provider: 'github', owner: 'default-org' } } = {}) {
  const config = {
    brand: structuredClone(BRAND),
    targets: { web: { type: 'web' } },
    ...(repo ? { repo } : {}),
  };
  if (seo !== undefined) {
    config.seo = seo;
  } else {
    config.seo = { ...structuredClone(DEFAULTS.seo), github: { content: structuredClone(content) } };
  }
  return config;
}

/** The exact file contents the template generates for an item. */
function templateContents(item, owner = item.owner) {
  const template = loadTemplate(item.template || 'developer-tool');
  const data = { ...item, owner, brand: structuredClone(BRAND) };
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
function convergedResponses(item, owner = item.owner) {
  const contents = templateContents(item, owner);
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

module.exports = defineCases({
  type: 'group',
  description: 'seo',
  tests: [
    // ─── Registry / defaults / template pins ─────────────────────────────────────

    {
      name: 'seo: registered after disperse with the github-repos operation',
      run: (ctx) => {
        ctx.expect(SERVICE_ORDER[SERVICE_ORDER.indexOf('disperse') + 1]).toBe('seo');
        ctx.expect(OPERATIONS.seo.map((o) => o.name)).toEqual(['github-repos']);
        ctx.expect(DEFAULTS.seo).toEqual({ enabled: true });
      },
    },

    {
      name: 'seo: the developer-tool template auto-discovers all six files',
      run: (ctx) => {
        const template = loadTemplate('developer-tool');
        ctx.expect(template.files.map((f) => f.path).sort()).toEqual(TEMPLATE_PATHS);
        const generated = template.files.filter((f) => f.generate).map((f) => f.path).sort();
        ctx.expect(generated).toEqual(['README.md', 'package.json']);
        const workflow = template.files.find((f) => f.path === '.github/workflows/maintenance.yml');
        ctx.expect(workflow.content).toMatch(/cron: '0 1 \* \* \*'/);
        ctx.expect(workflow.content).toMatch(/git push --force origin maintenance/);
      },
    },

    {
      name: 'seo: an unknown template name throws with the available list',
      run: (ctx) => {
        ctx.expect(() => loadTemplate('nope')).toThrow(/Unknown SEO template: "nope".*developer-tool/);
      },
    },

    {
      name: 'seo: the README generator renders hero, features, custom section, and star history',
      run: (ctx) => {
        const item = contentItem({ custom: '## Extra Section\n\nInjected markdown' });
        const readme = templateContents(item)['README.md'];

        ctx.expect(readme).toMatch(/<h1>Fixture Tool<\/h1>/);
        ctx.expect(readme).toMatch(/<img src="https:\/\/fixture-brand\.test\/brandmark\.png" width="60"/);
        ctx.expect(readme).toMatch(/> A fixture brand for tests/);
        ctx.expect(readme).toMatch(/- \*\*Fast:\*\* does things quickly/);
        ctx.expect(readme).toMatch(/## Extra Section\n\nInjected markdown/);
        ctx.expect(readme).toMatch(/fixture-brand\.test\/download\?download=windows/);
        ctx.expect(readme).toMatch(/api\.star-history\.com\/svg\?repos=fixture-org\/fixture-tool/);
        ctx.expect(readme).toMatch(/git clone https:\/\/github\.com\/fixture-org\/fixture-tool\.git/);
      },
    },

    {
      name: 'seo: the package.json generator derives name, keywords, and homepage',
      run: (ctx) => {
        const pkg = JSON.parse(templateContents(contentItem())['package.json']);
        ctx.expect(pkg.name).toBe('fixture-org-fixture-tool');
        ctx.expect(pkg.description).toBe('Fixture Tool automates fixture things');
        ctx.expect(pkg.keywords).toEqual(['fixture', 'automation']);
        ctx.expect(pkg.homepage).toBe('https://fixture-brand.test/tool');
        ctx.expect(pkg.repository.url).toBe('git+https://github.com/fixture-org/fixture-tool.git');
      },
    },

    // ─── Setup / skip semantics ──────────────────────────────────────────────────

    {
      name: 'seo: seo.enabled = false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ seo: { enabled: false } }));
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/seo\.enabled/);
      },
    },

    {
      name: 'seo: scalar seo: false skips the service',
      run: async (ctx) => {
        const result = await runService(brandConfig({ seo: false }));
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/seo\.enabled/);
      },
    },

    {
      name: 'seo: no content anywhere skips with sidecar guidance',
      run: async (ctx) => {
        const result = await runService(brandConfig({ seo: { enabled: true } }));
        ctx.expect(result.status).toBe('skipped');
        ctx.expect(result.reason).toMatch(/no SEO content configured.*seo\.json5/);
      },
    },

    {
      name: '#1037 seo: a headless walk with a signed-out gh skips, naming GH_TOKEN and gh auth login',
      run: async (ctx) => {
        const saved = { OMEGA_NON_INTERACTIVE: process.env.OMEGA_NON_INTERACTIVE, GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
        process.env.OMEGA_NON_INTERACTIVE = '1';
        delete process.env.GH_TOKEN;
        delete process.env.GITHUB_TOKEN;
        ctx.after(() => {
          for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        });
        ctx.after(useGh(null));

        // No seoApi: the service's real setup path, with content configured
        const result = await runService(brandConfig()).then((r) => r, (error) => ({ status: 'error', error: error.message }));

        ctx.expect(result.status, JSON.stringify(result)).toBe('skipped');
        ctx.expect(result.missingEnv).toEqual(['GH_TOKEN']);
        ctx.expect(result.reason).toMatch(/gh auth login/);
      },
    },

    {
      name: 'seo: the content of the loaded seo section runs, and the service never reads config/seo.json5',
      run: async (ctx) => {
        const root = stageBrand();
        const item = contentItem();
        // A sidecar on disk the service must not read: the loader already merged it
        jetpack.write(
          join(root, 'config', 'seo.json5'),
          `{\n  github: { content: [${JSON.stringify(contentItem({ name: 'from-disk' }))}] },\n}\n`,
        );

        const api = fakeSeo(convergedResponses(item));
        const result = await runService(brandConfig({ seo: { enabled: true, github: { content: [item] } } }), { root, api });

        ctx.expect(result.status, JSON.stringify(result)).toBe('success');
        ctx.expect(result.output.githubRepos.repos).toEqual([{ repo: 'fixture-org/fixture-tool', status: 'synced' }]);
        ctx.expect(api.mutations()).toEqual([]);
      },
    },

    {
      name: 'seo: the playground brand, loaded, plans its one repo from the sidecar the loader read',
      run: async (ctx) => {
        const root = join(__dirname, '..', '..', '..', 'brands', 'playground-omega');
        const { config, errors } = loadConfig(root);
        ctx.expect(errors).toEqual([]);
        const api = fakeSeo({ getRepo: null });

        const result = await runService(config, { root, api, options: { dryRun: true } });

        ctx.expect(result.status, JSON.stringify(result)).toBe('success');
        ctx.expect(result.output.githubRepos.repos).toEqual([{ repo: 'Omega-JS-Stack/omega-playground-seo-demo', status: 'planned' }]);
        ctx.expect(api.mutations()).toEqual([]);
      },
    },

    // ─── Converged no-op ─────────────────────────────────────────────────────────

    {
      name: 'seo: a fully converged repo is a zero-mutation no-op',
      run: async (ctx) => {
        const item = contentItem();
        const api = fakeSeo(convergedResponses(item));

        const result = await runService(brandConfig(), { api });

        ctx.expect(result.status).toBe('success');
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(result.output.githubRepos.repos).toEqual([{ repo: 'fixture-org/fixture-tool', status: 'synced' }]);
        // no durable state — the repos ARE the sync target
        ctx.expect(result.state).toBe(null);
      },
    },

    // ─── Creation ────────────────────────────────────────────────────────────────

    {
      name: 'seo: a missing repo is created and the full template is pushed',
      run: async (ctx) => {
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

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.githubRepos.repos).toEqual([{ repo: 'fixture-org/fixture-tool', status: 'created' }]);

        // createRepo carried the description
        ctx.expect(api.of('createRepo')[0].args).toEqual(['fixture-org/fixture-tool', 'automates fixture things', null]);

        // All six template files pushed; the auto-init README updates in place
        const puts = api.of('putContents');
        ctx.expect(puts.map((c) => c.args[1]).sort()).toEqual(TEMPLATE_PATHS);
        const readmePut = puts.find((c) => c.args[1] === 'README.md');
        ctx.expect(readmePut.args[2].message).toBe('Update README.md');
        ctx.expect(readmePut.args[2].sha).toBe('sha-init');
        ctx.expect(Buffer.from(readmePut.args[2].content, 'base64').toString()).toMatch(/<h1>Fixture Tool<\/h1>/);
        const nvmrcPut = puts.find((c) => c.args[1] === '.nvmrc');
        ctx.expect(nvmrcPut.args[2].message).toBe('Add .nvmrc');
        ctx.expect(nvmrcPut.args[2].sha).toBe(undefined);
        ctx.expect(nvmrcPut.args[2].author).toBe(undefined);

        // Settings, topics, and the star all reconciled
        ctx.expect(api.of('patchRepo')[0].args[1]).toEqual({ description: 'automates fixture things', homepage: 'https://fixture-brand.test/tool' });
        ctx.expect(api.of('putTopics')[0].args[1]).toEqual(['fixture', 'automation']);
        ctx.expect(api.of('starRepo').length).toBe(1);
      },
    },

    {
      name: 'seo: a repo that never appears after creation errors with owner guidance',
      run: async (ctx) => {
        const api = fakeSeo({ getRepo: null, createRepo: {} });

        const result = await runService(brandConfig(), { api });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.output.githubRepos.repos[0].error).toMatch(/is "fixture-org" an org/);
      },
    },

    // ─── Updates ─────────────────────────────────────────────────────────────────

    {
      name: 'seo: a drifted README and a stale file update surgically',
      run: async (ctx) => {
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

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.githubRepos.repos[0].status).toBe('updated');

        // Exactly ONE file rewritten (the drifted README, with its sha)
        const puts = api.of('putContents');
        ctx.expect(puts.length).toBe(1);
        ctx.expect(puts[0].args[1]).toBe('README.md');
        ctx.expect(puts[0].args[2].sha).toBe('sha-readme');

        // Exactly ONE stale file removed
        const deletes = api.of('deleteContents');
        ctx.expect(deletes.map((c) => [c.args[1], c.args[2]])).toEqual([['old-script.js', { message: 'Remove old-script.js', sha: 'sha-old' }]]);

        ctx.expect(api.of('patchRepo').length).toBe(0);
        ctx.expect(api.of('putTopics').length).toBe(0);
      },
    },

    // ─── Collision guardrail ─────────────────────────────────────────────────────

    {
      name: 'seo: a suspected real repo (too many stale files) is refused untouched, other items still run',
      run: async (ctx) => {
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
        ctx.expect(result.status).toBe('error');
        ctx.expect(result.error).toMatch(/fixture-org\/free-proxy-list/);
        ctx.expect(result.output.githubRepos.repos[0].error).toMatch(/refusing to manage: 11 non-template files exceed cap of 10/);

        // NOTHING was modified on either repo; the safe item still reconciled
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(result.output.githubRepos.repos[1].status).toBe('synced');
      },
    },

    // ─── Author identity ─────────────────────────────────────────────────────────

    {
      name: 'seo: author token + git identity ride every call and commit',
      run: async (ctx) => {
        process.env.FIXTURE_GH_TOKEN = 'tok-123';
        try {
          const item = contentItem({
            author: { tokenEnv: 'FIXTURE_GH_TOKEN', git: { name: 'sockpuppet', email: 'sock@example.test' } },
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

          ctx.expect(result.status).toBe('success');
          // Every API call carried the resolved token
          for (const call of api.calls) {
            ctx.expect(call.args[call.args.length - 1]).toBe('tok-123');
          }
          // The commit carried the git identity as author AND committer
          const body = api.of('putContents')[0].args[2];
          ctx.expect(body.author).toEqual({ name: 'sockpuppet', email: 'sock@example.test' });
          ctx.expect(body.committer).toEqual({ name: 'sockpuppet', email: 'sock@example.test' });
        } finally {
          delete process.env.FIXTURE_GH_TOKEN;
        }
      },
    },

    {
      name: 'seo: a tokenEnv naming an unset variable fails the item, and no API call is made for it',
      run: async (ctx) => {
        delete process.env.FIXTURE_MISSING_TOKEN;
        const item = contentItem({ author: { tokenEnv: 'FIXTURE_MISSING_TOKEN' } });
        const api = fakeSeo(convergedResponses(item));

        const result = await runService(brandConfig({ content: [item] }), { api });

        ctx.expect(result.status, JSON.stringify(result)).toBe('error');
        ctx.expect(result.output.githubRepos.repos[0].error.includes('seo item fixture-tool: author.tokenEnv names FIXTURE_MISSING_TOKEN, which is not set in .env'), result.output.githubRepos.repos[0].error).toBeTruthy();
        ctx.expect(api.calls).toEqual([]);
      },
    },

    {
      name: 'seo: an empty tokenEnv names no variable, so it fails the item like an unset one, with no API call',
      run: async (ctx) => {
        const item = contentItem({ author: { tokenEnv: '' } });
        const api = fakeSeo(convergedResponses(item));

        const result = await runService(brandConfig({ content: [item] }), { api });

        ctx.expect(result.status, JSON.stringify(result)).toBe('error');
        ctx.expect(result.output.githubRepos.repos[0].error.includes('seo item fixture-tool: author.tokenEnv names , which is not set in .env'), result.output.githubRepos.repos[0].error).toBeTruthy();
        ctx.expect(api.calls).toEqual([]);
      },
    },

    // ─── Defaults ────────────────────────────────────────────────────────────────

    {
      name: 'seo: owner defaults to repo.owner and homepage to brand.url',
      run: async (ctx) => {
        const item = contentItem({ owner: undefined, cta: undefined });
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

        ctx.expect(result.status).toBe('success');
        ctx.expect(result.output.githubRepos.repos[0].repo).toBe('default-org/fixture-tool');
        // Homepage fell back to brand.url → the empty-homepage repo gets patched
        ctx.expect(api.of('patchRepo')[0].args[1]).toEqual({ description: 'automates fixture things', homepage: 'https://fixture-brand.test' });
      },
    },

    {
      name: 'seo: an item with no owner anywhere errors without touching the API',
      run: async (ctx) => {
        const item = contentItem({ owner: undefined });
        const api = fakeSeo();

        const result = await runService(brandConfig({ content: [item], repo: null }), { api });

        ctx.expect(result.status).toBe('error');
        ctx.expect(result.output.githubRepos.repos[0].error).toMatch(/missing owner or name/);
        ctx.expect(api.calls).toEqual([]);
      },
    },

    // ─── Dry run ─────────────────────────────────────────────────────────────────

    {
      name: 'seo: dry run on a missing repo plans the create without creating',
      run: async (ctx) => {
        const api = fakeSeo({ getRepo: null });

        const result = await runService(brandConfig(), { api, options: { dryRun: true } });

        ctx.expect(result.status).toBe('success');
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(result.output.githubRepos.repos).toEqual([{ repo: 'fixture-org/fixture-tool', status: 'planned' }]);
      },
    },

    {
      name: 'seo: dry run on a fully drifted repo performs zero mutations',
      run: async (ctx) => {
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

        ctx.expect(result.status).toBe('success');
        ctx.expect(api.mutations()).toEqual([]);
        ctx.expect(result.output.githubRepos.repos[0].status).toBe('planned');
        ctx.expect(result.state).toBe(null);
      },
    },
  ],
});
