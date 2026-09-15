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
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

// ─── The resolver ───

test('registry hit: the parent on this machine fills the company facts and the tree', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-hit');
  useHome(t, root);
  registerParent(parentRoot);

  const company = resolveCompany(childRoot);

  assert.strictEqual(company.id, 'itw-creative-works');
  assert.strictEqual(company.name, 'ITW Creative Works');
  assert.strictEqual(company.url, 'https://itwcreativeworks.com');
  assert.deepStrictEqual(company.images, { wordmark: '/assets/images/brand/wordmark.png' });
  assert.strictEqual(company.root, parentRoot);
  assert.strictEqual(company.dir, path.join(parentRoot, 'company'));
});

test('file(): the ONE inheritance rule, a company path per relative path', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-file');
  useHome(t, root);
  registerParent(parentRoot);

  const company = resolveCompany(childRoot);

  // Present in the parent's company/ and absent from the child: it resolves.
  assert.strictEqual(company.file('.env'), path.join(parentRoot, 'company', '.env'));
  assert.strictEqual(
    company.file(path.join('config', 'hooks', 'account', 'password.js')),
    path.join(parentRoot, 'company', 'config', 'hooks', 'account', 'password.js'),
  );

  // A kind of file the company simply does not carry resolves to nothing, and
  // needs no code of its own to say so.
  assert.strictEqual(company.file(path.join('.omega', 'certificates', 'apple', 'certificates', 'DEVELOPER_ID_APPLICATION_G2.p12')), null);
});

test("company.id 'self': the company brand resolves to its own tree and facts", (t) => {
  const { root, parentRoot } = makeCompanyFixture('company-self');
  useHome(t, root);

  const company = resolveCompany(parentRoot);

  assert.strictEqual(company.id, 'self');
  assert.strictEqual(company.name, 'ITW Creative Works');
  assert.strictEqual(company.url, 'https://itwcreativeworks.com');
  assert.strictEqual(company.root, parentRoot);
  assert.strictEqual(company.file('.env'), path.join(parentRoot, 'company', '.env'));
});

test('no company key: the brand IS the entity, so its own facts fill the shape', (t) => {
  const root = makeFixture('company-absent', {
    'brand/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } }`,
  });
  useHome(t, root);

  const company = resolveCompany(path.join(root, 'brand'));

  assert.deepStrictEqual(
    { id: company.id, name: company.name, url: company.url, images: company.images, root: company.root },
    { id: null, name: 'Acme', url: 'https://acme.test', images: {}, root: null },
  );
  assert.strictEqual(company.file('.env'), null);
});

test('a company that is not on this machine: inheritance off, ONE warning per process', (t) => {
  const root = makeFixture('company-miss', {
    'brand/config/omega.json5': `{ brand: { id: 'acme', name: 'Acme' }, company: { id: 'ghost-co' } }`,
  });
  useHome(t, root);

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (line) => warnings.push(line);
  t.after(() => { console.warn = realWarn; });

  const brandRoot = path.join(root, 'brand');
  const first = resolveCompany(brandRoot);
  const second = resolveCompany(brandRoot);

  assert.strictEqual(first.id, 'ghost-co');
  assert.strictEqual(first.name, null);
  assert.strictEqual(first.url, null);
  assert.strictEqual(first.root, null);
  assert.strictEqual(first.file('.env'), null);
  assert.strictEqual(second.root, null);

  assert.deepStrictEqual(warnings, ['Company ghost-co is not on this machine: inheritance off. Clone it and run any omega verb inside it once.']);
});

// ─── The machine registry ───

test('recordBrand: writes a line, and writes nothing the second time', (t) => {
  const root = makeFixture('company-registry', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
  });
  useHome(t, root);

  const brandRoot = path.join(root, 'brand');
  assert.strictEqual(recordBrand({ id: 'acme', root: brandRoot, name: 'Acme', url: 'https://acme.test' }), true);
  assert.strictEqual(recordBrand({ id: 'acme', root: brandRoot, name: 'Acme', url: 'https://acme.test' }), false);

  assert.deepStrictEqual(Object.keys(readRegistry()), ['acme']);
  assert.strictEqual(readRegistry().acme.root, brandRoot);

  // A moved brand refreshes its own line.
  fs.mkdirSync(path.join(root, 'moved'), { recursive: true });
  assert.strictEqual(recordBrand({ id: 'acme', root: path.join(root, 'moved'), name: 'Acme', url: 'https://acme.test' }), true);
  assert.strictEqual(readRegistry().acme.root, path.join(root, 'moved'));
});

