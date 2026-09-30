/**
 * The quality hook (PostToolUse Write|Edit + Stop): an edited web surface
 * names the quality skills that own it, and Stop asks for the review.
 * Run: node --test scripts/agent-plugins-quality.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ROOT, readJson, project } = require('./agent-plugins-fixtures');

const QUALITY_HOOK = path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'quality', 'run.sh');

// One script serves both events, so every call names the event it is playing.
const quality = (payload) => spawnSync(QUALITY_HOOK, {
  input: JSON.stringify(payload),
  encoding: 'utf8',
});

const edited = (dir, relative, session) => quality({
  hook_event_name: 'PostToolUse',
  session_id: session,
  tool_input: { file_path: path.join(dir, relative) },
});

const stopped = (session, stopHookActive) => quality({
  hook_event_name: 'Stop',
  session_id: session,
  stop_hook_active: Boolean(stopHookActive),
});

const context = (result) => {
  assert.equal(result.status, 0, `hook exited ${result.status}: ${result.stderr}`);
  if (!result.stdout) return '';
  return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
};

let qualitySessions = 0;
const qualitySession = () => `quality-${process.pid}-${Date.now()}-${++qualitySessions}`;

test('quality: each web surface asks for the skills that own it', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const table = [
    ['src/pages/index.html', ['omega:seo', 'omega:accessibility']],
    ['src/pages/blog/post.md', ['omega:seo', 'omega:accessibility']],
    ['core/_layouts/blueprint/index.html', ['omega:seo', 'omega:accessibility']],
    ['core/_includes/core/head.html', ['omega:seo', 'omega:accessibility']],
    ['themes/classy/_includes/frontend/sections/nav.html', ['omega:accessibility']],
    ['src/assets/css/main.scss', ['omega:accessibility', 'omega:brandcheck']],
    ['config/omega.json5', ['omega:brandcheck']],
  ];

  for (const [file, skills] of table) {
    const ctx = context(edited(dir, file, qualitySession()));
    for (const skill of skills) {
      assert.match(ctx, new RegExp(skill), `${file} did not ask for ${skill}`);
    }
    assert.match(ctx, new RegExp(file.replace(/[/.]/g, '\\$&')), `${file} is not named in the reminder`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a non-web file is silent', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  for (const quiet of ['src/lib/helper.js', 'README.md', 'test/build/x.test.js']) {
    assert.equal(edited(dir, quiet, qualitySession()).stdout, '', `${quiet} was not silent`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: projects without @omega.js deps are never policed', () => {
  const dir = project({ name: 'somebody-else', dependencies: { react: '^19.0.0' } });
  assert.equal(edited(dir, 'src/pages/index.html', qualitySession()).stdout, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a skill is named once per session, and the Stop pass still counts every file', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  assert.match(context(edited(dir, 'src/pages/index.html', session)), /omega:seo/);
  assert.equal(edited(dir, 'src/pages/about.html', session).stdout, '', 'the second page re-asked');

  const ctx = context(stopped(session));
  assert.match(ctx, /2 web surface\(s\)/);
  assert.match(ctx, /index\.html/);
  assert.match(ctx, /about\.html/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: Stop blocks once on edited surfaces, then lets the sign-off through', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  edited(dir, 'src/assets/css/main.scss', session);

  const blocked = JSON.parse(stopped(session).stdout);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /omega:quality/);
  assert.match(blocked.hookSpecificOutput.additionalContext, /omega:accessibility, omega:brandcheck/);

  assert.equal(stopped(session).stdout, '', 'the block repeated with nothing new edited');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: a path with a space survives the Stop pass whole', () => {
  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  const file = 'src/pages/case studies.html';
  assert.match(context(edited(dir, file, session)), /omega:seo/);

  const ctx = context(stopped(session));
  assert.match(ctx, /case studies\.html/, 'the path was truncated at the space');
  // The skills line is parsed off the same record — a split path would land a
  // path fragment where a skill name belongs.
  const line = ctx.split('\n').find((l) => l.startsWith('Before signing off'));
  const listed = line.match(/checklists in: (.*?)\./)[1].split(', ');
  assert.deepEqual(listed, ['omega:accessibility', 'omega:seo']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: Stop is silent with no web edit, and while a block is already active', () => {
  const clean = qualitySession();
  assert.equal(stopped(clean).stdout, '');

  const dir = project({ name: 'a-brand', dependencies: { '@omega.js/web': '^1.0.0' } });
  const session = qualitySession();
  edited(dir, 'src/pages/index.html', session);
  assert.equal(stopped(session, true).stdout, '', 'blocked again inside its own block');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quality: hooks.json wires the same script on PostToolUse Write|Edit and Stop', () => {
  const hooks = readJson(path.join(ROOT, 'agent-plugins', 'claude', 'hooks', 'hooks.json')).hooks;
  const post = hooks.PostToolUse.find((h) => h.matcher === 'Write|Edit');
  assert.ok(post, 'no PostToolUse Write|Edit entry');
  assert.match(post.hooks[0].command, /hooks\/quality\/run\.sh/);
  assert.match(hooks.Stop[0].hooks[0].command, /hooks\/quality\/run\.sh/);
});
