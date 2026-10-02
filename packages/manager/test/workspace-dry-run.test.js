// `--dry-run` on the workspace service writes NOTHING: the sandbox brand,
// copied to a temp dir and staged so every writing op has work to plan, hashes
// identically before and after the walk. Real files, the real runner.

require('@omega.js/devkit/test/temp-home');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { runService } = require('../src/manage.js');
const { loadBrand } = require('../src/lib/brand.js');
const { createMachine } = require('./lib/fake-claude.js');

const SANDBOX = path.join(__dirname, '..', '..', '..', 'brands', 'sandbox-brand');

/**
 * The sandbox's tracked shape the workspace service reads (never its .env or
 * key files), plus a manager install and the retired scope link so the agents
 * op has work, and the drift the other writing ops heal. The brand has no
 * .claude/ at all, so the Claude settings have work too.
 */
function stageBrand() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workspace-dry-run-'));

  for (const item of ['config/omega.json5', 'package.json', '.github']) {
    jetpack.copy(path.join(SANDBOX, item), path.join(root, item));
  }
  for (const name of ['web', 'backend']) {
    jetpack.copy(path.join(SANDBOX, 'targets', name, 'package.json'), path.join(root, 'targets', name, 'package.json'));
  }
  jetpack.copy(path.join(SANDBOX, 'targets', 'backend', 'config'), path.join(root, 'targets', 'backend', 'config'));

  jetpack.write(path.join(root, 'node_modules', '@omega.js', 'manager', 'package.json'), { name: '@omega.js/manager', version: '1.0.0' });
  // The retired scope link, so the agents op has a removal to plan.
  fs.symlinkSync(path.join(root, 'nowhere.md'), path.join(root, 'node_modules', '@omega.js', 'AGENTS.md'));

  jetpack.write(path.join(root, '.gitignore'), 'node_modules/\n');
  jetpack.write(path.join(root, '.env'), 'ZZZ_BRAND_OWN="z"\nANTHROPIC_API_KEY=""\n');

  return root;
}

/** Every path under root with its content hash (a symlink by its target). */
function treeHash(root) {
  const entries = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      const rel = path.relative(root, full);
      if (stat.isSymbolicLink()) {
        entries.push(`${rel} -> ${fs.readlinkSync(full)}`);
      } else if (stat.isDirectory()) {
        entries.push(`${rel}/`);
        walk(full);
      } else {
        entries.push(`${rel} ${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      }
    }
  };
  walk(root);

  return entries;
}

test('#971: a dry-run workspace walk plans every write and leaves the brand tree byte-identical', async (t) => {
  // A machine whose plugin is behind: a real walk would update it, a dry run changes nothing
  const machine = createMachine({
    marketplaces: { omega: { source: 'github', repo: 'Omega-JS-Stack/omega' } },
    installed: { 'omega@omega': '0.0.1' },
  });
  t.after(machine.activate());
  const root = stageBrand();
  const before = treeHash(root);

  const result = await runService('workspace', loadBrand(root), { dryRun: true });

  assert.deepEqual(treeHash(root), before);
  assert.deepEqual(machine.mutations(), [], 'the machine is never changed by a dry run');
  assert.notEqual(result.status, 'error', `the walk reached every op: ${result.error}`);

  // Each op had real work, so an identical tree means it was skipped
  const { output } = result;
  assert.ok(output.defaults.planned.length > 0);
  assert.equal(output.gitignore.brand, 'planned');
  assert.deepEqual([output.link, output.agents], ['planned', 'planned']);
  assert.match(JSON.stringify(output.claudeSettings), /planned/);
  assert.equal(output.scripts, 'planned');
  assert.equal(output.envOrder.brand, 'planned');
});
