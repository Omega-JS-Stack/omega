/**
 * skill-claims tests — the omega plugin's skills are routers: they name repo
 * paths, sibling skills, packages, and CLI verbs. Every such name is a CLAIM
 * about the repo, and a claim that no longer holds sends a session to a file
 * that is not there. This checks each claim against the live tree.
 *
 * Two layers: fixture self-tests (synthetic skill text carrying a claim that
 * does NOT hold — the proof the checker can go red), then a live scan over
 * every real SKILL.md.
 *
 * Run: node --test scripts/skill-claims.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'agent-plugins', 'claude', 'skills');
const APPS_DIR = path.join(ROOT, 'apps');

// The repo-relative prefixes a skill may name. Anything else is prose.
const PATH_ROOTS = 'docs|packages|apps|scripts|agent-plugins';

const PATTERNS = {
  repoPath: new RegExp(`(?<![\\w/@.-])(?:${PATH_ROOTS})/[^\\s\`"'|]+`, 'g'),
  consumerPath: /node_modules\/@omega\.js\/[^\s`"'|]+/g,
  skillRef: /omega:[a-z0-9-]+/g,
  packageName: /@omega\.js\/[a-z0-9-]+/g,
  // CLI verbs are only read inside a code span: `omega deploy`. Bare prose
  // ("omega web", "the omega plugin") is not a command and must not be one.
  cliVerb: /`(?:npx\s+)?(?:omega|omg|mgr)\s+([a-z][a-z0-9-]*)/g,
};

// A placeholder or glob stands for a family of paths, not one file on disk.
const isPlaceholder = (token) => /[<>*{}]/.test(token);

// A path claim ends at any #anchor or glued ?/punctuation — the file on disk
// is what the claim is about, not the fragment.
const stripTrailing = (token) => token.replace(/[#?].*$/, '').replace(/[.,);:]+$/, '');

const matchAll = (source, pattern, group) => {
  const found = new Set();
  for (const match of source.matchAll(pattern)) found.add(match[group || 0]);
  return [...found];
};

// --- the claim surface: what the repo actually has ---

/**
 * Skill names the plugin ships — the directory listing IS the surface.
 *
 * @param {string} [dir] - Skills directory to read
 * @returns {string[]} Bare skill names (the plugin supplies the omega: namespace)
 */
function skillNames(dir) {
  return fs.readdirSync(dir || SKILLS_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory() && fs.existsSync(path.join(dir || SKILLS_DIR, item.name, 'SKILL.md')))
    .map((item) => item.name);
}

/**
 * Workspace packages published under the @omega.js scope, by their manifest
 * name — a directory whose package.json disagrees does not count.
 *
 * @returns {Set<string>} Full package names, e.g. `@omega.js/web`
 */
function packageNames() {
  const names = new Set();
  for (const item of fs.readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const manifest = path.join(ROOT, 'packages', item.name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const { name } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (name === `@omega.js/${item.name}`) names.add(name);
  }
  return names;
}

// Every framework CLI dispatches to a command file, so the command directories
// ARE the verb surface: the router frameworks resolve commands/<name>.js, and
// backend's if-chain instantiates one class per cli/commands/<name>.js. The
// router frameworks also carry an alias table (`i`, `serve`, `out`), read from
// the live module rather than scraped from its source.
const COMMAND_DIRS = [
  path.join(ROOT, 'packages', 'web', 'src', 'commands'),
  path.join(ROOT, 'packages', 'desktop', 'src', 'commands'),
  path.join(ROOT, 'packages', 'extension', 'src', 'commands'),
  path.join(ROOT, 'packages', 'manager', 'src', 'commands'),
  path.join(ROOT, 'packages', 'backend', 'src', 'cli', 'commands'),
];

const ROUTER_CLIS = ['web', 'desktop', 'extension', 'manager']
  .map((framework) => path.join(ROOT, 'packages', framework, 'src', 'cli.js'));

/**
 * Every verb any framework's CLI can dispatch — command names plus the
 * word-shaped entries of the alias tables.
 *
 * @returns {Set<string>} Dispatchable verbs
 */
function cliVerbs() {
  const verbs = new Set();

  for (const dir of COMMAND_DIRS) {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.js')) verbs.add(file.replace(/\.js$/, ''));
    }
  }

  for (const cli of ROUTER_CLIS) {
    const { aliases } = require(cli).config;
    for (const [name, list] of Object.entries(aliases)) {
      verbs.add(name);
      for (const alias of list) {
        if (/^[a-z][a-z0-9-]*$/.test(alias)) verbs.add(alias);
      }
    }
  }

  return verbs;
}

// --- the checker ---

/**
 * Does a repo-relative path claim hold? An `apps/<target>` token is the
 * consumer world's app layout (`apps/website`, `apps/backend`), which resolves
 * inside any brand under apps/ rather than at the repo root.
 *
 * @param {string} claimed - Repo-relative path from a skill
 * @returns {boolean} True when something on disk answers to it
 */
function pathExists(claimed) {
  if (fs.existsSync(path.join(ROOT, claimed))) return true;

  const consumerApp = claimed.match(/^apps\/(.+)$/);
  if (!consumerApp) return false;

  return fs.readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .some((brand) => fs.existsSync(path.join(APPS_DIR, brand.name, 'apps', consumerApp[1])));
}

