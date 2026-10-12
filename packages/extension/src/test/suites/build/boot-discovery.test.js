// Build-layer tests for the boot layer's extension-directory discovery. Only a STRICT JSON
// manifest qualifies, so an unbuilt project skips naming `npm run build`, and an explicit
// OMEGA_TEST_BOOT_DIR at a broken manifest fails loudly. No Chromium: the verdicts reach the
// cases through the verb's boot driver before puppeteer would launch.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');

const BOOT_RUNNER = path.join(__dirname, '..', '..', 'runners', 'boot.js');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');

// Two boot cases, so "every case" means more than one.
const PROBE = {
  type: 'group',
  layer: 'boot',
  timeout: 45000,
  description: 'boot probe',
  tests: [
    { name: 'boot probe one', run: async (ctx) => { ctx.expect(true).toBe(true); } },
    { name: 'boot probe two', run: async (ctx) => { ctx.expect(true).toBe(true); } },
  ],
};

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

// The verb's boot driver, started on `projectRoot` with the probe suite; resolves to the events it reported.
async function driveBoot(driver, projectRoot) {
  const suite = normalizeSpec(PROBE, { file: path.join(projectRoot, 'probe.test.js') });
  const events = [];
  const handle = await driver.start({ projectRoot, options: {}, suites: [suite], hooks: [], report: (event) => { events.push(event); } });
  try {
    await handle.finished;
  } finally {
    await handle.stop();
  }
  return events;
}

// The consumer config's boot driver, read before a case moves the boot env.
function bootDriver(projectRoot) {
  const { runnerConfig } = require(VERB);
  return runnerConfig({ projectRoot, selfTest: false }).drivers.boot;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'boot layer — extension-directory discovery',
  tests: [
    {
      name: 'case-168 a dir with no parsable manifest.json skips every boot case naming npm run build',
      run: async (ctx) => {
        const { resolveBootDir } = require(BOOT_RUNNER);
        const tmp = stageConsumer({ dist: JSON5_MANIFEST });
        const driver = bootDriver(tmp);

        try {
          await withBootEnv({ OMEGA_TEST_BOOT_PROJECT: tmp }, async () => {
            const discovery = resolveBootDir(tmp);
            ctx.expect(discovery.dir).toBe(null);
            // The JSON5 copy is REPORTED, so the skip can say why it was passed over
            ctx.expect(discovery.rejected.length).toBe(1);
            ctx.expect(discovery.rejected[0].dir).toBe(path.join(tmp, 'dist'));

            const events = await driveBoot(driver, tmp);
            ctx.expect(events.map((event) => event.status)).toEqual(['skip', 'skip']);
            for (const event of events) ctx.expect(event.reason).toContain('npm run build');
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
        const both = stageConsumer({ 'packaged/chrome/raw': STRICT_MANIFEST, dist: JSON5_MANIFEST });
        // The framework's own fixture extension has no `packaged/` step — its
        // dist/ is already strict JSON, and it must keep booting.
        const fixtureShape = stageConsumer({ dist: STRICT_MANIFEST });

        try {
          await withBootEnv({}, async () => {
            ctx.expect(resolveBootDir(both).dir).toBe(path.join(both, 'packaged', 'chrome', 'raw'));
            ctx.expect(resolveBootDir(fixtureShape).dir).toBe(path.join(fixtureShape, 'dist'));
          });
        } finally {
          fs.rmSync(both, { recursive: true, force: true });
          fs.rmSync(fixtureShape, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'case-168 OMEGA_TEST_BOOT_DIR at a broken manifest fails every boot case naming the file',
      run: async (ctx) => {
        const { resolveBootDir } = require(BOOT_RUNNER);
        const tmp = stageConsumer({ dist: JSON5_MANIFEST });
        const driver = bootDriver(tmp);

        try {
          await withBootEnv({ OMEGA_TEST_BOOT_PROJECT: tmp, OMEGA_TEST_BOOT_DIR: path.join(tmp, 'dist') }, async () => {
            const discovery = resolveBootDir(tmp);
            ctx.expect(discovery.dir).toBe(null);
            // The caller named this directory — a manifest Chrome cannot parse
            // there is an error, never a candidate to walk past
            ctx.expect(discovery.error).toBeInstanceOf(Error);

            const events = await driveBoot(driver, tmp);
            ctx.expect(events.map((event) => event.status)).toEqual(['fail', 'fail']);
            for (const event of events) ctx.expect(event.error.message).toContain(path.join('dist', 'manifest.json'));
          });
        } finally {
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      },
    },
  ],
});
