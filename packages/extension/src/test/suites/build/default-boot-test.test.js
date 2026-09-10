// Build-layer tests for the boot test the defaults scaffold ships to every
// consumer (`src/defaults/test/boot/externally-connectable.test.js`, #583).
//
// That file runs in EVERY consumer's suite, so its own logic is worth proving:
// it must fail when the packaged manifest carries no brand origin (the #583
// bug shape — a published extension the brand site cannot message), pass when
// it does, and assert nothing at all until the brand declares a url.
//
// The scaffolded test reads the consumer's resolved config from cwd, so each
// case stages a temp project and chdirs into it. Chromium never enters: the
// `extension` handle its inspect() reads is the manifest, and a plain object
// is exactly that shape.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const DEFAULT_BOOT_TEST = path.join(__dirname, '..', '..', '..', 'defaults', 'test', 'boot', 'externally-connectable.test.js');
const expect = require('../../assert.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

// Stage a temp consumer project; `config` is the config/omega.json5 body (omit for none).
function stageProject(config) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-default-boot-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), `{ "name": "staged-ext", "version": "3.1.4" }`);

  if (config !== undefined) {
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'omega.json5'), config);
  }

  return tmp;
}

// Run the scaffolded boot test's inspect() against a manifest, from `dir`.
async function inspectFrom(dir, manifest) {
  const oldCwd = process.cwd();
  try {
    process.chdir(dir);
    return await require(DEFAULT_BOOT_TEST).inspect({ extension: { manifest }, expect });
  } finally {
    process.chdir(oldCwd);
  }
}

const BRAND = `{ brand: { id: 'staged', name: 'Staged', url: 'https://staged.example.com' } }`;

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'the scaffolded default boot test — externally_connectable',
  tests: [
    {
      name: 'passes when the packaged manifest carries the brand origin (#583)',
      run: async (ctx) => {
        const tmp = stageProject(BRAND);
        try {
          // A dev build carries the dev origin too — the brand origin is what it asserts
          await inspectFrom(tmp, { externally_connectable: { matches: ['https://staged.example.com/*', 'https://localhost:4000/*'] } });
          ctx.expect(true).toBe(true);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'FAILS on the #583 shape — a packaged manifest carrying only the dev origin',
      run: async (ctx) => {
        const tmp = stageProject(BRAND);
        try {
          let thrown = null;
          await inspectFrom(tmp, { externally_connectable: { matches: ['https://localhost:4000/*'] } }).catch((e) => { thrown = e; });
          ctx.expect(thrown).toBeInstanceOf(Error);

          // …and on a manifest with no externally_connectable at all
          thrown = null;
          await inspectFrom(tmp, { name: 'Staged' }).catch((e) => { thrown = e; });
          ctx.expect(thrown).toBeInstanceOf(Error);
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'asserts nothing until the brand declares a url',
      run: async (ctx) => {
        const noUrl = stageProject(`{ brand: { id: 'staged', name: 'Staged' } }`);
        const noConfig = stageProject();
        try {
          await inspectFrom(noUrl, { name: 'Staged' });
          await inspectFrom(noConfig, { name: 'Staged' });
          ctx.expect(true).toBe(true);
        } finally {
          fs.rmSync(noUrl, { recursive: true, force: true });
          fs.rmSync(noConfig, { recursive: true, force: true });
        }
      },
    },
  ],
});