/**
 * Check every claim one skill's text makes.
 *
 * @param {string} skill - Skill name, used in the failure message
 * @param {string} source - The whole SKILL.md, frontmatter and body
 * @param {object} surface - `{ skills, packages, verbs }` — the live repo surface
 * @returns {string[]} One message per broken claim; empty means clean
 */
function checkSkill(skill, source, surface) {
  const violations = [];
  const report = (kind, token, detail) => violations.push(`${skill}: ${kind} "${token}" ${detail}`);

  for (const raw of matchAll(source, PATTERNS.repoPath)) {
    if (isPlaceholder(raw)) continue;
    const claimed = stripTrailing(raw);
    if (!pathExists(claimed)) report('repo path', claimed, 'does not exist');
  }

  for (const raw of matchAll(source, PATTERNS.consumerPath)) {
    if (isPlaceholder(raw)) continue;
    const claimed = stripTrailing(raw).replace('node_modules/@omega.js/', 'packages/');
    if (!pathExists(claimed)) report('consumer path', stripTrailing(raw), `does not resolve to ${claimed}`);
  }

  for (const ref of matchAll(source, PATTERNS.skillRef)) {
    const name = ref.slice('omega:'.length);
    if (!surface.skills.includes(name)) report('skill reference', ref, 'names no skill the plugin ships');
  }

  for (const name of matchAll(source, PATTERNS.packageName)) {
    if (!surface.packages.has(name)) report('package', name, 'is not a package in packages/');
  }

  for (const verb of matchAll(source, PATTERNS.cliVerb, 1)) {
    if (!surface.verbs.has(verb)) report('CLI verb', verb, 'is not dispatchable by any framework CLI');
  }

  return violations;
}

const liveSurface = () => ({ skills: skillNames(), packages: packageNames(), verbs: cliVerbs() });

// --- checker self-tests: a claim that does not hold must be reported ---

const FIXTURE_SURFACE = { skills: ['web'], packages: new Set(['@omega.js/web']), verbs: new Set(['dev']) };

test('checker: a missing repo path is reported', () => {
  const found = checkSkill('fixture', 'Read `docs/web/index.md` then `docs/nope/gone.md`.', FIXTURE_SURFACE);
  assert.deepEqual(found, ['fixture: repo path "docs/nope/gone.md" does not exist']);
});

test('checker: trailing punctuation is stripped before the path is checked', () => {
  assert.deepEqual(checkSkill('fixture', 'The guide is docs/web/index.md.', FIXTURE_SURFACE), []);
});

test('checker: an #anchor or glued ? ends the path claim', () => {
  const source = 'See docs/web/index.md#components — or is it docs/web/index.md?';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), []);
});

test('checker: placeholders and globs are not paths', () => {
  const source = 'Guides live at docs/<framework>/index.md and tests at scripts/*.test.js.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), []);
});

test('checker: a consumer node_modules path is translated into packages/', () => {
  const source = 'Read `node_modules/@omega.js/web/AGENTS.md` and `node_modules/@omega.js/web/NOPE.md`.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), [
    'fixture: consumer path "node_modules/@omega.js/web/NOPE.md" does not resolve to packages/web/NOPE.md',
  ]);
});

test('checker: an unknown omega: skill is reported, other namespaces are ignored', () => {
  const source = 'Invoke `omega:web`, then `omega:ghost`, then `workkit:scout`.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), [
    'fixture: skill reference "omega:ghost" names no skill the plugin ships',
  ]);
});

test('checker: an unknown @omega.js package is reported', () => {
  const source = '`@omega.js/web` embeds `@omega.js/phantom`.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), [
    'fixture: package "@omega.js/phantom" is not a package in packages/',
  ]);
});

test('checker: an undispatchable CLI verb is reported', () => {
  const source = 'Run `omega dev`, never `npx omega vanish`.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), [
    'fixture: CLI verb "vanish" is not dispatchable by any framework CLI',
  ]);
});

test('checker: prose after the word omega is not a CLI verb', () => {
  assert.deepEqual(checkSkill('fixture', 'The omega monorepo ships the omega plugin.', FIXTURE_SURFACE), []);
});

test('checker: a clean skill reports nothing', () => {
  const source = 'Read docs/web/index.md, invoke `omega:web`, run `omega dev` on `@omega.js/web`.';
  assert.deepEqual(checkSkill('fixture', source, FIXTURE_SURFACE), []);
});

// --- the live scan ---

test('surface: the repo answers with skills, packages, and CLI verbs', () => {
  const surface = liveSurface();
  assert.ok(surface.skills.includes('main'), 'the hub skill is missing');
  assert.ok(surface.packages.has('@omega.js/web'), '@omega.js/web is missing from packages/');
  assert.ok(surface.verbs.has('deploy'), 'no framework CLI dispatches deploy');
});

test('skills: every claim in every SKILL.md holds against the live repo', () => {
  const surface = liveSurface();
  const violations = [];

  for (const skill of surface.skills) {
    const source = fs.readFileSync(path.join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
    violations.push(...checkSkill(skill, source, surface));
  }

  assert.deepEqual(violations, [], `stale skill claims:\n  ${violations.join('\n  ')}`);
});
