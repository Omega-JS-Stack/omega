/**
 * The build manifest (#13) — `writeBuildMeta` emits /build.json + /build.js on
 * every build. /build.json is what the /status page's "Build manifest" card
 * reads, and what @omega.js/client's version check polls, so every field the
 * page shows is pinned here: what the site is, what it is made of, what skin
 * it wears, where it lives, and which commit it came from.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const { writeBuildMeta } = require('../src/service-worker.js');

const PKG = path.resolve(__dirname, '..');
const CLIENT_ENTRY = path.join(PKG, '..', 'client', 'src', 'index.js');

const SITE_DATA = {
  brand: { id: 'contract', name: 'Contract' },
  theme: { id: 'newsflash' },
  github: { org: 'Omega-JS-Stack' },
  cloud: { config: { projectId: 'demo-contract' } },
};

/** Build the meta into a throwaway dir and read the emitted /build.json back. */
function emit(overrides = {}) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-build-meta-'));
  const returned = writeBuildMeta({
    siteData: SITE_DATA,
    outDir,
    environment: 'production',
    version: '2.4.0',
    clientEntry: CLIENT_ENTRY,
    consumerDir: PKG,
    manifest: { js: { main: '/assets/js/main-A.js' }, css: { main: '/assets/css/main-b.css' } },
    ...overrides,
  });

  return { returned, outDir, json: JSON.parse(fs.readFileSync(path.join(outDir, 'build.json'), 'utf8')) };
}

test('the manifest carries the whole build story, and /build.json IS what it returned', () => {
  const { returned, json } = emit();

  assert.deepEqual(json, returned, 'the page reads exactly what the builder computed');
  assert.equal(json.brand, 'contract');
  assert.equal(json.name, 'Contract');
  assert.equal(json.environment, 'production');
  assert.equal(json.version, '2.4.0');
  assert.equal(json.theme, 'newsflash', 'which skin the site was built in');
  assert.deepEqual(json.assets, { js: '/assets/js/main-A.js', css: '/assets/css/main-b.css' });
  assert.deepEqual(json.firebase, { projectId: 'demo-contract' });
  assert.match(json.timestamp, /^\d{4}-\d{2}-\d{2}T/, 'the key the client version check reads');
  assert.equal(json.buildTime, json.timestamp);
  assert.equal(typeof json.cacheBreaker, 'number');
});

test('packages: the frameworks the site is actually made of, read from their manifests', () => {
  const { json } = emit();
  const web = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  const client = JSON.parse(fs.readFileSync(path.join(PKG, '..', 'client', 'package.json'), 'utf8'));

  assert.equal(json.packages['@omega.js/web'], web.version, 'the framework reports its OWN version, never a hardcoded one');
  assert.equal(json.packages['@omega.js/client'], client.version);
  assert.match(json.packages.firebase, /^\d+\.\d+\.\d+/, 'the firebase the SW and the page agree on');
  assert.equal(json.packages.node, process.version.replace(/^v/, ''), 'which node built it');
});

test('packages: an unresolvable client still leaves a usable manifest', () => {
  const { json } = emit({ clientEntry: path.join(os.tmpdir(), 'nowhere', 'index.js') });

  assert.equal(json.packages['@omega.js/client'], undefined, 'nothing invented for a package that is not there');
  assert.match(json.packages.firebase, /^\d+\.\d+\.\d+/, 'the pinned fallback keeps page and worker in step');
});

test('repo: derived through @omega.js/config, the one repo derivation', () => {
  assert.deepEqual(emit().json.repo, { user: 'Omega-JS-Stack', name: 'contract' }, 'owner from github.org, name from brand.id');
  assert.deepEqual(
    emit({ siteData: { ...SITE_DATA, github: { repo: 'itw-creative-works/omega-brand' } } }).json.repo,
    { user: 'itw-creative-works', name: 'omega-brand' },
    'an owner/name slug wins over both defaults',
  );
  assert.equal(emit({ siteData: { brand: { id: 'contract' } } }).json.repo, null, 'no owner, no repo link — never half a URL');
});

test('commit: the sha when the consumer is a repo, null when it is not', () => {
  const expected = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: PKG, encoding: 'utf8' }).trim();
  assert.equal(emit().json.commit, expected, 'the commit the site was built from');

  // A tarball install, a CI checkout with no .git, a brand that never ran
  // `git init` — all EXPECTED, so the manifest says null and the build lives.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-no-git-'));
  assert.equal(emit({ consumerDir: bare }).json.commit, null);
  assert.equal(emit({ consumerDir: undefined }).json.commit, null);
});

test('/build.js carries the SAME meta for the service worker (importScripts cannot read JSON)', () => {
  const { outDir, json } = emit();
  const jsonp = fs.readFileSync(path.join(outDir, 'build.js'), 'utf8');

  assert.ok(jsonp.startsWith('self.OMEGA_BUILD_JSON = '), 'the SW transport shape');
  assert.deepEqual(JSON.parse(jsonp.replace('self.OMEGA_BUILD_JSON = ', '').replace(/;\n$/, '')), json);
});

test('the status page reads every manifest field the builder emits', () => {
  const page = fs.readFileSync(path.join(PKG, 'core', 'js', 'pages', 'status', 'index.js'), 'utf8');
  const layout = fs.readFileSync(path.join(PKG, 'themes', 'classy', '_layouts', 'frontend', 'pages', 'status.html'), 'utf8');

  for (const [field, slot] of [
    ['timestamp', 'build-time'],
    ['environment', 'build-environment'],
    ['version', 'build-version'],
    ['theme', 'build-theme'],
    ['packages', 'build-packages'],
    ['repo', 'build-repo'],
    ['commit', 'build-commit'],
  ]) {
    assert.match(page, new RegExp(`data\\.${field}\\b`), `the page JS reads ${field}`);
    assert.match(page, new RegExp(`'#${slot}'`), `the page JS names the #${slot} slot`);
    assert.ok(layout.includes(`id="${slot}"`), `the layout carries the #${slot} slot`);
  }
});
