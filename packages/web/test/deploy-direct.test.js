/**
 * `omega deploy --direct` plan tests: the pure repo/domain derivation.
 *
 * The push target is the WEBSITE repo
 * ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)):
 * `<brand.id>-<target name>` under `repo.org`, holding the built site alone,
 * so the SOURCE monorepo (`<brand.id>-omega`, where the dispatch lane sends
 * its workflow_dispatch) can stay private. The cname comes from the target's
 * url. The build+push path is exercised live against the playground via the
 * manager's pipeline command, not here.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { buildDirectPlan, pushDist } = require('../src/commands/deploy.js');
// The Pages domain derivation is the config's ONE `pagesHost` (#883): the plan
// and the build both ask it, so this file pins WHAT the lanes do with it and
// packages/config/test/repo.test.js pins the derivation itself.
const { pagesHost } = require('@omega.js/config');

// The target NAME is the one thing a plan reads off the filesystem (the
// target's folder inside its brand), so every plan below runs from a real one.
// An empty env keeps the machine this runs on out of it.
const BRAND_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-plan-brand-')));
fs.mkdirSync(path.join(BRAND_ROOT, 'config'), { recursive: true });
fs.writeFileSync(path.join(BRAND_ROOT, 'config', 'omega.json5'), '{ brand: { id: "b", name: "B" }, targets: { web: { type: "web" }, admin: { type: "web" } } }');
for (const name of ['web', 'admin']) {
  fs.mkdirSync(path.join(BRAND_ROOT, 'targets', name), { recursive: true });
}

/** Plan options for a target of this brand: its dir names it, its env is empty. */
const inTarget = (name) => ({ env: {}, cwd: path.join(BRAND_ROOT, 'targets', name) });

const WEB = inTarget('web');
const TARGETS = { web: { type: 'web' }, admin: { type: 'web' } };

after(() => fs.rmSync(BRAND_ROOT, { recursive: true, force: true }));

// #883, the whole point: the site is pushed to a repo of its own, so nothing
// about the push depends on what the SOURCE repo is called or who may read it.
test('direct plan: the push target is the website repo `<brand.id>-<target>`, cname from the target url', () => {
  const plan = buildDirectPlan({
    repo: { provider: 'github', org: 'Org' },
    brand: { id: 'b', url: 'https://www.example.com/landing' },
    targets: TARGETS,
  }, WEB);

  assert.equal(plan.owner, 'Org');
  assert.equal(plan.name, 'b-web', 'the repo name is derived, never typed');
  assert.equal(plan.repo, 'Org/b-web');
  assert.equal(plan.pushUrl, 'https://github.com/Org/b-web.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, 'www.example.com');
});

test('direct plan: a custom-domain plan carries the domain root prefix and its CNAME, unchanged', () => {
  const plan = buildDirectPlan({
    repo: { org: 'Org' },
    brand: { id: 'b', url: 'https://www.example.com' },
    targets: TARGETS,
  }, WEB);

  assert.equal(plan.cname, 'www.example.com');
  assert.equal(plan.url, 'https://www.example.com', 'the address the deploy reports');
  assert.equal(plan.pathPrefix, '/', 'a CNAME cannot carry a path, so the build stays at the domain root');
});

test('direct plan: NO brand.url → a gh-pages PROJECT site (derived address, no CNAME, the #358 prefix)', () => {
  const plan = buildDirectPlan({
    repo: { org: 'Omega-JS-Stack' },
    brand: { id: 'omega' },
    targets: TARGETS,
  }, WEB);

  assert.equal(plan.repo, 'Omega-JS-Stack/omega-web');
  assert.equal(plan.pushUrl, 'https://github.com/Omega-JS-Stack/omega-web.git');
  assert.equal(plan.branch, 'gh-pages');
  assert.equal(plan.cname, '', 'no custom domain → no CNAME step');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-web/', 'the default project address');
  assert.equal(plan.pathPrefix, '/omega-web/', 'the build mounts everything under the project path');
});

// #366: absolute URLs (canonical, og:url, hreflang alternates, sitemap) build
// from brand.url, so a project site that leaves it unset emits wrong or empty
// canonicals on every page. Nothing is derived at build time: the deploy names
// the exact value to set.
test('direct plan: a project site with no brand.url WARNS, printing the Pages URL to set (#366)', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));

  let plan;
  let quiet;
  try {
    plan = buildDirectPlan({ repo: { org: 'Omega-JS-Stack' }, brand: { id: 'omega' }, targets: TARGETS }, WEB);
    quiet = warnings.length;
    buildDirectPlan({ repo: { org: 'Org' }, brand: { id: 'b', url: 'https://www.example.com' }, targets: TARGETS }, WEB);
  } finally {
    console.warn = originalWarn;
  }

  const warning = warnings.find((line) => line.includes('brand.url'));
  assert.ok(warning, `the project-site plan warns about the unset brand.url: ${warnings.join(' | ')}`);
  // The no-trailing-slash form: what the docs write, and what composes with
  // `{{ site.url }}{{ page.url }}` without doubling the slash.
  assert.ok(warning.includes('"https://omega-js-stack.github.io/omega-web"'), `the warning names the exact value to set: ${warning}`);
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-web/', 'the plan ADDRESS keeps its trailing slash: it is a directory, not a value to paste');
  assert.equal(warnings.length, quiet, 'a custom-domain plan has nothing to warn about');
});

