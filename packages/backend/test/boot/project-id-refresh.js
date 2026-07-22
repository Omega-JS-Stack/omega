/**
 * Project-id consistency — the shared-context refresh contract.
 *
 * self.projectId is snapshotted from .firebaserc at setup boot; when the
 * consistency fix rewrites .firebaserc FROM config (demo → real swap), it must
 * ALSO refresh self.projectId/projectUrl/firebaseRC — otherwise every later
 * check's isDemoProject gate keeps demo semantics for the rest of the run
 * (caught live on omegajs-playground: check 39 skipped real campaign seeding
 * because self still said demo-omega).
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const jetpack = require('fs-jetpack');

const ProjectIdConsistencyTest = require('../../dist/cli/commands/setup-tests/project-id-consistency.js');

function stage(configProjectId, firebasercProjectId) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-pid-'));

  jetpack.write(path.join(tmp, 'config', 'omega.json5'), [
    '{',
    '  brand: { id: "pid-brand", name: "PID Brand" },',
    `  cloud: { provider: "firebase", config: { projectId: "${configProjectId}" } },`,
    '  targets: { backend: {} },',
    '}',
  ].join('\n'));
  jetpack.write(path.join(tmp, '.firebaserc'), `${JSON.stringify({ projects: { default: firebasercProjectId } }, null, 2)}\n`);
  jetpack.dir(path.join(tmp, 'functions'));

  return tmp;
}

module.exports = {
  description: 'Project-id consistency — fix refreshes the shared setup context',
  type: 'group',
  timeout: 30000,

  tests: [
    {
      name: 'demo-to-real-swap-refreshes-self-projectid',
      async run({ assert }) {
        const tmp = stage('real-project-abc', 'demo-stale');
        const self = {
          firebaseProjectPath: tmp,
          projectId: 'demo-stale',
          projectUrl: 'https://console.firebase.google.com/project/demo-stale',
          firebaseRC: { projects: { default: 'demo-stale' } },
        };

        const check = new ProjectIdConsistencyTest({ main: self });
        assert.equal(await check.run(), false, 'mismatch detected');

        await check.fix();

        // The derived artifact follows config…
        const firebaserc = JSON.parse(jetpack.read(path.join(tmp, '.firebaserc')));
        assert.equal(firebaserc.projects.default, 'real-project-abc', '.firebaserc rewritten from config');

        // …and the SHARED context follows too — later checks must see truth
        assert.equal(self.projectId, 'real-project-abc', 'self.projectId refreshed');
        assert.equal(self.firebaseRC.projects.default, 'real-project-abc', 'self.firebaseRC refreshed');
        assert.ok(self.projectUrl.includes('real-project-abc'), 'self.projectUrl refreshed');
        assert.equal(check.isDemoProject, false, 'demo gate now reads the real id');

        assert.equal(await check.run(), true, 'idempotent: rerun passes');
        jetpack.remove(tmp);
      },
    },
  ],
};
