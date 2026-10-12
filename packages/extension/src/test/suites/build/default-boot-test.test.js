// Build-layer tests for the boot test the defaults scaffold ships to every consumer: it fails
// when the packaged manifest carries no brand origin, passes when it does, and asserts nothing
// until the brand declares a url. Each case stages a temp project, chdirs into it, and runs the
// scaffold's cases through devkit's runSuite with a plain-object `ctx.extension` (no Chromium).

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const DEFAULT_BOOT_TEST = path.join(__dirname, '..', '..', '..', 'defaults', 'test', 'boot', 'externally-connectable.test.js');
const expect = require('@omega.js/devkit/test/expect');
const { normalizeSpec, runSuite } = require('@omega.js/devkit/test/run-case');
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

// Run the scaffolded boot test's cases against a manifest, from `dir`; resolves to their events.
async function runFrom(dir, manifest) {
  const suite = normalizeSpec(require(DEFAULT_BOOT_TEST), { file: DEFAULT_BOOT_TEST });
  const events = [];
  const oldCwd = process.cwd();
  try {
    process.chdir(dir);
    await runSuite(suite, { expect, extras: { extension: { manifest } }, report: (event) => { events.push(event); } });
  } finally {
    process.chdir(oldCwd);
  }
  return events;
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
          // A dev build carries the dev origin too: the brand origin is what it asserts
          const events = await runFrom(tmp, { externally_connectable: { matches: ['https://staged.example.com/*', 'https://localhost:4000/*'] } });
          ctx.expect(events.length > 0).toBe(true);
          ctx.expect(events.map((event) => event.status)).toEqual(events.map(() => 'pass'));
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
          const devOnly = await runFrom(tmp, { externally_connectable: { matches: ['https://localhost:4000/*'] } });
          ctx.expect(devOnly.some((event) => event.status === 'fail')).toBe(true);

          // ...and on a manifest with no externally_connectable at all
          const none = await runFrom(tmp, { name: 'Staged' });
          ctx.expect(none.some((event) => event.status === 'fail')).toBe(true);
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
          const events = [...await runFrom(noUrl, { name: 'Staged' }), ...await runFrom(noConfig, { name: 'Staged' })];
          ctx.expect(events.length > 0).toBe(true);
          ctx.expect(events.filter((event) => event.status === 'fail')).toEqual([]);
        } finally {
          fs.rmSync(noUrl, { recursive: true, force: true });
          fs.rmSync(noConfig, { recursive: true, force: true });
        }
      },
    },
  ],
});
