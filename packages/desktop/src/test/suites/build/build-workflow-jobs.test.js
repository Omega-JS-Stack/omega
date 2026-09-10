// The release workflow's job graph
// ([#802](https://github.com/Omega-JS-Stack/omega/issues/802)).
//
// The workflow runs NO tests. Ian's ruling (2026-09-07): tests run on the
// developer's machine and the commit gate runs the battery at ship, so CI is
// dispatch-only and BUILDS, which is what web's and the extension's release
// workflows already do. Desktop's Test job was the leftover (first ahead of
// Build, then beside it); it is gone, and so is every `needs` on it.
//
// The scaffolded copy is what a consumer's CI executes, so the graph is read
// off a real `copyDefaults` render rather than off the template's tokens.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');
const yaml = require('js-yaml');

const { copyDefaults } = require('../../../commands/lib/ensure-target.js');
const defineCases = require('@omega.js/devkit/test/define-cases');

// GitHub takes `needs` as a string or as a list; the graph question is the same.
const needsOf = (job) => [].concat(job.needs || []);

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'release workflow job graph (#802): a build-only workflow, no test job',
  tests: [
    {
      name: 'there is no Test job, and nothing waits on one',
      run: async (ctx) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workflow-jobs-'));
        await copyDefaults(tmp);
        const { jobs } = yaml.load(jetpack.read(path.join(tmp, '.github', 'workflows', 'build.yml')));

        ctx.expect(Object.keys(jobs)).not.toContain('test');
        for (const job of Object.values(jobs)) {
          ctx.expect(needsOf(job)).not.toContain('test');
        }

        ctx.expect(needsOf(jobs.build)).toEqual(['setup']);
        ctx.expect(needsOf(jobs.finalize)).toEqual(['setup', 'build', 'windows-sign']);
        // finalize runs under `always()`, so a job that FAILED or was skipped
        // still reaches its `if`: the gate has to name the result it wants.
        ctx.expect(jobs.finalize.if).not.toContain('needs.test.result');
        ctx.expect(jobs.finalize.if).toContain("needs.build.result == 'success'");

        // Signing still hangs off the artifact Build uploads, nothing else.
        ctx.expect(needsOf(jobs['windows-sign'])).toContain('build');
        ctx.expect(needsOf(jobs['windows-strategy'])).toContain('build');
      },
    },
  ],
});
