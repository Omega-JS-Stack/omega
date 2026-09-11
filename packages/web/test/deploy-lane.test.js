/**
 * `omega deploy` takes ONE lane, and a LINKED brand no longer takes a
 * different one ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * The mirrored rule (2026-07-20) had every verb auto-switch to its local
 * artifact lane the moment the brand tree carried a `file:` @omega.js spec, so
 * the brands that most needed CI (the linked ones, the nested ones) were the
 * only ones that never reached it. The lane is the executor's now: a linked or
 * nested brand PACKS its local frameworks and pushes a snapshot, and CI builds
 * from that. `--direct` is how a human asks for the local lane instead.
 *
 * Offline by construction: a dry run builds the plan and sends nothing, so no
 * lane step runs at all (the temp brand's repo has no remote to push to either).
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');

const deploy = require('../src/commands/deploy.js');

/** A brand root with a website target whose framework dep is LINKED. */
function linkedBrand() {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-lane-')));
  const target = path.join(brandRoot, 'targets', 'website');

  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'fixture', name: 'Fixture Brand', url: 'https://fixture.test' },
    repo: { providers: { github: { org: 'Fixture-Org', repo: 'Fixture-Org/fixture-omega' } } },
    targets: { web: {} },
  }));
  fs.writeFileSync(path.join(brandRoot, 'package.json'), JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2));

  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'fixture-website',
    version: '1.0.0',
    private: true,
    devDependencies: { '@omega.js/web': 'file:../../../../packages/web' },
  }, null, 2));

  // A real (empty) repo: a linked brand SNAPSHOTS, and a snapshot is built out
  // of a git index, so the lane refuses a tree with no repo by name
  // ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)). Nothing here
  // ever pushes: a dry run resolves the lane and stops.
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: brandRoot });

  return { brandRoot, target };
}

/** Run the verb in a target dir with console output captured. */
async function runDeploy(dir, options) {
  const lines = [];
  const originalLog = console.log;
  const previous = process.cwd();

  console.log = (...args) => lines.push(args.map(String).join(' '));
  process.chdir(dir);

  try {
    await deploy(options);
    return lines.join('\n');
  } finally {
    process.chdir(previous);
    console.log = originalLog;
  }
}

test('#872: a LINKED brand dispatches CI; the auto-switch to the direct lane is gone', async () => {
  const { brandRoot, target } = linkedBrand();

  try {
    const output = await runDeploy(target, { dryRun: true });

    assert.match(output, /would send:/, 'the plan is a workflow_dispatch, not a local build');
    assert.match(output, /\(snapshot lane, ref omega-deploy\)/, 'a linked brand that owns its repo snapshots to its own branch');
    assert.match(output, /actions\/workflows\/website-build\.yml\/dispatches/, 'the composed workflow name (#265) is what a brand dispatches');
    assert.ok(!output.includes('direct deploy would'), 'a linked tree no longer switches itself to the direct lane');
    assert.ok(!output.includes('Linked local packages detected'), 'and no longer announces that it did');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('#872: --direct is how a human asks for the local lane', async () => {
  const { brandRoot, target } = linkedBrand();

  try {
    const output = await runDeploy(target, { dryRun: true, direct: true });

    assert.match(output, /direct deploy would/, 'the direct plan is printed on request');
    assert.match(output, /gh-pages/, 'and it is the gh-pages push, built here');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