// #366: the advice has to be SAFE to follow: setting brand.url to the Pages
// address must leave the plan exactly as it was, or the warning would break the
// deploy it advises.
test('direct plan: taking the advice (brand.url = the Pages address) keeps the project-site plan intact (#366)', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));

  let plan;
  try {
    plan = buildDirectPlan({
      repo: { org: 'Omega-JS-Stack' },
      brand: { id: 'omega', url: 'https://omega-js-stack.github.io/omega-web' },
      targets: TARGETS,
    }, WEB);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(plan.cname, '', 'still a project site: no CNAME claiming <owner>.github.io');
  assert.equal(plan.pathPrefix, '/omega-web/', 'still mounted under the project path: assets keep resolving');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/omega-web/', 'the same address it published to before');
  assert.deepEqual(warnings, [], 'and the warning is spent: brand.url is set now');
});

test('direct plan: a *.github.io brand.url names the mount, the repo only fills the gaps (#366)', () => {
  const plan = buildDirectPlan({
    repo: { org: 'Omega-JS-Stack' },
    brand: { id: 'omega', url: 'https://omega-js-stack.github.io/workkit/' },
    targets: TARGETS,
  }, WEB);

  assert.equal(plan.repo, 'Omega-JS-Stack/omega-web', 'the repo is still the derived one');
  assert.equal(plan.pathPrefix, '/workkit/', 'the path brand.url carries IS the base path');
  assert.equal(plan.url, 'https://omega-js-stack.github.io/workkit/', 'and the address agrees with it');
});

test('the deploy path writes a CNAME only for the domain shape, and reports the plan address', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'deploy.js'), 'utf8');

  assert.match(source, /if \(plan\.cname\) \{\s*\n\s*fs\.writeFileSync\(path\.join\(dist, 'CNAME'\), plan\.cname\);/, 'the CNAME step is skipped for a project site');
  assert.match(source, /Deployed — \$\{plan\.url\} serves/, 'the deploy reports the address it published to');
});