test('recordBrand: a line whose root is gone is pruned on the next write', (t) => {
  const root = makeFixture('company-registry-prune', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' } }`,
  });
  useHome(t, root);

  recordBrand({ id: 'ghost', root: path.join(root, 'deleted-brand') });
  recordBrand({ id: 'acme', root: path.join(root, 'brand') });

  assert.deepStrictEqual(Object.keys(readRegistry()), ['acme'], 'the registry maps what is on this machine now');
});

test('loadConfig writes the brand its own registry line, idempotently', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-registry-load');
  useHome(t, root);
  registerParent(parentRoot);

  loadConfig(childRoot);

  const line = readRegistry().playground;
  assert.deepStrictEqual(
    { root: line.root, name: line.name, url: line.url },
    { root: childRoot, name: 'OMEGA Playground', url: 'https://playground.omegajs.dev' },
  );

  // The second load changes nothing on disk: the line is a cache, not churn.
  const before = fs.readFileSync(registryFile(), 'utf8');
  loadConfig(childRoot);
  assert.strictEqual(fs.readFileSync(registryFile(), 'utf8'), before);
});

// ─── The resolved `company` section ───

test('the resolved config carries the filled company section for child, self and standalone', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-resolved-section');
  useHome(t, root);
  registerParent(parentRoot);

  assert.deepStrictEqual(loadConfig(childRoot).config.company, {
    id: 'itw-creative-works',
    name: 'ITW Creative Works',
    url: 'https://itwcreativeworks.com',
    images: { wordmark: '/assets/images/brand/wordmark.png' },
    // The one typed key beside `id`, default true so no reader needs a fallback
    webhooks: true,
  });

  assert.deepStrictEqual(loadConfig(parentRoot).config.company, {
    id: 'self',
    name: 'ITW Creative Works',
    url: 'https://itwcreativeworks.com',
    images: { wordmark: '/assets/images/brand/wordmark.png' },
    webhooks: true,
  });

  const standalone = makeFixture('company-resolved-standalone', {
    'config/omega.json5': `{ brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } }`,
  });
  t.after(() => fs.rmSync(standalone, { recursive: true, force: true }));

  assert.deepStrictEqual(loadConfig(standalone).config.company, {
    id: null,
    name: 'Acme',
    url: 'https://acme.test',
    images: {},
    webhooks: true,
  });
});

test('the company CONFIG layer is the parent company tree, under the brand file', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-config-layer');
  useHome(t, root);
  registerParent(parentRoot);

  const { config, files } = loadConfig(childRoot);

  assert.strictEqual(config.monitoring.providers.sentry.org, 'itw');
  assert.strictEqual(config.probe.fromCompanyShared, true);
  assert.strictEqual(files.company, path.join(parentRoot, 'company', 'config', 'omega.json5'));
});

test('a typed company.name/url/images is refused at the authored brand file', (t) => {
  const root = makeFixture('company-typed', {
    'brand/config/omega.json5': `{ brand: { id: 'acme' }, company: { id: 'itw-creative-works', url: 'https://itwcreativeworks.com' }, targets: { web: { type: 'web' } } }`,
    'brand/targets/web/package.json': `{ "name": "acme-web" }`,
  });
  useHome(t, root);

  assert.throws(
    () => loadConfig(path.join(root, 'brand', 'targets', 'web'), 'web'),
    /company\.url .* is resolved from the company, delete it/,
  );
});

test('a target-level compose output carries the resolved facts, and still loads', (t) => {
  // The local layer is exempt from the typed-company refusal on purpose: a
  // target's config/omega.json5 may be a STAGED compose, which freezes the
  // resolved company in by design (the deployed runtime has no registry).
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-frozen');
  useHome(t, root);
  registerParent(parentRoot);

  const { config } = composeTargetConfig(path.join(childRoot, 'targets', 'web'), 'web');
  assert.strictEqual(config.company.name, 'ITW Creative Works');

  // Uploaded: no registry, no company tree, and the frozen facts still read.
  const upload = makeFixture('company-frozen-upload', {
    'config/omega.json5': JSON.stringify(config, null, 2),
  });
  t.after(() => fs.rmSync(upload, { recursive: true, force: true }));
  process.env.OMEGA_HOME = path.join(upload, 'empty-home');

  assert.deepStrictEqual(loadConfig(upload, 'web').config.company, {
    id: 'itw-creative-works',
    name: 'ITW Creative Works',
    url: 'https://itwcreativeworks.com',
    images: { wordmark: '/assets/images/brand/wordmark.png' },
    webhooks: true,
  });
});

