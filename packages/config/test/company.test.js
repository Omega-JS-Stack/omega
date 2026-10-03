/**
 * company.js: the ONE company resolver (#677).
 *
 * A brand names its company with one typed key (`company: { id }`), the
 * resolver fills the same object with the company's public facts, and the whole
 * inheritance rule is `file(relPath)`: a brand-level file the child lacks
 * resolves from the parent's `company/` at the same relative path.
 *
 * WHERE the parent is comes from the machine registry every loadConfig()
 * refreshes its own line in, so every fixture here points OMEGA_HOME at its own
 * temp home: a test must never read or write the developer's real registry.
 *
 * Fixtures are built under packages/config/.temp/ (gitignored), matching the
 * devkit test convention.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { resolveCompany, recordBrand, readRegistry, registryFile, loadConfig, composeTargetConfig, validateConfig, COMPANY_RESOLVED_FILE } = require('../src/index.js');

const TEMP_ROOT = path.join(__dirname, '..', '.temp');

// Build a fixture tree ({ 'relative/path': contents }) and return its root.
function makeFixture(name, files) {
  const root = path.join(TEMP_ROOT, `${name}-${process.pid}`);
  fs.rmSync(root, { recursive: true, force: true });
  for (const [relative, contents] of Object.entries(files)) {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  return root;
}

// Point the machine home at this fixture's own dir for the length of the test.
function useHome(t, root) {
  const previous = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(root, 'home');

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previous;
  });
}

// A parent brand carrying a company/ tree, and a child that names it.
function makeCompanyFixture(name, extra) {
  const root = makeFixture(name, Object.assign({
    'parent/config/omega.json5': `{
      brand: { id: 'itw-creative-works', name: 'ITW Creative Works', url: 'https://itwcreativeworks.com', images: { wordmark: '/assets/images/brand/wordmark.png' } },
      company: { id: 'self' },
    }`,
    'parent/company/config/omega.json5': `{
      monitoring: { providers: { sentry: { org: 'itw' } } },
      probe: { value: 'company-shared', fromCompanyShared: true },
    }`,
    'parent/company/.env': 'SENDGRID_API_KEY=company\n',
    'parent/company/config/hooks/account/password.js': 'module.exports = ({ email }) => `company:${email}`;\n',
    'child/targets/web/package.json': `{ "name": "playground-web" }`,
    'child/config/omega.json5': `{
      brand: { id: 'playground', name: 'OMEGA Playground', url: 'https://playground.omegajs.dev' },
      company: { id: 'itw-creative-works' },
      targets: { web: { type: 'web' } },
    }`,
  }, extra));

  return { root, parentRoot: path.join(root, 'parent'), childRoot: path.join(root, 'child') };
}

// The registry line a parent's own run would have written.
function registerParent(parentRoot) {
  recordBrand({ id: 'itw-creative-works', root: parentRoot, name: 'ITW Creative Works', url: 'https://itwcreativeworks.com' });
}

// Seed the registry file by hand, as another brand's run would have left it.
function seedRegistry(lines) {
  fs.mkdirSync(process.env.OMEGA_HOME, { recursive: true });
  fs.writeFileSync(registryFile(), `${JSON.stringify(lines, null, 2)}\n`);
}

module.exports = defineCases({
  type: 'group',
  description: 'company',
  tests: [
    // ─── The resolver ───

    {
      name: 'registry hit: the parent on this machine fills the company facts and the tree',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-hit');
        useHome(ctx, root);
        registerParent(parentRoot);

        const company = resolveCompany(childRoot);

        ctx.expect(company.id).toBe('itw-creative-works');
        ctx.expect(company.name).toBe('ITW Creative Works');
        ctx.expect(company.url).toBe('https://itwcreativeworks.com');
        ctx.expect(company.images).toEqual({ wordmark: '/assets/images/brand/wordmark.png' });
        ctx.expect(company.root).toBe(parentRoot);
        ctx.expect(company.dir).toBe(path.join(parentRoot, 'company'));
      },
    },

    {
      name: 'file(): the ONE inheritance rule, a company path per relative path',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-file');
        useHome(ctx, root);
        registerParent(parentRoot);

        const company = resolveCompany(childRoot);

        // Present in the parent's company/ and absent from the child: it resolves.
        ctx.expect(company.file('.env')).toBe(path.join(parentRoot, 'company', '.env'));
        ctx.expect(company.file(path.join('config', 'hooks', 'account', 'password.js'))).toBe(path.join(parentRoot, 'company', 'config', 'hooks', 'account', 'password.js'));

        // A kind of file the company simply does not carry resolves to nothing, and
        // needs no code of its own to say so.
        ctx.expect(company.file(path.join('.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12'))).toBe(null);
      },
    },

    {
      name: "company.id 'self': the company brand resolves to its own tree and facts",
      run: (ctx) => {
        const { root, parentRoot } = makeCompanyFixture('company-self');
        useHome(ctx, root);

        const company = resolveCompany(parentRoot);

        ctx.expect(company.id).toBe('self');
        ctx.expect(company.name).toBe('ITW Creative Works');
        ctx.expect(company.url).toBe('https://itwcreativeworks.com');
        ctx.expect(company.root).toBe(parentRoot);
        ctx.expect(company.file('.env')).toBe(path.join(parentRoot, 'company', '.env'));
      },
    },

    {
      name: 'no company key: the brand IS the entity, so its own facts fill the shape',
      run: (ctx) => {
        const root = makeFixture('company-absent', {
          'brand/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } }`,
        });
        useHome(ctx, root);

        const company = resolveCompany(path.join(root, 'brand'));

        ctx.expect({ id: company.id, name: company.name, url: company.url, images: company.images, root: company.root }).toEqual({ id: null, name: 'Acme', url: 'https://acme.test', images: {}, root: null });
        ctx.expect(company.file('.env')).toBe(null);
      },
    },

    {
      name: 'a company that is not on this machine: inheritance off, ONE warning per process',
      run: (ctx) => {
        const root = makeFixture('company-miss', {
          'brand/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, company: { id: 'ghost-co' } }`,
        });
        useHome(ctx, root);

        const warnings = [];
        const realWarn = console.warn;
        console.warn = (line) => warnings.push(line);
        ctx.after(() => { console.warn = realWarn; });

        const brandRoot = path.join(root, 'brand');
        const first = resolveCompany(brandRoot);
        const second = resolveCompany(brandRoot);

        ctx.expect(first.id).toBe('ghost-co');
        ctx.expect(first.name).toBe(null);
        ctx.expect(first.url).toBe(null);
        ctx.expect(first.root).toBe(null);
        ctx.expect(first.file('.env')).toBe(null);
        ctx.expect(second.root).toBe(null);

        ctx.expect(warnings).toEqual(['Company ghost-co is not on this machine: inheritance off. Clone it and run any omega verb inside it once.']);
      },
    },

    // ─── The machine registry ───

    {
      name: 'recordBrand: writes a line, and writes nothing the second time',
      run: (ctx) => {
        const root = makeFixture('company-registry', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
        });
        useHome(ctx, root);

        const brandRoot = path.join(root, 'brand');
        ctx.expect(recordBrand({ id: 'acme', root: brandRoot, name: 'Acme', url: 'https://acme.test' })).toBe(true);
        ctx.expect(recordBrand({ id: 'acme', root: brandRoot, name: 'Acme', url: 'https://acme.test' })).toBe(false);

        ctx.expect(Object.keys(readRegistry())).toEqual(['acme']);
        ctx.expect(readRegistry().acme.root).toBe(brandRoot);

        // A moved brand refreshes its own line.
        fs.mkdirSync(path.join(root, 'moved'), { recursive: true });
        ctx.expect(recordBrand({ id: 'acme', root: path.join(root, 'moved'), name: 'Acme', url: 'https://acme.test' })).toBe(true);
        ctx.expect(readRegistry().acme.root).toBe(path.join(root, 'moved'));
      },
    },

    {
      name: 'recordBrand: a line whose root is gone is pruned on the next write',
      run: (ctx) => {
        const root = makeFixture('company-registry-prune', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
        });
        useHome(ctx, root);

        recordBrand({ id: 'ghost', root: path.join(root, 'deleted-brand') });
        recordBrand({ id: 'acme', root: path.join(root, 'brand') });

        ctx.expect(Object.keys(readRegistry()), 'the registry maps what is on this machine now').toEqual(['acme']);
      },
    },

    {
      name: 'recordBrand: a prune keeps a line whose root exists and drops a line whose root is missing',
      run: (ctx) => {
        const root = makeFixture('company-registry-keep', {
          'company/config/omega.json5': `{ brand: { id: 'itw-creative-works' } }`,
          'brand/config/omega.json5': `{ brand: { id: 'playground' } }`,
        });
        useHome(ctx, root);
        fs.symlinkSync(path.join(root, 'company'), path.join(root, 'company-link'));

        seedRegistry({
          'itw-creative-works': { root: path.join(root, 'company'), name: 'ITW Creative Works', url: null, updatedAt: '2026-09-01T00:00:00.000Z' },
          linked: { root: path.join(root, 'company-link'), name: null, url: null, updatedAt: '2026-09-01T00:00:00.000Z' },
          ghost: { root: path.join(root, 'deleted-brand'), name: null, url: null, updatedAt: '2026-09-01T00:00:00.000Z' },
        });

        ctx.expect(recordBrand({ id: 'playground', root: path.join(root, 'brand') })).toBe(true);

        const registry = readRegistry();
        ctx.expect(Object.keys(registry).sort()).toEqual(['itw-creative-works', 'linked', 'playground']);
        ctx.expect(registry['itw-creative-works'].root).toBe(path.join(root, 'company'));
        ctx.expect(resolveCompany(path.join(root, 'brand'), { company: { id: 'linked' } }).root, 'the reader resolves the kept symlinked root the same way').toBe(path.join(root, 'company-link'));
      },
    },

    {
      name: 'recordBrand: a registry it cannot read is left untouched, never rewritten to one line',
      run: (ctx) => {
        const root = makeFixture('company-registry-torn', {
          'company/config/omega.json5': `{ brand: { id: 'itw-creative-works' } }`,
          'brand/config/omega.json5': `{ brand: { id: 'playground' } }`,
        });
        useHome(ctx, root);

        const warnings = [];
        const realWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        ctx.after(() => { console.warn = realWarn; });

        // What a reader sees mid-write from a racing process: the first half of a file.
        seedRegistry({ 'itw-creative-works': { root: path.join(root, 'company'), name: 'ITW Creative Works', url: null } });
        const torn = fs.readFileSync(registryFile(), 'utf8').slice(0, 40);
        fs.writeFileSync(registryFile(), torn);

        ctx.expect(recordBrand({ id: 'playground', root: path.join(root, 'brand') })).toBe(false);
        ctx.expect(fs.readFileSync(registryFile(), 'utf8')).toBe(torn);
        ctx.expect(warnings.length).toBe(1);
        ctx.expect(warnings[0]).toMatch(/\[@omega\.js\/config:company\]/);
        ctx.expect(warnings[0].includes(registryFile()), 'the warning names the file').toBeTruthy();
      },
    },

    {
      name: 'recordBrand: racing writers never lose a line whose root exists',
      run: async (ctx) => {
        const root = makeFixture('company-registry-race', {
          'company/config/omega.json5': `{ brand: { id: 'itw-creative-works' } }`,
          'a/config/omega.json5': '{}',
          'b/config/omega.json5': '{}',
        });
        useHome(ctx, root);
        seedRegistry({ 'itw-creative-works': { root: path.join(root, 'company'), name: 'ITW Creative Works', url: null } });

        // Each writer flips its own line between two roots, so every call writes.
        const writer = (id) => new Promise((resolve, reject) => {
          const script = `
      const { recordBrand } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'company.js'))});
      for (let i = 0; i < 150; i++) recordBrand({ id: ${JSON.stringify(id)}, root: ${JSON.stringify(root)} + (i % 2 ? '/a' : '/b') });
    `;
          const child = require('node:child_process').spawn(process.execPath, ['-e', script], { env: process.env, stdio: 'ignore' });
          child.on('error', reject);
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`writer ${id} exited ${code}`))));
        });

        await Promise.all(['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(writer));

        ctx.expect(readRegistry()['itw-creative-works'], 'the company line survived every concurrent write').toBeTruthy();
      },
    },

    {
      name: 'recordBrand: every write logs its caller, the ids kept and the ids pruned at debug level',
      run: (ctx) => {
        const root = makeFixture('company-registry-debug', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
        });
        useHome(ctx, root);

        const lines = [];
        const realDebug = console.debug;
        const previous = process.env.OMEGA_DEBUG;
        console.debug = (...args) => lines.push(args.join(' '));
        ctx.after(() => {
          console.debug = realDebug;
          if (previous === undefined) delete process.env.OMEGA_DEBUG;
          else process.env.OMEGA_DEBUG = previous;
        });

        seedRegistry({ ghost: { root: path.join(root, 'deleted-brand'), name: null, url: null } });

        delete process.env.OMEGA_DEBUG;
        recordBrand({ id: 'acme', root: path.join(root, 'brand'), name: 'Acme' });
        ctx.expect(lines, 'silent without OMEGA_DEBUG').toEqual([]);

        process.env.OMEGA_DEBUG = '1';
        recordBrand({ id: 'acme', root: path.join(root, 'brand'), name: 'Acme Renamed' });
        seedRegistry({ acme: readRegistry().acme, ghost: { root: path.join(root, 'deleted-brand'), name: null, url: null } });
        recordBrand({ id: 'acme', root: path.join(root, 'brand'), name: 'Acme' });

        ctx.expect(lines.length).toBe(2);
        ctx.expect(lines[1]).toMatch(/\[@omega\.js\/config:company\]/);
        ctx.expect(lines[1].includes(process.argv[1]), 'names the calling process').toBeTruthy();
        ctx.expect(lines[1].includes('kept [acme]'), lines[1]).toBeTruthy();
        ctx.expect(lines[1].includes('pruned [ghost]'), lines[1]).toBeTruthy();
      },
    },

    {
      name: 'loadConfig writes the brand its own registry line, idempotently',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-registry-load');
        useHome(ctx, root);
        registerParent(parentRoot);

        loadConfig(childRoot);

        const line = readRegistry().playground;
        ctx.expect({ root: line.root, name: line.name, url: line.url }).toEqual({ root: childRoot, name: 'OMEGA Playground', url: 'https://playground.omegajs.dev' });

        // The second load changes nothing on disk: the line is a cache, not churn.
        const before = fs.readFileSync(registryFile(), 'utf8');
        loadConfig(childRoot);
        ctx.expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
      },
    },

    // ─── The resolved `company` section ───

    {
      name: 'the resolved config carries the filled company section for child, self and standalone',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-resolved-section');
        useHome(ctx, root);
        registerParent(parentRoot);

        ctx.expect(loadConfig(childRoot).config.company).toEqual({
          id: 'itw-creative-works',
          name: 'ITW Creative Works',
          url: 'https://itwcreativeworks.com',
          images: { wordmark: '/assets/images/brand/wordmark.png' },
          // The one typed key beside `id`, default true so no reader needs a fallback
          webhooks: true,
        });

        ctx.expect(loadConfig(parentRoot).config.company).toEqual({
          id: 'self',
          name: 'ITW Creative Works',
          url: 'https://itwcreativeworks.com',
          images: { wordmark: '/assets/images/brand/wordmark.png' },
          webhooks: true,
        });

        const standalone = makeFixture('company-resolved-standalone', {
          'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } }`,
        });
        ctx.after(() => fs.rmSync(standalone, { recursive: true, force: true }));

        ctx.expect(loadConfig(standalone).config.company).toEqual({
          id: null,
          name: 'Acme',
          url: 'https://acme.test',
          images: {},
          webhooks: true,
        });
      },
    },

    {
      name: 'the company CONFIG layer is the parent company tree, under the brand file',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-config-layer');
        useHome(ctx, root);
        registerParent(parentRoot);

        const { config, files } = loadConfig(childRoot);

        ctx.expect(config.monitoring.providers.sentry.org).toBe('itw');
        ctx.expect(config.probe.fromCompanyShared).toBe(true);
        ctx.expect(files.company).toBe(path.join(parentRoot, 'company', 'config', 'omega.json5'));
      },
    },

    {
      name: 'a typed company.name/url/images is refused at the authored brand file',
      run: (ctx) => {
        const root = makeFixture('company-typed', {
          'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'itw-creative-works', url: 'https://itwcreativeworks.com' }, targets: { web: { type: 'web' } } }`,
          'brand/targets/web/package.json': `{ "name": "acme-web" }`,
        });
        useHome(ctx, root);

        ctx.expect(() => loadConfig(path.join(root, 'brand', 'targets', 'web'), 'web')).toThrow(/company\.url .* is resolved from the company, delete it/);
      },
    },

    {
      name: 'a target-level compose output carries the resolved facts, and still loads',
      run: (ctx) => {
        // The local layer is exempt from the typed-company refusal on purpose: a
        // target's config/omega.json5 may be a STAGED compose, which freezes the
        // resolved company in by design (the deployed runtime has no registry).
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-frozen');
        useHome(ctx, root);
        registerParent(parentRoot);

        const { config } = composeTargetConfig(path.join(childRoot, 'targets', 'web'), 'web');
        ctx.expect(config.company.name).toBe('ITW Creative Works');

        // Uploaded: no registry, no company tree, and the frozen facts still read.
        const upload = makeFixture('company-frozen-upload', {
          'config/omega.json5': JSON.stringify(config, null, 2),
        });
        ctx.after(() => fs.rmSync(upload, { recursive: true, force: true }));
        process.env.OMEGA_HOME = path.join(upload, 'empty-home');

        ctx.expect(loadConfig(upload, 'web').config.company).toEqual({
          id: 'itw-creative-works',
          name: 'ITW Creative Works',
          url: 'https://itwcreativeworks.com',
          images: { wordmark: '/assets/images/brand/wordmark.png' },
          webhooks: true,
        });
      },
    },

    // ─── Off-laptop: the generated layer a deploy hands a runner ───

    {
      name: 'the runner reads the generated layer when the registry has no line',
      run: (ctx) => {
        const { root, childRoot } = makeCompanyFixture('company-generated');
        useHome(ctx, root);

        // No registry line: the runner has no machine map and no company tree.
        fs.writeFileSync(path.join(childRoot, COMPANY_RESOLVED_FILE), JSON.stringify({
          config: { monitoring: { providers: { sentry: { org: 'itw' } } } },
          company: { id: 'itw-creative-works', name: 'ITW Creative Works', url: 'https://itwcreativeworks.com', images: { wordmark: '/wordmark.png' } },
        }));

        const company = resolveCompany(childRoot);
        ctx.expect(company.name).toBe('ITW Creative Works');
        ctx.expect(company.root).toBe(null);
        ctx.expect(company.file('.env'), 'off-laptop nothing ever reads company/').toBe(null);

        const { config, files } = loadConfig(childRoot);
        ctx.expect(config.monitoring.providers.sentry.org).toBe('itw');
        ctx.expect(config.company.url).toBe('https://itwcreativeworks.com');
        ctx.expect(files.company).toBe(path.join(childRoot, COMPANY_RESOLVED_FILE));
      },
    },

    {
      name: 'a registry hit beats the generated layer: on the laptop the tree is the truth',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-generated-stale');
        useHome(ctx, root);
        registerParent(parentRoot);

        fs.writeFileSync(path.join(childRoot, COMPANY_RESOLVED_FILE), JSON.stringify({
          config: {},
          company: { id: 'itw-creative-works', name: 'Stale Inc', url: 'https://stale.test', images: {} },
        }));

        const company = resolveCompany(childRoot);
        ctx.expect(company.name).toBe('ITW Creative Works');
        ctx.expect(company.root).toBe(parentRoot);
      },
    },

    // ─── The retirements (#677) ───

    {
      name: 'the retired company keys fail the load like any unknown key, naming migrate',
      run: (ctx) => {
        const base = { brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } };
        const fails = (config, path) => validateConfig({ ...base, ...config }).errors
          .some((error) => error.startsWith(`config.${path} is not a key the schema declares`) && error.includes('npx omega migrate'));

        ctx.expect(fails({ brand: { ...base.brand, company: 'Acme Holdings Inc' } }, 'brand.company')).toBeTruthy();
        for (const value of ['self', false]) ctx.expect(fails({ parent: value }, 'parent'), `parent: ${value}`).toBeTruthy();
      },
    },

    {
      name: 'company.webhooks: default true, and an explicit false is carried into the resolved section',
      run: (ctx) => {
        const { root, parentRoot, childRoot } = makeCompanyFixture('company-webhooks');
        useHome(ctx, root);
        registerParent(parentRoot);

        ctx.expect(loadConfig(childRoot).config.company.webhooks, 'default').toBe(true);

        fs.writeFileSync(path.join(childRoot, 'config', 'omega.json5'), `{
    brand: { id: 'playground', name: 'OMEGA Playground', url: 'https://playground.omegajs.dev' },
    company: { id: 'itw-creative-works', webhooks: false },
    targets: { web: { type: 'web' } },
  }`);

        const resolved = loadConfig(childRoot).config.company;
        ctx.expect(resolved.webhooks, 'the brand opted its shared provider account out').toBe(false);
        ctx.expect(resolved.id, 'and the rest of the section still resolves').toBe('itw-creative-works');
      },
    },
  ],
});