// #883: the FIRST deploy of a brand creates the gh-pages branch on a repo
// nothing has configured yet, so the lane that made the branch is the lane that
// points Pages at it (and at the domain). The manage walk reconciles the same
// two facts, which is why a machine without `gh` warns instead of failing.
test('the deploy path configures Pages on what it just pushed (#883)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'deploy.js'), 'utf8');

  assert.match(source, /require\('@omega\.js\/devkit\/github-repo'\)\.ensurePages\(\{/, 'through the ONE github-repo helper, never a second gh call');
  assert.match(source, /ensurePages\(\{[\s\S]{0,220}owner: plan\.owner,[\s\S]{0,220}branch: plan\.branch,[\s\S]{0,220}cname: plan\.cname/, 'with the repo, branch and domain the push used');
  assert.ok(source.indexOf('pushDist(plan') < source.indexOf('ensurePages('), 'after the push: Pages cannot be configured before the branch exists');
});

// B1/#883: the token used to ride the push URL, so it sat in the argv of a
// child process (readable machine-wide), in git's own error output, and in the
// message `execFileSync` throws (which carries the whole argv): a plaintext
// credential in any log written outside Actions' masking. It now reaches git
// through the config env of that one process and nothing else.
test('the push never carries the token in its argv, and a failure never prints it (B1)', () => {
  const plan = { pushUrl: 'https://github.com/Org/b-web.git', branch: 'gh-pages', repo: 'Org/b-web' };
  const calls = [];

  pushDist(plan, {
    cwd: '/tmp/dist',
    env: { GH_TOKEN: 'ghs_supersecret' },
    execFn: (file, args, options) => { calls.push({ file, args, options }); return ''; },
  });

  const [call] = calls;
  assert.deepEqual(call.args, ['push', '-q', '-f', 'https://github.com/Org/b-web.git', 'gh-pages'], 'the plain url, no credentials');
  assert.ok(!JSON.stringify(call.args).includes('ghs_supersecret'), 'no argv element carries the token');

  // The credential travels as git config, for this child process only.
  const header = `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghs_supersecret').toString('base64')}`;
  assert.equal(call.options.env.GIT_CONFIG_COUNT, '1');
  assert.equal(call.options.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(call.options.env.GIT_CONFIG_VALUE_0, header);

  // A failing push: git's message is rethrown scrubbed, in both the raw form
  // and the base64 the header carries.
  let thrown = null;
  try {
    pushDist(plan, {
      cwd: '/tmp/dist',
      env: { GH_TOKEN: 'ghs_supersecret' },
      execFn: () => { throw new Error(`Command failed: git push https://x-access-token:ghs_supersecret@github.com/Org/b-web.git (${header})`); },
    });
  } catch (error) {
    thrown = error;
  }

  assert.match(thrown.message, /Pushing to Org\/b-web failed/, 'the failure names the repo it was pushing to');
  assert.ok(!thrown.message.includes('ghs_supersecret'), 'the raw token is scrubbed out of the failure');
  assert.ok(!thrown.message.includes(Buffer.from('x-access-token:ghs_supersecret').toString('base64')), 'and so is its base64');
});

// No token around (a developer with neither GH_TOKEN nor `gh auth`): the push
// runs plainly and git asks for credentials itself.
test('the push adds no git config when no token resolves (B1)', () => {
  const calls = [];

  pushDist({ pushUrl: 'https://github.com/Org/b-web.git', branch: 'gh-pages', repo: 'Org/b-web' }, {
    env: {},
    token: null,
    execFn: (file, args, options) => { calls.push(options); return ''; },
  });

  assert.equal(calls[0].env.GIT_CONFIG_COUNT, undefined, 'no half-configured credential env');
  assert.equal(calls[0].env.GIT_CONFIG_VALUE_0, undefined);
});

// The OTHER CNAME writer: every production build emits dist/CNAME so both
// deploy lanes publish it. It asks the same one derivation, so a project site's
// brand.url can never make a build claim `<owner>.github.io` (#366).
test('the production build writes a CNAME only for a real custom domain, never *.github.io (#366)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'build.js'), 'utf8');

  assert.match(source, /const cname = pagesHost\(siteData, targetNameFromDir\(paths\.root\) \|\| 'web'\);\s*\n\s*if \(cname\) \{/, 'the build asks the ONE derivation whether a custom domain exists');
  assert.equal(pagesHost({ brand: { id: 'b', url: 'https://omega-js-stack.github.io/omega-brand' }, targets: { web: { type: 'web' } } }, 'web'), '', 'so a project-site url writes no CNAME at all');
});

// #883: the environment and the git remote both name the repo the checkout
// SITS IN (the source repo on a runner, the enclosing monorepo in a nested
// brand). Neither is the website repo, so neither is consulted any more: a
// config that names no org refuses, and says which key to set.
test('direct plan: a config that names no org REFUSES, and no ambient repo can stand in', () => {
  const message = (() => {
    try {
      buildDirectPlan({ brand: { id: 'b', url: 'https://x.y' }, targets: TARGETS }, { env: { GITHUB_REPOSITORY: 'Acme/site' }, cwd: WEB.cwd });
      return '';
    } catch (error) {
      return error.message;
    }
  })();

  assert.match(message, /repo\.org/, 'the one key to set is named');
  assert.match(message, /website repo/, 'and what it addresses');
  assert.doesNotMatch(message, /GITHUB_REPOSITORY|remote/, 'neither the CI environment nor a git remote is offered: both name the wrong repo');
});

test('direct plan: a target the config does not declare refuses, listing the ones it does', () => {
  assert.throws(
    () => buildDirectPlan({ repo: { org: 'Org' }, brand: { id: 'b' }, targets: { site: { type: 'web' } } }, WEB),
    /No target "web" is declared[\s\S]*site/,
  );
});

test('direct plan: a second web target pushes to ITS OWN repo, the first untouched (#588, #883)', () => {
  const config = {
    repo: { org: 'Org' },
    brand: { id: 'acme', url: 'https://acme.test' },
    targets: TARGETS,
  };

  // The resolved config's top-level `url` is THIS target's own public url; the
  // loader fills it (a bare `admin: { type: 'web' }` is admin.<brand host>).
  const admin = buildDirectPlan({ ...config, url: 'https://admin.acme.test' }, inTarget('admin'));
  assert.equal(admin.repo, 'Org/acme-admin', 'one repo per web target');
  assert.equal(admin.cname, 'admin.acme.test', 'the gh-pages CNAME names the target host');
  assert.equal(admin.url, 'https://admin.acme.test');
  assert.equal(admin.pathPrefix, '/', 'a custom domain mounts at the root');

  const main = buildDirectPlan(config, WEB);
  assert.equal(main.repo, 'Org/acme-web');
  assert.equal(main.cname, 'acme.test', 'the target named for its type is the brand host, unchanged');
});

// #588/#886 through the REAL loader: the resolved url and the target name are
// what the plan reads, so the two derivations are pinned against a real file.
test('direct plan: the composed config of a named target resolves to its own host and repo', (t) => {
  const { loadConfig } = require('@omega.js/config');

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-named-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `{
  brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
  repo: { provider: 'github', org: 'Acme-Org' },
  targets: { web: { type: 'web' }, admin: { type: 'web' } },
}`);
  for (const dir of ['web', 'admin']) {
    fs.mkdirSync(path.join(root, 'targets', dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'targets', dir, 'package.json'), '{}');
  }

  const planFor = (dir) => {
    const targetDir = path.join(root, 'targets', dir);
    const { config, errors } = loadConfig(targetDir, 'web');
    assert.deepEqual(errors, [], `${dir} config is valid`);
    return { plan: buildDirectPlan(config, { env: {}, cwd: targetDir }), config };
  };

  const admin = planFor('admin');
  assert.equal(admin.plan.repo, 'Acme-Org/acme-admin');
  assert.equal(admin.plan.cname, 'admin.acme.test');
  assert.equal(pagesHost(admin.config, 'admin'), 'admin.acme.test', "so does `omega build`'s dist/CNAME");

  const main = planFor('web');
  assert.equal(main.plan.repo, 'Acme-Org/acme-web');
  assert.equal(main.plan.cname, 'acme.test');
  assert.equal(main.plan.url, 'https://acme.test');
});


// #426: the direct lane loaded the config and dropped its validation findings
// on the floor (the old guard tested `!config`, which the loader never returns).
// A fatal finding is a refusal, not a plan: it stops the lane before the build,
// the CNAME write and the push, and it stops a DRY RUN too: a plan printed
// from a config nothing will read is a lie about what would happen.
test('deploy --direct: a fatal config finding stops the lane before any deploy work (#426)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-invalid-'));
  const previous = process.cwd();
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Everything a plan needs IS here (org + brand.id + brand.url), so the retired
  // key is the only reason to refuse.
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), `{
  brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
  repo: { provider: 'github', org: 'Org' },
  payment: { processors: { stripe: {} } },
  targets: { web: { type: 'web' } },
}`);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'acme-website', private: true }));

  process.chdir(dir);
  await assert.rejects(
    require('../src/commands/deploy.js')({ direct: true, dryRun: true }),
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors is retired/,
    'the findings surface as a thrown fatal, not a silently-ignored array',
  );
});

