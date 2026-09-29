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

const SANDBOX = path.join(__dirname, '..', '..', '..', 'brands', 'sandbox-brand');

/**
 * The sandbox's tracked shape the workspace service reads (never its .env or
 * key files), plus a PUBLISHED manager install so the guide link and the
 * Claude settings have work, and the drift the other writing ops heal.
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

  const manager = path.join(root, 'node_modules', '@omega.js', 'manager');
  jetpack.write(path.join(manager, '.claude-plugin', 'marketplace.json'), { name: 'omega', plugins: [] });
  jetpack.write(path.join(manager, 'docs', 'AGENTS.md'), '# the map\n');

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

test('#971: a dry-run workspace walk plans every write and leaves the brand tree byte-identical', async () => {
  const root = stageBrand();
  const before = treeHash(root);

  const result = await runService('workspace', loadBrand(root), { dryRun: true });

  assert.deepEqual(treeHash(root), before);
  assert.notEqual(result.status, 'error', `the walk reached every op: ${result.error}`);

  // Each op had real work, so an identical tree means it was skipped
  const { output } = result;
  assert.ok(output.defaults.planned.length > 0);
  assert.equal(output.gitignore, 'planned');
  assert.deepEqual([output.guide, output.agents], ['planned', 'planned']);
  assert.equal(output.claudeSettings, 'planned');
  assert.equal(output.scripts, 'planned');
  assert.equal(output.envOrder.brand, 'planned');
});
