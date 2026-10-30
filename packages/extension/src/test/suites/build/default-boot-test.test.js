// Build-layer tests for the boot test the defaults scaffold ships to every consumer: it fails
// when the packaged manifest carries no brand origin, passes when it does, and asserts nothing
// until the brand declares a url. Each case stages a temp project, loads the scaffold's suite
// fresh inside it (utils/package-project.js), and runs its cases through devkit's runSuite with a
// plain-object `ctx.extension` (no Chromium).

const path = require('path');
const fs   = require('fs');

const expect = require('@omega.js/devkit/test/expect');
const { normalizeSpec, runSuite } = require('@omega.js/devkit/test/run-case');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { SRC, stageProject, inProject } = require('../../utils/package-project.js');

const DEFAULT_BOOT_TEST = path.join(SRC, 'defaults', 'test', 'boot', 'externally-connectable.test.js');

// Run the scaffolded boot test's cases against a manifest, from `dir`; resolves to their events.
async function runFrom(dir, manifest) {
  const events = [];
  await inProject(dir, async (spec) => {
    const suite = normalizeSpec(spec, { file: DEFAULT_BOOT_TEST });
    await runSuite(suite, { expect, extras: { extension: { manifest } }, report: (event) => { events.push(event); } });
  }, DEFAULT_BOOT_TEST);
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
        const tmp = stageProject({ config: BRAND });
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
        const tmp = stageProject({ config: BRAND });
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
        const noUrl = stageProject({ config: `{ brand: { id: 'staged', name: 'Staged' } }` });
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