// ─── Off-laptop: the generated layer a deploy hands a runner ───

test('the runner reads the generated layer when the registry has no line', (t) => {
  const { root, childRoot } = makeCompanyFixture('company-generated');
  useHome(t, root);

  // No registry line: the runner has no machine map and no company tree.
  fs.writeFileSync(path.join(childRoot, COMPANY_RESOLVED_FILE), JSON.stringify({
    config: { monitoring: { providers: { sentry: { org: 'itw' } } } },
    company: { id: 'itw-creative-works', name: 'ITW Creative Works', url: 'https://itwcreativeworks.com', images: { wordmark: '/wordmark.png' } },
  }));

  const company = resolveCompany(childRoot);
  assert.strictEqual(company.name, 'ITW Creative Works');
  assert.strictEqual(company.root, null);
  assert.strictEqual(company.file('.env'), null, 'off-laptop nothing ever reads company/');

  const { config, files } = loadConfig(childRoot);
  assert.strictEqual(config.monitoring.providers.sentry.org, 'itw');
  assert.strictEqual(config.company.url, 'https://itwcreativeworks.com');
  assert.strictEqual(files.company, path.join(childRoot, COMPANY_RESOLVED_FILE));
});

test('a registry hit beats the generated layer: on the laptop the tree is the truth', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-generated-stale');
  useHome(t, root);
  registerParent(parentRoot);

  fs.writeFileSync(path.join(childRoot, COMPANY_RESOLVED_FILE), JSON.stringify({
    config: {},
    company: { id: 'itw-creative-works', name: 'Stale Inc', url: 'https://stale.test', images: {} },
  }));

  const company = resolveCompany(childRoot);
  assert.strictEqual(company.name, 'ITW Creative Works');
  assert.strictEqual(company.root, parentRoot);
});

// ─── The retirements (#677) ───

test('the retired company keys fail loudly, each naming its new home', () => {
  const base = { brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' } };

  const named = validateConfig({ ...base, brand: { ...base.brand, company: 'Acme Holdings Inc' } }).errors;
  assert.ok(named.some((error) => error.includes('config.brand.company is retired') && error.includes('company.name')), named.join('\n'));

  const wordmark = validateConfig({ ...base, brand: { ...base.brand, images: { companyWordmark: '/wordmark.png' } } }).errors;
  assert.ok(wordmark.some((error) => error.includes('config.brand.images.companyWordmark is retired') && error.includes('company.images.wordmark')), wordmark.join('\n'));

  // `parent` is retired OUTRIGHT (#677), its last meaning named where it went
  for (const value of ['self', false]) {
    const errors = validateConfig({ ...base, parent: value }).errors;
    assert.ok(errors.some((error) => error.includes('config.parent is retired') && error.includes('company.webhooks')), errors.join('\n'));
  }
});

test('company.webhooks: default true, and an explicit false is carried into the resolved section', (t) => {
  const { root, parentRoot, childRoot } = makeCompanyFixture('company-webhooks');
  useHome(t, root);
  registerParent(parentRoot);

  assert.strictEqual(loadConfig(childRoot).config.company.webhooks, true, 'default');

  fs.writeFileSync(path.join(childRoot, 'config', 'omega.json5'), `{
    brand: { id: 'playground', name: 'OMEGA Playground', url: 'https://playground.omegajs.dev' },
    company: { id: 'itw-creative-works', webhooks: false },
    targets: { web: { type: 'web' } },
  }`);

  const resolved = loadConfig(childRoot).config.company;
  assert.strictEqual(resolved.webhooks, false, 'the brand opted its shared provider account out');
  assert.strictEqual(resolved.id, 'itw-creative-works', 'and the rest of the section still resolves');
});