// #856: both deploy lanes publish a PRODUCTION site, so the config they read is
// the production one. The overlay that composes is named by the lane, never by
// the machine, which answers `development` in a terminal.
test('deploy --direct: the PRODUCTION overlay is the config the lane reads (#856)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-overlay-'));
  const previous = process.cwd();
  const saved = [['ENVIRONMENT', process.env.ENVIRONMENT], ['OMEGA_TEST_MODE', process.env.OMEGA_TEST_MODE]];
  t.after(() => {
    process.chdir(previous);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // The base is clean and the development overlay is clean, so ONLY the
  // production overlay can produce this refusal.
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config', 'omega.json5'), `{
  brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
  repo: { provider: 'github', org: 'Org' },
  targets: { web: { type: 'web' } },
}`);
  fs.writeFileSync(path.join(dir, 'config', 'omega.production.json5'), '{ payment: { processors: { stripe: {} } } }');
  fs.writeFileSync(path.join(dir, 'config', 'omega.development.json5'), "{ theme: { id: 'classy' } }");
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'acme-website', private: true }));

  delete process.env.OMEGA_TEST_MODE;
  process.env.ENVIRONMENT = 'development';
  process.chdir(dir);

  await assert.rejects(
    require('../src/commands/deploy.js')({ direct: true, dryRun: true }),
    /config\/omega\.json5 is invalid:[\s\S]*payment\.processors is retired/,
    'the production overlay is a layer of the deploy config, so its retired key refuses the lane',
  );
});
