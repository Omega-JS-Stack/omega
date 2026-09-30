/**
 * The inject hook: a project's framework dependencies, and a brand's declared
 * targets, ask the session for the matching omega skills.
 * Run: node --test scripts/agent-plugins-inject.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { project, inject, brand, doneWhenBrand } = require('./agent-plugins-fixtures');

test('inject: every framework dependency asks for its skill', () => {
  const table = {
    '@omega.js/web': 'omega:web',
    '@omega.js/backend': 'omega:backend',
    '@omega.js/desktop': 'omega:desktop',
    '@omega.js/extension': 'omega:extension',
    '@omega.js/manager': 'omega:manager',
  };

  for (const [pkg, skill] of Object.entries(table)) {
    const dir = project({ name: 'a-brand', dependencies: { [pkg]: '^1.0.0' } });
    const out = inject(dir);
    assert.match(out, new RegExp(skill), `${pkg} did not inject ${skill}`);
    assert.equal(JSON.parse(out).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('inject: a devDependency counts too', () => {
  const dir = project({ name: 'a-brand', devDependencies: { '@omega.js/backend': '^1.0.0' } });
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: depending on @omega.js/client is silent — the runtime is embedded everywhere', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/client': '^1.0.0' } });
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: being @omega.js/client asks for omega:client', () => {
  const dir = project({ name: '@omega.js/client', version: '1.0.0' });
  assert.match(inject(dir), /omega:client/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: being a framework package asks for its own skill', () => {
  const dir = project({ name: '@omega.js/web', version: '1.0.0' });
  assert.match(inject(dir), /omega:web/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: the monorepo root asks for omega:main', () => {
  const dir = project({ name: 'omega', version: '1.0.0' });
  assert.match(inject(dir), /omega:main/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a backend target with @omega.js/backend only in functions/ still matches', () => {
  const dir = project({ name: 'a-brand', version: '1.0.0' });
  fs.mkdirSync(path.join(dir, 'functions'));
  fs.writeFileSync(
    path.join(dir, 'functions', 'package.json'),
    JSON.stringify({ name: 'a-brand-functions', dependencies: { '@omega.js/backend': '^1.0.0' } }),
  );
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: two frameworks ask for both skills in one message', () => {
  const dir = project({
    name: 'a-brand',
    dependencies: { '@omega.js/web': '^1.0.0', '@omega.js/desktop': '^1.0.0' },
  });
  const out = inject(dir);
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext;
  assert.match(ctx, /invoke these skills/);
  assert.match(ctx, /omega:desktop, omega:web/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: no package.json is silent', () => {
  const dir = project(null);
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: malformed package.json is silent', () => {
  const dir = project('{ this is not json');
  assert.equal(inject(dir), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: the same session is asked once', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/desktop': '^1.0.0' } });
  const session = `repeat-${Date.now()}-${Math.random()}`;
  assert.match(inject(dir, session), /omega:desktop/);
  assert.equal(inject(dir, session), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the inject hook: brand-level discovery ---

test('inject: a brand root asks for main, manager, and one skill per target', () => {
  const dir = doneWhenBrand();
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  for (const skill of ['omega:main', 'omega:manager', 'omega:web', 'omega:backend']) {
    assert.match(ctx, new RegExp(skill), `the brand root did not ask for ${skill}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a brand injection names the framework map as required reading', () => {
  const dir = doneWhenBrand();
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /node_modules\/@omega\.js\/manager\/AGENTS\.md/);
  assert.match(ctx, /before/i, 'the pointer is required reading BEFORE the first edit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target directory the config never names still asks for its skill', () => {
  const dir = brand({
    config: "{\n  targets: {\n    web: { type: 'web' },\n  },\n}\n",
    targets: { app: { name: 'a-brand-app', devDependencies: { '@omega.js/desktop': '^1.0.0' } } },
  });
  assert.match(inject(dir), /omega:desktop/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target declared in config with no directory yet still asks for its skill', () => {
  const dir = brand({ config: "{\n  targets: {\n    extension: { type: 'extension' },\n  },\n}\n" });
  assert.match(inject(dir), /omega:extension/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The KEY is a NAME, so the entry's `type` is the only thing that can
// say which framework runs there: a brand that calls its extension `addon`
// asks for omega:extension exactly like one that calls it `extension`.
test('inject: a target the brand NAMED itself asks by its declared type (#886)', () => {
  const dir = brand({ config: "{\n  targets: {\n    addon: { type: 'extension' },\n    storefront: { type: 'web' },\n  },\n}\n" });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:extension/);
  assert.match(ctx, /omega:web/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a backend target with its framework only in functions/ still matches', () => {
  const dir = brand({ config: '{}', targets: { backend: { name: 'a-brand-backend' } } });
  fs.mkdirSync(path.join(dir, 'targets', 'backend', 'functions'));
  fs.writeFileSync(
    path.join(dir, 'targets', 'backend', 'functions', 'package.json'),
    JSON.stringify({ name: 'fns', dependencies: { '@omega.js/backend': '^1.0.0' } }),
  );
  assert.match(inject(dir), /omega:backend/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a custom target maps to nothing', () => {
  const dir = brand({
    config: "{\n  targets: {\n    api: { type: 'custom' },\n  },\n}\n",
    targets: { api: { name: 'a-brand-api', dependencies: { express: '^4.0.0' } } },
  });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:manager/);
  for (const skill of ['omega:web', 'omega:backend', 'omega:desktop', 'omega:extension']) {
    assert.doesNotMatch(ctx, new RegExp(skill), `the custom target asked for ${skill}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: an unreadable config still yields the brand set from the manifests', () => {
  const dir = brand({ config: '{ this is not json5 at all', targets: { web: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:web/);
  assert.match(ctx, /omega:main/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a target that appears mid-session re-triggers its own line only', () => {
  const dir = brand({ config: '{}', targets: { web: { name: 'w', dependencies: { '@omega.js/web': '^1.0.0' } } } });
  const session = `grow-${process.pid}-${Date.now()}`;
  assert.match(inject(dir, session), /omega:web/);

  fs.mkdirSync(path.join(dir, 'targets', 'app'));
  fs.writeFileSync(
    path.join(dir, 'targets', 'app', 'package.json'),
    JSON.stringify({ name: 'a', dependencies: { '@omega.js/desktop': '^1.0.0' } }),
  );

  const ctx = JSON.parse(inject(dir, session)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /omega:desktop/, 'the new target never asked for its skill');
  assert.doesNotMatch(ctx, /omega:web/, 'the already-asked skill was asked again');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inject: a plain project is still not a brand', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const ctx = JSON.parse(inject(dir)).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /omega:main/);
  assert.doesNotMatch(ctx, /AGENTS\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});
