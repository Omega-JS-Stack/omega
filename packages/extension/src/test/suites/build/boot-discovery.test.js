// Build-layer tests for the boot layer's extension-directory discovery (#575).
//
// The boot layer promises a SKIP when the consumer has not built yet
// (docs/test-boot-layer.md). It discovered by existence alone, so it fell
// through to `<consumer>/dist/` — which exists after any dev run or `omega
// clean` — loaded the JSON5 source manifest Chrome cannot parse, and hard-failed
// every boot test instead. A directory only qualifies when its manifest is
// STRICT JSON; an explicitly named OMEGA_TEST_BOOT_DIR still fails loudly,
// because that one is the caller's decision, not a fallback.
//
// Discovery is asserted directly (no Chromium): the skip/abort verdicts are
// reached and returned before puppeteer ever launches.

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const BOOT_RUNNER = path.join(__dirname, '..', '..', 'runners', 'boot.js');

// One boot test, enough to make the counts meaningful.
const TESTS = [{ description: 'boot probe', inspect: async () => {} }];

const JSON5_MANIFEST = `{
  // the framework-authored source style Chrome refuses
  manifest_version: 3,
  name: 'Staged',
}
`;
const STRICT_MANIFEST = JSON.stringify({ manifest_version: 3, name: 'Staged', version: '1.0.0' }, null, 2);

// Stage a consumer project. `manifests` is a relative dir → manifest contents map.
function stageConsumer(manifests) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-boot-discovery-'));

  for (const [relative, contents] of Object.entries(manifests)) {
    fs.mkdirSync(path.join(tmp, relative), { recursive: true });
    fs.writeFileSync(path.join(tmp, relative, 'manifest.json'), contents);
  }

  return tmp;
}

// The self-test run points OMEGA_TEST_BOOT_PROJECT at the in-tree fixture —
// neutralize both boot env vars so each case sees only what it staged.
function withBootEnv(vars, fn) {
  const keys = ['OMEGA_TEST_BOOT_PROJECT', 'OMEGA_TEST_BOOT_DIR'];
  const previous = {};
  keys.forEach((key) => { previous[key] = process.env[key]; delete process.env[key]; });
  Object.entries(vars).forEach(([key, value]) => { process.env[key] = value; });

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      keys.forEach((key) => {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      });
    });
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'boot layer — extension-directory discovery',
  tests: [
    {
      name: 'a JSON5 dist/ manifest never qualifies — the run SKIPS as documented (#575)',
      run: async (ctx) => {
        const { runBootTests, resolveBootDir } = require(BOOT_RUNNER);
        const tmp = stageConsumer({ dist: JSON5_MANIFEST });

        try {
          await withBootEnv({}, async () => {
            const discovery = resolveBootDir(tmp);
            ctx.expect(discovery.dir).toBe(null);
            // The JSON5 copy is REPORTED, so the skip can say why it was passed over
            ctx.expect(discovery.rejected.length).toBe(1);
            ctx.expect(discovery.rejected[0].dir).toBe(path.join(tmp, 'dist'));

            const counts = await runBootTests({ tests: TESTS, projectRoot: tmp });
            ctx.expect(counts.skipped).toBe(TESTS.length);
            ctx.expect(counts.failed).toBe(0);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'the packaged strict-JSON manifest wins, and a strict-JSON dist/ still qualifies (#575)',
      run: async (ctx) => {
        const { resolveBootDir } = require(BOOT_RUNNER);
        const both = stageConsumer({ 'packaged/chromium/raw': STRICT_MANIFEST, dist: JSON5_MANIFEST });
        // The framework's own fixture extension has no `packaged/` step — its
        // dist/ is already strict JSON, and it must keep booting.
        const fixtureShape = stageConsumer({ dist: STRICT_MANIFEST });

        try {
          await withBootEnv({}, async () => {
            ctx.expect(resolveBootDir(both).dir).toBe(path.join(both, 'packaged', 'chromium', 'raw'));
            ctx.expect(resolveBootDir(fixtureShape).dir).toBe(path.join(fixtureShape, 'dist'));
          });
        } finally {
          fs.rmSync(both, { recursive: true, force: true });
          fs.rmSync(fixtureShape, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'an explicitly named OMEGA_TEST_BOOT_DIR with a JSON5 manifest still FAILS loudly (#575)',
      run: async (ctx) => {
        const { runBootTests, resolveBootDir } = require(BOOT_RUNNER);
        const tmp = stageConsumer({ dist: JSON5_MANIFEST });

        try {
          await withBootEnv({ OMEGA_TEST_BOOT_DIR: path.join(tmp, 'dist') }, async () => {
            const discovery = resolveBootDir(tmp);
            ctx.expect(discovery.dir).toBe(null);
            // The caller named this directory — a manifest Chrome cannot parse
            // there is an error, never a candidate to walk past
            ctx.expect(discovery.error).toBeInstanceOf(Error);

            const counts = await runBootTests({ tests: TESTS, projectRoot: tmp });
            ctx.expect(counts.failed).toBe(TESTS.length);
            ctx.expect(counts.skipped).toBe(0);
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
};
